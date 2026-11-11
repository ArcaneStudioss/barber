'use strict';
const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const time = require('../lib/time');
const booking = require('../lib/booking');
const security = require('../lib/security');
const auth = require('../lib/auth');
const notify = require('../lib/notify');
const ics = require('../lib/ics');
const fmt = require('../lib/format');
const payments = require('../lib/payments');
const settings = require('../lib/settings');
const { summarize, slotsFor } = require('./api-public');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- acesso por código de verificação ----------
function findCustomer(identifier) {
  const conn = db.get();
  const raw = String(identifier || '').trim();
  if (raw.includes('@')) {
    const email = v.email(raw, 'identifier', { required: true });
    return conn.prepare('SELECT * FROM customers WHERE email = ? AND anonymized_at IS NULL ORDER BY id LIMIT 1').get(email);
  }
  const phone = v.phoneBR(raw, 'identifier');
  return conn.prepare('SELECT * FROM customers WHERE phone = ? AND anonymized_at IS NULL').get(phone);
}

router.post('/codigo', security.limiter('otp-ip', { limit: 6, windowMs: 15 * 60000 }), wrap(async (req, res) => {
  const identifier = String((req.body || {}).identifier || '');
  const channelPref = (req.body || {}).channel === 'email' ? 'email' : (req.body || {}).channel === 'whatsapp' ? 'whatsapp' : null;
  const generic = { ok: true, message: 'Se houver um cadastro com esse contato, enviamos um código de 6 dígitos. Ele vale por 10 minutos.' };
  const customer = findCustomer(identifier);
  const perId = security.rateLimit(`otp-id:${identifier.replace(/\D/g, '') || identifier.toLowerCase()}`, { limit: 3, windowMs: 15 * 60000 });
  if (!perId.ok) return res.status(429).json({ error: 'Muitos códigos pedidos para este contato. Aguarde 15 minutos.' });
  // O aviso depende só da configuração global, nunca do cadastro (não revela se o contato existe).
  if (!notify.accessChannels({ email: 'x@x.x', phone: '1' }).length) {
    return res.json({ ok: false, warning: 'O envio de códigos ainda não está ativado pela barbearia. Use o link recebido ao agendar ou fale pelo WhatsApp.' });
  }
  if (!customer) return res.json(generic);
  const channels = notify.accessChannels(customer);
  if (!channels.length) return res.json(generic);
  const channel = identifier.includes('@') && channels.includes('email') ? 'email' : (channelPref && channels.includes(channelPref) ? channelPref : channels[0]);
  const code = security.randomCode(6);
  const now = Date.now();
  db.get().prepare("UPDATE otp_codes SET used_at = ? WHERE customer_id = ? AND used_at IS NULL").run(now, customer.id);
  db.get().prepare('INSERT INTO otp_codes (customer_id, code_hash, channel, expires_at, created_at) VALUES (?,?,?,?,?)')
    .run(customer.id, security.hashToken(`${customer.id}:${code}`), channel, now + 10 * 60000, now);
  try { await notify.sendAccessCode(customer, channel, code); } catch (err) {
    console.error('[código de acesso] falha no envio:', err.message);
  }
  res.json(generic);
}));

router.post('/verificar', security.limiter('otp-verify', { limit: 10, windowMs: 15 * 60000 }), (req, res) => {
  const body = req.body || {};
  const code = String(body.code || '').replace(/\D/g, '');
  const invalid = () => res.status(400).json({ error: 'Código inválido ou expirado.', field: 'code' });
  if (code.length !== 6) return invalid();
  const customer = findCustomer(body.identifier);
  if (!customer) return invalid();
  const conn = db.get();
  const otp = conn.prepare('SELECT * FROM otp_codes WHERE customer_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1').get(customer.id, Date.now());
  if (!otp) return invalid();
  if (otp.attempts >= 5) { conn.prepare('UPDATE otp_codes SET used_at = ? WHERE id = ?').run(Date.now(), otp.id); return invalid(); }
  if (!security.safeEqual(otp.code_hash, security.hashToken(`${customer.id}:${code}`))) {
    conn.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(otp.id);
    return invalid();
  }
  conn.prepare('UPDATE otp_codes SET used_at = ? WHERE id = ?').run(Date.now(), otp.id);
  auth.destroySession(req, res, 'cliente');
  auth.createSession(res, 'cliente', { customerId: customer.id, ip: req.ip });
  res.json({ ok: true });
});

router.post('/sair', (req, res) => { auth.destroySession(req, res, 'cliente'); res.json({ ok: true }); });

// ---------- dados do cliente ----------
function canAccess(req, appt) {
  const s = req.clientSession;
  if (!s || !appt) return false;
  if (s.kind === 'cliente') return appt.customer_id === s.customer.id;
  return appt.id === s.appointmentId && appt.customer_id === s.customer.id;
}

function ownAppointment(req) {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const appt = booking.getAppointment(id);
  if (!canAccess(req, appt)) v.fail('Agendamento não encontrado.', null, 404);
  return appt;
}

