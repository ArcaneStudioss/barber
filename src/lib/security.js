'use strict';
const crypto = require('node:crypto');
const config = require('../config');

// ---------- senhas (scrypt nativo do Node) ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(expected, got);
  } catch { return false; }
}
// Hash fixo para comparar quando o usuário não existe (tempo de resposta igual)
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

// ---------- tokens ----------
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function hashToken(token) { return crypto.createHmac('sha256', config.appSecret).update(String(token)).digest('hex'); }
function randomCode(digits = 6) {
  return String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0');
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---------- limite de tentativas (memória do processo) ----------
const buckets = new Map();
function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count += 1;
  return { ok: b.count <= limit, retryAfter: Math.ceil((b.reset - now) / 1000) };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 60000).unref();
function resetRateLimits() { buckets.clear(); }

function limiter(name, opts) {
  return (req, res, next) => {
    const r = rateLimit(`${name}:${req.ip}`, opts);
    if (!r.ok) {
      res.set('Retry-After', String(r.retryAfter));
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }
    next();
  };
}

// ---------- HTML ----------
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- cabeçalhos de segurança ----------
function securityHeaders(req, res, next) {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self' 'nonce-${res.locals.nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self'",
      'frame-src https://www.google.com https://maps.google.com',
      "form-action 'self' https://www.mercadopago.com.br https://www.mercadopago.com",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  });
  if (config.isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// Requisições que alteram dados precisam vir do próprio site (proteção CSRF).
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const host = req.get('host');
  const allowed = new Set([config.baseUrl]);
  if (!config.isProduction) allowed.add(`http://${host}`);
  if (origin && !allowed.has(origin)) return res.status(403).json({ error: 'Origem não permitida.' });
  if (!origin) {
    const ref = req.get('referer');
    if (ref && ![...allowed].some((a) => ref.startsWith(`${a}/`))) return res.status(403).json({ error: 'Origem não permitida.' });
    if (!ref && req.get('x-requested-with') !== 'fetch') return res.status(403).json({ error: 'Requisição inválida.' });
  }
  next();
}

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, randomToken, hashToken, randomCode, safeEqual,
  rateLimit, limiter, resetRateLimits, esc, securityHeaders, sameOrigin,
};
