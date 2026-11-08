// Public EmailJS identifiers for the contact form (no secrets).
// Reads VITE_EMAILJS_* env vars server-side so the static frontend can fetch
// them at runtime. Service ID / template ID / public key are public EmailJS
// identifiers (safe to send to the browser); the private key never exists here.
// Env: VITE_EMAILJS_SERVICE_ID, VITE_EMAILJS_TEMPLATE_ID, VITE_EMAILJS_PUBLIC_KEY
// (non-prefixed aliases EMAILJS_SERVICE_ID / EMAILJS_TEMPLATE_ID /
//  EMAILJS_PUBLIC_KEY are also accepted).
'use strict';

function pick(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ configured: false, error: 'Method not allowed.' }));
  }

  const serviceId = pick('VITE_EMAILJS_SERVICE_ID', 'EMAILJS_SERVICE_ID');
  const templateId = pick('VITE_EMAILJS_TEMPLATE_ID', 'EMAILJS_TEMPLATE_ID');
  const publicKey = pick('VITE_EMAILJS_PUBLIC_KEY', 'EMAILJS_PUBLIC_KEY');

  // Safe diagnostics: presence flags only (identifiers are public, but we
  // still avoid echoing full values into logs on every request).
  console.log('[emailjs] config request', {
    serviceSet: Boolean(serviceId),
    templateSet: Boolean(templateId),
    keySet: Boolean(publicKey),
  });

  if (!serviceId || !templateId || !publicKey) {
    res.statusCode = 503;
    return res.end(JSON.stringify({
      configured: false,
      error: 'EmailJS is not configured. Set VITE_EMAILJS_SERVICE_ID, VITE_EMAILJS_TEMPLATE_ID and VITE_EMAILJS_PUBLIC_KEY in Vercel, then redeploy.',
    }));
  }
  res.statusCode = 200;
  return res.end(JSON.stringify({ configured: true, serviceId, templateId, publicKey }));
};