function withActions(a) {
  const s = summarize(a);
  s.statusLabel = booking.STATUS_LABEL[a.status];
  s.canCancel = !booking.policyCheck(a, 'cancel');
  s.canReschedule = !booking.policyCheck(a, 'reschedule');
  s.cancelBlockedReason = booking.policyCheck(a, 'cancel');
  s.googleCalendar = ['pendente', 'confirmado'].includes(a.status) ? ics.googleLink(a) : null;
  s.awaitingPayment = a.status === 'pendente' && a.payment_required_cents > a.paid_cents && a.payment_expires_at > Date.now();
  return s;
}

router.get('/me', auth.requireClient(), (req, res) => {
  const s = req.clientSession;
  const conn = db.get();
  const ids = s.kind === 'cliente'
    ? conn.prepare('SELECT id FROM appointments WHERE customer_id = ? ORDER BY start_at DESC LIMIT 100').all(s.customer.id).map((r) => r.id)
    : [s.appointmentId];
  const all = ids.map((id) => booking.getAppointment(id)).filter((a) => a && canAccess(req, a));
  const now = Date.now();
  const upcoming = all.filter((a) => a.end_at >= now && ['pendente', 'confirmado'].includes(a.status)).sort((a, b) => a.start_at - b.start_at).map(withActions);
  const history = all.filter((a) => !(a.end_at >= now && ['pendente', 'confirmado'].includes(a.status))).map(withActions);
  const c = s.customer;
  res.json({
    access: s.kind === 'cliente' ? 'completo' : 'agendamento',
    customer: s.kind === 'cliente'
      ? { name: c.name, phone: fmt.phoneDisplay(c.phone), email: c.email || '', marketingConsent: !!c.marketing_consent }
      : { name: all[0] ? all[0].customer_name : c.name.split(' ')[0], phone: fmt.maskPhone(c.phone) },
    upcoming, history,
    policy: settings.section('booking').policyText,
  });
});

router.patch('/me', auth.requireClient(true), (req, res) => {
  const body = req.body || {};
  const c = req.clientSession.customer;
  const name = v.name(body.name);
  const email = v.email(body.email);
  const marketing = v.bool(body.marketingConsent);
  const now = Date.now();
  db.get().prepare('UPDATE customers SET name = ?, email = ?, marketing_consent = ?, marketing_consent_at = ?, updated_at = ? WHERE id = ?')
    .run(name, email || null, marketing ? 1 : 0, marketing ? (c.marketing_consent ? c.marketing_consent_at : now) : null, now, c.id);
  res.json({ ok: true });
});

router.post('/exclusao', auth.requireClient(true), (req, res) => {
  const c = req.clientSession.customer;
  const message = v.text((req.body || {}).message, { field: 'message', max: 1000 });
  db.get().prepare("INSERT INTO privacy_requests (name, contact, type, message, customer_id, created_at) VALUES (?,?,'exclusao',?,?,?)")
    .run(c.name, c.email || c.phone, message, c.id, Date.now());
  res.status(201).json({ ok: true });
});

router.get('/agendamentos/:id/horarios', auth.requireClient(), (req, res) => {
  const a = ownAppointment(req);
  const date = String(req.query.date || '');
  if (!time.parseDate(date)) v.fail('Data inválida.', 'date');
  const serviceIds = a.services.map((s) => s.service_id).filter(Boolean);
  if (!serviceIds.length) v.fail('Este agendamento não pode ser reagendado pelo site.', null, 422);
  const professional = req.query.professional === 'any' ? 'any' : (req.query.professional ? v.int(req.query.professional, { field: 'professional', min: 1 }) : a.professional_id);
  res.json(slotsFor({ serviceIds, professional, date, excludeAppointmentId: a.id }));
});

router.post('/agendamentos/:id/cancelar', auth.requireClient(), security.limiter('client-change', { limit: 20, windowMs: 3600000 }), (req, res) => {
  const a = ownAppointment(req);
  const updated = booking.cancelAppointment(a.id, { by: 'cliente', reason: v.text((req.body || {}).reason, { field: 'reason', max: 200 }) });
  res.json({ appointment: withActions(updated) });
});

router.post('/agendamentos/:id/reagendar', auth.requireClient(), security.limiter('client-change', { limit: 20, windowMs: 3600000 }), (req, res) => {
  const a = ownAppointment(req);
  const body = req.body || {};
  const professional = body.professional === 'any' ? 'any' : (body.professional ? v.int(body.professional, { field: 'professional', min: 1 }) : a.professional_id);
  const updated = booking.rescheduleAppointment(a.id, { date: String(body.date || ''), startTime: String(body.time || ''), professionalId: professional, by: 'cliente' });
  res.json({ appointment: withActions(updated) });
});

router.get('/agendamentos/:id/calendario.ics', auth.requireClient(), (req, res) => {
  const a = ownAppointment(req);
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="agendamento-${a.code}.ics"`);
  res.send(ics.ics(a));
});

router.post('/agendamentos/:id/pagar', auth.requireClient(), security.limiter('checkout', { limit: 10, windowMs: 3600000 }), wrap(async (req, res) => {
  const a = ownAppointment(req);
  const url = await payments.checkoutFor(a.id);
  res.json({ url });
}));

module.exports = { router, canAccess };
