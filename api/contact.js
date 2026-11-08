// Secure contact endpoint — POST /api/contact
// Uses Resend. Never expose RESEND_API_KEY to the browser.
// Env (all required):
//   RESEND_API_KEY — Resend API key (secret, server-only)
//   CONTACT_EMAIL  — destination inbox (your Presidency University address)
//   RESEND_FROM    — sender on a domain VERIFIED in Resend (resend.com/domains)
// RESEND_FROM has NO fallback on purpose: onboarding@resend.dev can only
// deliver to your own Resend account email, so falling back to it would
// silently fail for the Presidency University recipient.
'use strict';

const { Resend } = require('resend');
const crypto = require('crypto');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const DUPLICATE_WINDOW_MS = 60 * 1000;
const hits = new Map(); // ip+email -> timestamps[]
const sentHashes = new Map(); // contentHash -> { timestamp, id }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Safe diagnostics: mask email local parts, never log secrets or message bodies.
function maskEmail(email) {
  const m = String(email || '').match(/^(.{1,3})[^@]*(@.+)$/);
  return m ? `${m[1]}***${m[2]}` : '(invalid)';
}
function emailDomain(email) {
  const m = String(email || '').match(/@([^<>\s]+)/);
  return m ? m[1] : '(none)';
}
// Extract the raw email address from "Name <email>" or plain "email".
function extractFromEmail(from) {
  const m = String(from || '').match(/[\w.+-]+@[^\s<>"]+/);
  return m ? m[0] : '';
}

function rateLimited(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    hits.set(key, arr);
    return true;
  }
  arr.push(now);
  hits.set(key, arr);
  return false;
}

function isDuplicate(key) {
  const entry = sentHashes.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp < DUPLICATE_WINDOW_MS) return entry;
  sentHashes.delete(key);
  return null;
}

