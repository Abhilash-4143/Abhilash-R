// Secure contact endpoint — POST /api/contact
// Uses Resend. Never expose RESEND_API_KEY to the browser.
// Env: RESEND_API_KEY (required), CONTACT_EMAIL (destination), RESEND_FROM (optional verified sender)
//
// NOTE — Resend test mode:
//   The shared `onboarding@resend.dev` sender can ONLY deliver to the email
//   address of your Resend account. Sending from it to any other inbox
//   returns 403 "You can only send testing emails to your own email address..."
//   To deliver to CONTACT_EMAIL you must verify your own domain in Resend
//   (resend.com/domains) and set RESEND_FROM to an address on that domain.
'use strict';

const { Resend } = require('resend');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const hits = new Map(); // ip+email -> timestamps[]

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

// Map a Resend failure to a safe, actionable client message + log detail.
function describeResendError(error, testingMode) {
  const errName = (error && error.name) || 'unknown';
  const errMessage = (error && error.message) || 'Unknown Resend error';
  const statusCode = (error && error.statusCode) || null;
  if (/You can only send testing emails/i.test(errMessage)) {
    return {
      status: 403,
      clientMessage:
        'Email delivery is in Resend test mode: onboarding@resend.dev can only send to your own Resend account email. Verify your own domain in Resend (resend.com/domains) and set RESEND_FROM to an address on that domain.',
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
    // same-origin only; answer preflight without CORS wildcard
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ success: false, error: 'Method not allowed.' }));
  }

  // Reject oversized payloads
  const len = Number((req.headers && req.headers['content-length']) || 0);
  if (len > 10000) {
    res.statusCode = 413;
    return res.end(JSON.stringify({ success: false, error: 'Request too large.' }));
  }

  const body = parseBody(req);

  // Honeypot: bots fill hidden "company" field — silently accept, don't send
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
  // Block obvious link-spam / header injection
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

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_EMAIL || 'ABHILASH.20241CSE0600@presidencyuniversity.in';
  const from = process.env.RESEND_FROM || 'Portfolio Contact <onboarding@resend.dev>';
  const testingMode = /@resend\.dev/i.test(from);

  // Safe config diagnostics — presence flags + domains only (no secrets/contents).
  console.log('[contact] send attempt', {
    keySet: Boolean(apiKey),
    to: maskEmail(to),
    toDomain: emailDomain(to),
    fromDomain: emailDomain(from),
    testingMode,
  });

  if (!apiKey) {
    console.error('[contact] aborted: RESEND_API_KEY is not set in this deployment');
    res.statusCode = 500;
    return res.end(JSON.stringify({ success: false, error: 'Email service is not configured yet. Please try again later.' }));
  }
  if (testingMode) {
    console.warn('[contact] warning: sender is onboarding@resend.dev — Resend will only deliver if the recipient exactly matches your Resend account email.');
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
      const described = describeResendError(error, testingMode);
      console.error('[contact] Resend rejected the email', {
        name: error.name || 'unknown',
        message: error.message || 'unknown',
        statusCode: error.statusCode || null,
        testingMode,
        hint: described.clientMessage,
      });
      res.statusCode = described.status;
      return res.end(JSON.stringify({ success: false, error: described.clientMessage, detail: described.detail }));
    }
    console.log('[contact] Resend accepted the email', { id: (data && data.id) || null });
    res.statusCode = 200;
    return res.end(JSON.stringify({ success: true, id: data && data.id }));
  } catch (err) {
    console.error('[contact] unexpected handler error', { name: err && err.name, message: err && err.message });
    res.statusCode = 502;
    return res.end(JSON.stringify({ success: false, error: 'Could not send your message. Please try again later.' }));
  }
};

// Exported for local tests
module.exports.describeResendError = describeResendError;
module.exports.maskEmail = maskEmail;
