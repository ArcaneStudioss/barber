'use strict';
const db = require('../db');
const config = require('../config');
const security = require('./security');
const { HttpError } = require('./validate');

const COOKIE = { staff: 'be_staff', cliente: 'be_cliente' };
const TTL = { staff: 12 * 3600000, cliente: 7 * 86400000, agendamento: 2 * 86400000 };

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignora */ }
  }
  return out;
}

function cookieOptions(maxAgeMs) {
  return { httpOnly: true, sameSite: 'lax', secure: config.isProduction, path: '/', maxAge: maxAgeMs };
}

function createSession(res, kind, { userId = null, customerId = null, appointmentId = null, ip = null }) {
  const token = security.randomToken();
  const now = Date.now();
  db.get().prepare('INSERT INTO sessions (token_hash, kind, user_id, customer_id, appointment_id, expires_at, created_at, ip) VALUES (?,?,?,?,?,?,?,?)')
    .run(security.hashToken(token), kind, userId, customerId, appointmentId, now + TTL[kind], now, ip);
  res.cookie(kind === 'staff' ? COOKIE.staff : COOKIE.cliente, token, cookieOptions(TTL[kind]));
  return token;
}

function destroySession(req, res, which) {
  const cookies = parseCookies(req.headers.cookie);
  const name = COOKIE[which];
  if (cookies[name]) db.get().prepare('DELETE FROM sessions WHERE token_hash = ?').run(security.hashToken(cookies[name]));
  res.clearCookie(name, { path: '/' });
}

function loadSessions(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const conn = db.get();
  const now = Date.now();
  req.staff = null; req.clientSession = null;
  if (cookies[COOKIE.staff]) {
    const s = conn.prepare("SELECT * FROM sessions WHERE token_hash = ? AND kind = 'staff' AND expires_at > ?").get(security.hashToken(cookies[COOKIE.staff]), now);
    if (s) {
      const u = conn.prepare('SELECT id, name, email, role, professional_id, active FROM users WHERE id = ?').get(s.user_id);
      if (u && u.active) req.staff = u;
    }
  }
  if (cookies[COOKIE.cliente]) {
    const s = conn.prepare("SELECT * FROM sessions WHERE token_hash = ? AND kind IN ('cliente','agendamento') AND expires_at > ?").get(security.hashToken(cookies[COOKIE.cliente]), now);
    if (s) {
      const c = conn.prepare('SELECT * FROM customers WHERE id = ? AND anonymized_at IS NULL').get(s.customer_id);
      if (c) req.clientSession = { kind: s.kind, customer: c, appointmentId: s.appointment_id };
    }
  }
  next();
}

function requireStaff(...roles) {
  return (req, res, next) => {
    if (!req.staff) return next(new HttpError(401, 'Faça login para continuar.'));
    if (roles.length && !roles.includes(req.staff.role)) return next(new HttpError(403, 'Você não tem permissão para esta ação.'));
    next();
  };
}

function requireClient(full = false) {
  return (req, res, next) => {
    if (!req.clientSession) return next(new HttpError(401, 'Acesse com o código de verificação ou pelo link do seu agendamento.'));
    if (full && req.clientSession.kind !== 'cliente') return next(new HttpError(403, 'Para ver todo o histórico e alterar seus dados, confirme seu acesso com o código de verificação.'));
    next();
  };
}

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60000;

function staffLogin(email, password) {
  const conn = db.get();
  const u = conn.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
  const now = Date.now();
  if (!u) { security.verifyPassword(password, security.DUMMY_HASH); return { ok: false }; }
  if (u.locked_until && u.locked_until > now) return { ok: false, locked: true };
  const ok = u.active && security.verifyPassword(password, u.password_hash);
  if (!ok) {
    const fails = u.failed_logins + 1;
    conn.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now + LOCK_MS : null, u.id);
    return { ok: false, locked: fails >= MAX_FAILS };
  }
  conn.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now, u.id);
  return { ok: true, user: u };
}

function cleanup() {
  const now = Date.now();
  db.get().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.get().prepare('DELETE FROM otp_codes WHERE expires_at < ?').run(now - 86400000);
}

function audit(req, action, detail) {
  db.get().prepare('INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?,?,?,?,?)')
    .run(req.staff ? req.staff.id : null, action, typeof detail === 'string' ? detail : JSON.stringify(detail || {}), req.ip, Date.now());
}

module.exports = { createSession, destroySession, loadSessions, requireStaff, requireClient, staffLogin, cleanup, audit, parseCookies, COOKIE };