function getIp(req) {
  const fwd = req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function configError(missing, guidance) {
  console.error('[contact] configuration error', { missing });
  return { message: `Server is not configured: ${missing} is missing. ${guidance}` };
}

// Map a Resend failure to a safe, actionable client message + log detail.
function describeResendError(error) {
  const errName = (error && error.name) || 'unknown';
  const errMessage = (error && error.message) || 'Unknown Resend error';
  if (/You can only send testing emails/i.test(errMessage)) {
    return {
      status: 403,
      clientMessage:
        'Email delivery is in Resend test mode. Verify your own domain in Resend (resend.com/domains) and set RESEND_FROM to an address on that domain.',
      detail: errMessage,
    };
  }
  if (/domain/i.test(errMessage) && /not verified|unverified|forbidden|sender/i.test(errMessage + ' ' + errName)) {
    return {
      status: 403,
      clientMessage:
        'Sender domain is not verified in Resend. Open resend.com/domains, verify the domain, and set RESEND_FROM to an address on it.',
      detail: errMessage,
    };
  }
  return { status: 502, clientMessage: 'Could not send your message. Please try again later.', detail: errMessage };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ success: false, error: 'Method not allowed.' }));
  }

  const len = Number((req.headers && req.headers['content-length']) || 0);
  if (len > 10000) {
    res.statusCode = 413;
    return res.end(JSON.stringify({ success: false, error: 'Request too large.' }));
  }

  const body = parseBody(req);

  if (body.company && String(body.company).trim() !== '') {
    res.statusCode = 200;
    return res.end(JSON.stringify({ success: true }));
  }

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const subject = String(body.subject || '').trim();
  const message = String(body.message || '').trim();

  const errors = [];
  if (!name || name.length < 2 || name.length > 100) errors.push('Please enter your full name (2–100 characters).');
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) errors.push('Please enter a valid email address.');
  if (!subject || subject.length < 3 || subject.length > 150) errors.push('Please enter a subject (3–150 characters).');
  if (!message || message.length < 10 || message.length > 5000) errors.push('Please write a message (10–5,000 characters).');
  if (/[\r\n]/.test(name) || /[\r\n]/.test(subject) || /[\r\n]/.test(email)) errors.push('Invalid characters in the form.');
  if (errors.length) {
    console.log('[contact] validation failed', { count: errors.length });
    res.statusCode = 400;
    return res.end(JSON.stringify({ success: false, error: errors.join(' ') }));
  }

  const ip = getIp(req);
  if (rateLimited(ip + '|' + email.toLowerCase())) {
    console.log('[contact] rate limited', { ip });
    res.statusCode = 429;
    return res.end(JSON.stringify({ success: false, error: 'Too many messages sent. Please wait a minute and try again.' }));
  }

  const duplicateKey = crypto.createHash('sha256').update(`${email}|${subject}|${message}`).digest('hex');
  const prior = isDuplicate(duplicateKey);
  if (prior) {
    console.log('[contact] duplicate submission suppressed', { id: prior.id || null });
    return res.end(JSON.stringify({ success: true, id: prior.id || null, duplicate: true }));
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_EMAIL;
  const from = process.env.RESEND_FROM;
  const fromEmail = extractFromEmail(from);
  const fromDomain = emailDomain(fromEmail);

  console.log('[contact] send attempt', {
    keySet: Boolean(apiKey),
    toSet: Boolean(to),
    fromSet: Boolean(from),
    toDomain: to ? emailDomain(to) : '(unset)',
    fromDomain: from ? fromDomain : '(unset)',
  });

  const missing = [];
  if (!apiKey) missing.push('RESEND_API_KEY');
  if (!to || !EMAIL_RE.test(to)) missing.push('CONTACT_EMAIL');
  if (!from || !EMAIL_RE.test(fromEmail)) missing.push('RESEND_FROM');
  if (missing.length) {
    const cfg = configError(missing.join(' and '), 'Set it in Vercel → Project Settings → Environment Variables, then redeploy.');
    res.statusCode = 500;
    return res.end(JSON.stringify({ success: false, error: cfg.message }));
  }
  if (/^resend\.dev$/i.test(fromDomain)) {
    console.error('[contact] configuration error: RESEND_FROM uses resend.dev test sender (not allowed for production delivery)');
    res.statusCode = 403;
    return res.end(JSON.stringify({
      success: false,
      error: 'Email delivery is in Resend test mode: onboarding@resend.dev can only send to your own Resend account email. Verify your own domain in Resend (resend.com/domains) and set RESEND_FROM to an address on that domain.',
      detail: 'RESEND_FROM must be an address on a domain verified at resend.com/domains.',
    }));
  }
  if (/^(gmail\.com|presidencyuniversity\.in)$/i.test(fromDomain)) {
    console.error('[contact] configuration error: RESEND_FROM domain is not a verified domain', { fromDomain });
    res.statusCode = 500;
    return res.end(JSON.stringify({
      success: false,
      error: 'Sender domain is not verified in Resend. Open resend.com/domains, verify the domain, and set RESEND_FROM to an address on it.',
      detail: 'Do not use a Gmail or university address as RESEND_FROM.',
    }));
  }

  try {
    const resend = new Resend(apiKey);
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;line-height:1.6;color:#2B2723">
        <h2 style="margin:0 0 4px">New portfolio contact</h2>
        <p style="color:#5A534B;margin:0 0 16px">From: <strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</p>
        <p style="margin:0 0 8px"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
        <div style="border:1px solid #E3DCD0;border-radius:10px;padding:16px;background:#F5F1E9;white-space:pre-wrap">${escapeHtml(message)}</div>
        <p style="color:#8B8177;font-size:12px;margin-top:16px">Reply to this email to respond directly to ${escapeHtml(email)}.</p>
      </div>`;
    const text = `New portfolio contact\nFrom: ${name} <${email}>\nSubject: ${subject}\n\n${message}`;
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject: `[Portfolio] ${subject} — from ${name}`,
      html,
      text,
      replyTo: email,
    });
    if (error) {
      const described = describeResendError(error);
      console.error('[contact] Resend rejected the email', {
        name: error.name || 'unknown',
        message: error.message || 'unknown',
        statusCode: error.statusCode || null,
      });
      res.statusCode = described.status;
      return res.end(JSON.stringify({ success: false, error: described.clientMessage, detail: described.detail }));
    }
    const id = (data && data.id) || null;
    sentHashes.set(duplicateKey, { timestamp: Date.now(), id });
    console.log('[contact] Resend accepted the email', { id });
    res.statusCode = 200;
    return res.end(JSON.stringify({ success: true, id }));
  } catch (err) {
    console.error('[contact] unexpected handler error', { name: err && err.name, message: err && err.message });
    res.statusCode = 502;
    return res.end(JSON.stringify({ success: false, error: 'Could not send your message. Please try again later.' }));
  }
};

module.exports.describeResendError = describeResendError;
module.exports.maskEmail = maskEmail;
module.exports.extractFromEmail = extractFromEmail;
