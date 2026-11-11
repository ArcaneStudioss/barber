'use strict';
const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const time = require('../lib/time');
const booking = require('../lib/booking');
const availability = require('../lib/availability');
const security = require('../lib/security');
const auth = require('../lib/auth');
const settings = require('../lib/settings');
const payments = require('../lib/payments');
const notify = require('../lib/notify');
const fmt = require('../lib/format');
const config = require('../config');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const admin = auth.requireStaff('admin');
const staff = auth.requireStaff('admin', 'profissional');

// ---------- login ----------
router.post('/login', security.limiter('staff-login', { limit: 10, windowMs: 15 * 60000 }), (req, res) => {
  const { email, password } = req.body || {};
  const r = auth.staffLogin(email, String(password || ''));
  if (!r.ok) {
    return res.status(401).json({ error: r.locked ? 'Acesso bloqueado por 15 minutos após várias tentativas. Tente mais tarde.' : 'E-mail ou senha incorretos.' });
  }
  auth.destroySession(req, res, 'staff');
  auth.createSession(res, 'staff', { userId: r.user.id, ip: req.ip });
  req.staff = r.user;
  auth.audit(req, 'login', r.user.email);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => { auth.destroySession(req, res, 'staff'); res.json({ ok: true }); });

router.use(staff);

function proScope(req) {
  if (req.staff.role === 'admin') return null;
  return req.staff.professional_id || -1;
}
function assertProAccess(req, professionalId) {
  const scope = proScope(req);
  if (scope !== null && Number(professionalId) !== scope) v.fail('Você só pode acessar a sua própria agenda.', null, 403);
}

router.get('/me', (req, res) => {
  const integrations = req.staff.role === 'admin' ? config.integrations() : undefined;
  res.json({ user: req.staff, integrations, business: settings.section('business'), timezone: config.timezone, today: time.todayLocal() });
});

router.post('/me/senha', security.limiter('pw', { limit: 5, windowMs: 15 * 60000 }), (req, res) => {
  const { current, next } = req.body || {};
  const u = db.get().prepare('SELECT * FROM users WHERE id = ?').get(req.staff.id);
  if (!security.verifyPassword(String(current || ''), u.password_hash)) v.fail('Senha atual incorreta.', 'current');
  const pw = validPassword(next, 'next');
  db.get().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(security.hashPassword(pw), u.id);
  db.get().prepare("DELETE FROM sessions WHERE kind = 'staff' AND user_id = ?").run(u.id);
  auth.createSession(res, 'staff', { userId: u.id, ip: req.ip });
  auth.audit(req, 'senha_alterada', '');
  res.json({ ok: true });
});

function validPassword(pw, field = 'password') {
  const s = String(pw || '');
  if (s.length < 10) v.fail('A senha precisa ter pelo menos 10 caracteres.', field);
  if (s.length > 200) v.fail('Senha longa demais.', field);
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) v.fail('Use letras e números na senha.', field);
  return s;
}

// ---------- agendamentos ----------
function dayRange(from, to) {
  if (!time.parseDate(from) || !time.parseDate(to)) v.fail('Período inválido.', 'from');
  if (time.diffDays(from, to) < 0 || time.diffDays(from, to) > 400) v.fail('Período inválido (máximo de 400 dias).', 'from');
  return [time.localToUtc(from, 0), time.localToUtc(time.addDays(to, 1), 0)];
}

function listAppointments(req, { from, to, professional, status, q, customerId, limit = 2000 }) {
  const [a, b] = dayRange(from, to);
  const where = ['a.start_at >= ?', 'a.start_at < ?']; const params = [a, b];
  const scope = proScope(req);
  if (scope !== null) { where.push('a.professional_id = ?'); params.push(scope); } else if (professional) { where.push('a.professional_id = ?'); params.push(Number(professional)); }
  if (status) { where.push('a.status = ?'); params.push(v.oneOf(status, booking.STATUS, 'status')); }
  if (customerId) { where.push('a.customer_id = ?'); params.push(Number(customerId)); }
  if (q) { where.push('(a.customer_name LIKE ? OR c.phone LIKE ? OR a.code LIKE ?)'); const like = `%${String(q).slice(0, 60)}%`; params.push(like, `%${String(q).replace(/\D/g, '') || '§'}%`, like); }
  const rows = db.get().prepare(`SELECT a.id, a.code, a.start_at, a.end_at, a.status, a.source, a.customer_name, a.customer_id, a.professional_id,
      a.total_price_cents, a.total_duration_min, a.payment_required_cents, a.notes, p.name AS professional_name, c.phone AS customer_phone,
      (SELECT GROUP_CONCAT(name, ', ') FROM appointment_services s WHERE s.appointment_id = a.id) AS services,
      (SELECT COALESCE(SUM(amount_cents - refunded_cents),0) FROM payments pm WHERE pm.appointment_id = a.id AND pm.status IN ('aprovado','estornado')) AS paid_cents
    FROM appointments a JOIN professionals p ON p.id = a.professional_id JOIN customers c ON c.id = a.customer_id
    WHERE ${where.join(' AND ')} ORDER BY a.start_at LIMIT ${Number(limit)}`).all(...params);
  for (const r of rows) {
    const l = time.utcToLocal(r.start_at);
    r.date = l.date; r.time = l.time; r.end_time = time.utcToLocal(r.end_at).time;
  }
  return rows;
}

router.get('/dashboard', (req, res) => {
  const today = time.todayLocal();
  const date = time.parseDate(req.query.date) ? req.query.date : today;
  const list = listAppointments(req, { from: date, to: date });
  const active = list.filter((a) => a.status !== 'cancelado');
  const conn = db.get();
  const pendingPrivacy = req.staff.role === 'admin' ? conn.prepare("SELECT COUNT(*) c FROM privacy_requests WHERE status = 'aberta'").get().c : 0;
  const failedNotifications = req.staff.role === 'admin' ? conn.prepare("SELECT COUNT(*) c FROM notifications WHERE status = 'falhou' AND created_at > ?").get(Date.now() - 7 * 86400000).c : 0;
  const refundNeeded = req.staff.role === 'admin' ? conn.prepare("SELECT COUNT(*) c FROM appointment_events WHERE type = 'estorno_necessario' AND created_at > ?").get(Date.now() - 30 * 86400000).c : 0;
  res.json({
    date, today,
    appointments: list,
    counts: Object.fromEntries(booking.STATUS.map((s) => [s, list.filter((a) => a.status === s).length])),
    expected_cents: active.filter((a) => a.status !== 'nao_compareceu').reduce((s, a) => s + a.total_price_cents, 0),
    received_cents: list.reduce((s, a) => s + a.paid_cents, 0),
    alerts: { pendingPrivacy, failedNotifications, refundNeeded },
  });
});

router.get('/appointments', (req, res) => {
  const { from, to, professional, status, q, customer } = req.query;
  res.json({ appointments: listAppointments(req, { from, to, professional, status, q, customerId: customer }) });
});

function loadForStaff(req) {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const a = booking.getAppointment(id);
  if (!a) v.fail('Agendamento não encontrado.', null, 404);
  assertProAccess(req, a.professional_id);
  return a;
}

router.get('/appointments/:id', (req, res) => {
  const a = loadForStaff(req);
  const conn = db.get();
  a.events = conn.prepare('SELECT type, detail, actor, created_at FROM appointment_events WHERE appointment_id = ? ORDER BY id').all(a.id);
  a.payments = conn.prepare('SELECT id, provider, method, kind, amount_cents, refunded_cents, status, created_at FROM payments WHERE appointment_id = ? ORDER BY id').all(a.id);
  a.notifications = req.staff.role === 'admin' ? conn.prepare('SELECT channel, kind, status, scheduled_for, sent_at, last_error FROM notifications WHERE appointment_id = ? ORDER BY id').all(a.id) : [];
  a.statusLabel = booking.STATUS_LABEL[a.status];
  res.json({ appointment: a });
});

router.post('/appointments', (req, res) => {
  const body = req.body || {};
  const serviceIds = v.idList(body.services, 'services', { max: 8 });
  const professional = body.professional === 'any' ? 'any' : v.int(body.professional, { field: 'professional', min: 1 });
  const scope = proScope(req);
  if (scope !== null && professional !== scope) v.fail('Você só pode agendar na sua própria agenda.', 'professional', 403);
  let customerId = null; let customerInput;
  if (body.customerId) {
    customerId = v.int(body.customerId, { field: 'customerId', min: 1 });
    const c = db.get().prepare('SELECT * FROM customers WHERE id = ? AND anonymized_at IS NULL').get(customerId);
    if (!c) v.fail('Cliente não encontrado.', 'customerId');
    customerInput = { name: c.name, phone: c.phone, email: c.email };
  } else {
    customerInput = { name: v.name(body.name), phone: v.phoneBR(body.phone), email: v.email(body.email), marketingConsent: false };
  }
  const appt = booking.createAppointment({
    serviceIds, professionalId: professional, date: String(body.date || ''), startTime: String(body.time || ''),
    customerInput, customerId, staff: true, ignoreHours: v.bool(body.ignoreHours) && req.staff.role === 'admin',
    source: v.oneOf(body.source || 'telefone', ['telefone', 'presencial', 'whatsapp', 'painel'], 'source'),
    notes: v.text(body.notes, { field: 'notes', max: 500 }), actor: req.staff.name, staffUserId: req.staff.id,
  });
  auth.audit(req, 'agendamento_criado', appt.code);
  res.status(201).json({ appointment: appt, manageUrl: `${config.baseUrl}/cliente/acesso/${appt.manageToken}` });
});

router.post('/appointments/:id/status', (req, res) => {
  const a = loadForStaff(req);
  const status = v.oneOf((req.body || {}).status, booking.STATUS, 'status');
  const updated = booking.setStatus(a.id, status, { actor: req.staff.name, reason: v.text((req.body || {}).reason, { field: 'reason', max: 200 }) });
  auth.audit(req, 'status', `${a.code}: ${status}`);
  res.json({ appointment: updated });
});

router.post('/appointments/:id/reschedule', (req, res) => {
  const a = loadForStaff(req);
  const body = req.body || {};
  let professional = body.professional ? (body.professional === 'any' ? 'any' : v.int(body.professional, { field: 'professional', min: 1 })) : a.professional_id;
  if (proScope(req) !== null) professional = a.professional_id;
  const updated = booking.rescheduleAppointment(a.id, {
    date: String(body.date || ''), startTime: String(body.time || ''), professionalId: professional,
    by: 'barbearia', enforcePolicy: false, staff: true, ignoreHours: v.bool(body.ignoreHours) && req.staff.role === 'admin', actor: req.staff.name,
  });
  auth.audit(req, 'reagendado', a.code);
  res.json({ appointment: updated });
});

router.patch('/appointments/:id', (req, res) => {
  const a = loadForStaff(req);
  const notes = v.text((req.body || {}).notes, { field: 'notes', max: 500 });
  db.get().prepare('UPDATE appointments SET notes = ?, updated_at = ? WHERE id = ?').run(notes, Date.now(), a.id);
  res.json({ ok: true });
});

router.post('/appointments/:id/payments', (req, res) => {
  const a = loadForStaff(req);
  const body = req.body || {};
  const amountCents = v.priceToCents(body.amount, 'amount');
  if (amountCents <= 0) v.fail('Informe o valor recebido.', 'amount');
  payments.recordCounterPayment(a.id, { amountCents, method: v.oneOf(body.method, ['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'outro'], 'method'), userId: req.staff.id, actor: req.staff.name });
  auth.audit(req, 'pagamento_registrado', `${a.code}: ${amountCents}`);
  res.status(201).json({ ok: true });
});

router.post('/payments/:id/refund', admin, wrap(async (req, res) => {
  await payments.refund(v.int(req.params.id, { field: 'id', min: 1 }), req.staff.name);
  auth.audit(req, 'estorno', req.params.id);
  res.json({ ok: true });
}));

router.get('/availability', (req, res) => {
  const serviceIds = v.idList(String(req.query.services || '').split(',').filter(Boolean), 'services', { max: 8 });
  const date = String(req.query.date || '');
  if (!time.parseDate(date)) v.fail('Data inválida.', 'date');
  let professional = req.query.professional === 'any' ? 'any' : v.int(req.query.professional, { field: 'professional', min: 1 });
  const scope = proScope(req);
  if (scope !== null) professional = scope;
  const exclude = req.query.exclude ? v.int(req.query.exclude, { field: 'exclude', min: 1 }) : undefined;
  const services = booking.loadServices(serviceIds, { activeOnly: false });
  const { duration } = booking.totals(services);
  const opts = { enforceRules: false, excludeAppointmentId: exclude, now: Date.now() };
  let slots;
  if (professional === 'any') {
    const pros = availability.eligibleProfessionals(serviceIds, { onlineOnly: false });
    slots = availability.anySlots(pros, date, duration, opts).map((s) => time.utcToLocal(s.start).time);
  } else {
    slots = availability.slotsFor(professional, date, duration, opts).map((t) => time.utcToLocal(t).time);
  }
  res.json({ duration, slots });
});

// ---------- serviços ----------
router.get('/services', (req, res) => {
  res.json({ services: db.get().prepare('SELECT * FROM services ORDER BY active DESC, sort, name').all() });
});

function serviceFromBody(body) {
  return {
    name: v.text(body.name, { field: 'name', label: 'o nome do serviço', min: 2, max: 80, required: true }),
    description: v.text(body.description, { field: 'description', max: 400 }),
    price_cents: v.priceToCents(body.price, 'price'),
    duration_min: v.int(body.duration_min, { field: 'duration_min', label: 'Duração', min: 5, max: 600 }),
    active: v.bool(body.active) ? 1 : 0,
    featured: v.bool(body.featured) ? 1 : 0,
    sort: v.int(body.sort ?? 0, { field: 'sort', min: 0, max: 999 }),
  };
}

router.post('/services', admin, (req, res) => {
  const s = serviceFromBody(req.body || {});
  const r = db.get().prepare('INSERT INTO services (name, description, price_cents, duration_min, active, featured, sort, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(s.name, s.description, s.price_cents, s.duration_min, s.active, s.featured, s.sort, Date.now());
  auth.audit(req, 'servico_criado', s.name);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.put('/services/:id', admin, (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const s = serviceFromBody(req.body || {});
  const r = db.get().prepare('UPDATE services SET name=?, description=?, price_cents=?, duration_min=?, active=?, featured=?, sort=?, is_demo=0 WHERE id=?')
    .run(s.name, s.description, s.price_cents, s.duration_min, s.active, s.featured, s.sort, id);
  if (!r.changes) v.fail('Serviço não encontrado.', null, 404);
  auth.audit(req, 'servico_editado', s.name);
  res.json({ ok: true });
});

// ---------- profissionais ----------
router.get('/professionals', (req, res) => {
  const conn = db.get();
  const scope = proScope(req);
  const pros = conn.prepare(`SELECT * FROM professionals ${scope !== null ? 'WHERE id = ?' : ''} ORDER BY active DESC, sort, name`).all(...(scope !== null ? [scope] : []));
  for (const p of pros) {
    p.services = conn.prepare('SELECT service_id FROM professional_services WHERE professional_id = ?').all(p.id).map((r) => r.service_id);
    p.hours = conn.prepare('SELECT weekday, start_min, end_min, break_start_min, break_end_min FROM professional_hours WHERE professional_id = ? ORDER BY weekday').all(p.id);
  }
  res.json({ professionals: pros });
});

function saveProfessional(conn, id, body) {
  const p = {
    name: v.text(body.name, { field: 'name', label: 'o nome', min: 2, max: 80, required: true }),
    role_title: v.text(body.role_title, { field: 'role_title', max: 60 }),
    bio: v.text(body.bio, { field: 'bio', max: 600 }),
    specialties: v.text(body.specialties, { field: 'specialties', max: 200 }),
    photo: v.text(body.photo, { field: 'photo', max: 300 }),
    active: v.bool(body.active) ? 1 : 0,
    online_booking: v.bool(body.online_booking) ? 1 : 0,
    sort: v.int(body.sort ?? 0, { field: 'sort', min: 0, max: 999 }),
  };
  if (p.photo && !/^\/(img|uploads)\/[\w./-]+$/.test(p.photo) && !/^https:\/\/[\w.-]+\/[\w./%-]*$/.test(p.photo)) v.fail('Endereço da foto inválido.', 'photo');
  const serviceIds = Array.isArray(body.services) ? body.services.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  const hours = Array.isArray(body.hours) ? body.hours : [];
  let pid = id;
  if (id) {
    const r = conn.prepare('UPDATE professionals SET name=?, role_title=?, bio=?, specialties=?, photo=?, active=?, online_booking=?, sort=?, is_demo=0 WHERE id=?')
      .run(p.name, p.role_title, p.bio, p.specialties, p.photo, p.active, p.online_booking, p.sort, id);
    if (!r.changes) v.fail('Profissional não encontrado.', null, 404);
  } else {
    pid = Number(conn.prepare('INSERT INTO professionals (name, role_title, bio, specialties, photo, active, online_booking, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(p.name, p.role_title, p.bio, p.specialties, p.photo, p.active, p.online_booking, p.sort, Date.now()).lastInsertRowid);
  }
  conn.prepare('DELETE FROM professional_services WHERE professional_id = ?').run(pid);
  for (const sid of new Set(serviceIds)) {
    if (conn.prepare('SELECT 1 FROM services WHERE id = ?').get(sid)) conn.prepare('INSERT INTO professional_services VALUES (?, ?)').run(pid, sid);
  }
  conn.prepare('DELETE FROM professional_hours WHERE professional_id = ?').run(pid);
  for (const h of hours) {
    const weekday = v.int(h.weekday, { field: 'hours', min: 0, max: 6 });
    const start = time.hhmmToMinutes(h.start); const end = time.hhmmToMinutes(h.end);
    if (start === null || end === null || end <= start) v.fail(`Horário inválido em ${time.WEEKDAY_NAMES[weekday]}.`, 'hours');
    let bs = h.break_start ? time.hhmmToMinutes(h.break_start) : null; let be = h.break_end ? time.hhmmToMinutes(h.break_end) : null;
    if ((bs === null) !== (be === null)) v.fail(`Informe início e fim do intervalo em ${time.WEEKDAY_NAMES[weekday]}.`, 'hours');
    if (bs !== null && (be <= bs || bs < start || be > end)) v.fail(`Intervalo fora do expediente em ${time.WEEKDAY_NAMES[weekday]}.`, 'hours');
    conn.prepare('INSERT OR REPLACE INTO professional_hours VALUES (?,?,?,?,?,?)').run(pid, weekday, start, end, bs, be);
  }
  return pid;
}

router.post('/professionals', admin, (req, res) => {
  const id = db.tx((conn) => saveProfessional(conn, null, req.body || {}));
  auth.audit(req, 'profissional_criado', String(id));
  res.status(201).json({ id });
});
router.put('/professionals/:id', admin, (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  db.tx((conn) => saveProfessional(conn, id, req.body || {}));
  auth.audit(req, 'profissional_editado', String(id));
  res.json({ ok: true });
});

// ---------- horário de funcionamento e feriados ----------
router.get('/business-hours', (req, res) => {
  res.json({ hours: db.get().prepare('SELECT * FROM business_hours ORDER BY weekday').all() });
});
router.put('/business-hours', admin, (req, res) => {
  const list = Array.isArray((req.body || {}).hours) ? req.body.hours : v.fail('Dados inválidos.', 'hours');
  db.tx((conn) => {
    for (const h of list) {
      const weekday = v.int(h.weekday, { field: 'hours', min: 0, max: 6 });
      const closed = v.bool(h.closed);
      const open = closed ? 540 : time.hhmmToMinutes(h.open); const close = closed ? 1140 : time.hhmmToMinutes(h.close);
      if (open === null || close === null || close <= open) v.fail(`Horário inválido em ${time.WEEKDAY_NAMES[weekday]}.`, 'hours');
      conn.prepare('INSERT OR REPLACE INTO business_hours (weekday, closed, open_min, close_min) VALUES (?,?,?,?)').run(weekday, closed ? 1 : 0, open, close);
    }
  });
  auth.audit(req, 'funcionamento_editado', '');
  res.json({ ok: true });
});

router.get('/holidays', (req, res) => {
  res.json({ holidays: db.get().prepare('SELECT * FROM holidays WHERE date >= ? ORDER BY date').all(time.addDays(time.todayLocal(), -30)) });
});
router.post('/holidays', admin, (req, res) => {
  const date = String((req.body || {}).date || '');
  if (!time.parseDate(date)) v.fail('Data inválida.', 'date');
  const name = v.text(req.body.name, { field: 'name', label: 'o nome do feriado', min: 2, max: 80, required: true });
  db.get().prepare('INSERT OR REPLACE INTO holidays (date, name) VALUES (?, ?)').run(date, name);
  res.status(201).json({ ok: true, conflicts: conflictsOn(date) });
});
router.delete('/holidays/:date', admin, (req, res) => {
  db.get().prepare('DELETE FROM holidays WHERE date = ?').run(String(req.params.date));
  res.json({ ok: true });
});

function conflictsOn(date, professionalId) {
  const [a, b] = [time.localToUtc(date, 0), time.localToUtc(time.addDays(date, 1), 0)];
  return db.get().prepare(`SELECT code FROM appointments WHERE status IN ('pendente','confirmado') AND start_at < ? AND end_at > ? ${professionalId ? 'AND professional_id = ?' : ''}`)
    .all(b, a, ...(professionalId ? [professionalId] : [])).map((r) => r.code);
}

// ---------- folgas e bloqueios ----------
router.get('/time-off', (req, res) => {
  const from = time.parseDate(req.query.from) ? req.query.from : time.todayLocal();
  const to = time.parseDate(req.query.to) ? req.query.to : time.addDays(from, 90);
  const [a, b] = dayRange(from, to);
  const scope = proScope(req);
  const rows = db.get().prepare(`SELECT t.*, p.name AS professional_name FROM time_off t LEFT JOIN professionals p ON p.id = t.professional_id
    WHERE t.start_at < ? AND t.end_at > ? ${scope !== null ? 'AND (t.professional_id = ? OR t.professional_id IS NULL)' : ''} ORDER BY t.start_at`)
    .all(b, a, ...(scope !== null ? [scope] : []));
  for (const r of rows) {
    const s = time.utcToLocal(r.start_at); const e = time.utcToLocal(r.end_at);
    r.start_date = s.date; r.start_time = s.time; r.end_date = e.date; r.end_time = e.time;
  }
  res.json({ timeOff: rows });
});

router.post('/time-off', (req, res) => {
  const body = req.body || {};
  let professionalId = body.professional_id ? v.int(body.professional_id, { field: 'professional_id', min: 1 }) : null;
  const scope = proScope(req);
  if (scope !== null) professionalId = scope;
  const kind = v.oneOf(body.kind || 'bloqueio', ['bloqueio', 'folga', 'ferias', 'intervalo'], 'kind');
  const sd = String(body.start_date || ''); const ed = String(body.end_date || sd);
  if (!time.parseDate(sd) || !time.parseDate(ed)) v.fail('Data inválida.', 'start_date');
  const allDay = v.bool(body.all_day);
  const st = allDay ? 0 : time.hhmmToMinutes(body.start_time); const et = allDay ? 0 : time.hhmmToMinutes(body.end_time);
  if (st === null || et === null) v.fail('Horário inválido.', 'start_time');
  const startAt = time.localToUtc(sd, st);
  const endAt = allDay ? time.localToUtc(time.addDays(ed, 1), 0) : time.localToUtc(ed, et);
  if (endAt <= startAt) v.fail('O fim precisa ser depois do início.', 'end_time');
  const reason = v.text(body.reason, { field: 'reason', max: 120 });
  const r = db.get().prepare('INSERT INTO time_off (professional_id, start_at, end_at, kind, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(professionalId, startAt, endAt, kind, reason, req.staff.id, Date.now());
  const conflicts = db.get().prepare(`SELECT code FROM appointments WHERE status IN ('pendente','confirmado') AND start_at < ? AND end_at > ? ${professionalId ? 'AND professional_id = ?' : ''}`)
    .all(endAt, startAt, ...(professionalId ? [professionalId] : [])).map((x) => x.code);
  auth.audit(req, 'bloqueio_criado', `${sd} ${kind}`);
  res.status(201).json({ id: Number(r.lastInsertRowid), conflicts });
});

router.delete('/time-off/:id', (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const row = db.get().prepare('SELECT * FROM time_off WHERE id = ?').get(id);
  if (!row) v.fail('Bloqueio não encontrado.', null, 404);
  const scope = proScope(req);
  if (scope !== null && row.professional_id !== scope) v.fail('Você só pode remover bloqueios da sua agenda.', null, 403);
  db.get().prepare('DELETE FROM time_off WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- clientes ----------
router.get('/customers', (req, res) => {
  const q = String(req.query.q || '').slice(0, 60);
  const scope = proScope(req);
  const where = ['c.anonymized_at IS NULL']; const params = [];
  if (q) { where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)'); params.push(`%${q}%`, `%${q.replace(/\D/g, '') || '§'}%`, `%${q}%`); }
  if (scope !== null) { where.push('EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.id AND a.professional_id = ?)'); params.push(scope); }
  const rows = db.get().prepare(`SELECT c.id, c.name, c.phone, ${scope === null ? 'c.email, c.marketing_consent, c.created_at,' : ''}
      (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id AND a.status = 'concluido') AS visits,
      (SELECT MAX(start_at) FROM appointments a WHERE a.customer_id = c.id AND a.status IN ('concluido','confirmado','pendente')) AS last_visit
    FROM customers c WHERE ${where.join(' AND ')} ORDER BY c.name LIMIT 300`).all(...params);
  res.json({ customers: rows });
});

router.get('/customers/:id', (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const scope = proScope(req);
  const conn = db.get();
  const c = conn.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) v.fail('Cliente não encontrado.', null, 404);
  if (scope !== null && !conn.prepare('SELECT 1 FROM appointments WHERE customer_id = ? AND professional_id = ?').get(id, scope)) v.fail('Cliente não encontrado.', null, 404);
  const history = listAppointments(req, { from: '2000-01-01', to: time.addDays(time.todayLocal(), 365), customerId: id, limit: 200 }).reverse();
  const customer = scope === null ? c : { id: c.id, name: c.name, phone: c.phone, notes: c.notes };
  res.json({ customer, history });
});

router.put('/customers/:id', admin, (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const body = req.body || {};
  const name = v.name(body.name); const phone = v.phoneBR(body.phone); const email = v.email(body.email);
  const notes = v.text(body.notes, { field: 'notes', max: 1000 });
  try {
    const r = db.get().prepare('UPDATE customers SET name=?, phone=?, email=?, notes=?, updated_at=? WHERE id=? AND anonymized_at IS NULL').run(name, phone, email || null, notes, Date.now(), id);
    if (!r.changes) v.fail('Cliente não encontrado.', null, 404);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) v.fail('Já existe outro cliente com esse telefone.', 'phone');
    throw err;
  }
  auth.audit(req, 'cliente_editado', String(id));
  res.json({ ok: true });
});

// Exclusão (LGPD): anonimiza dados pessoais e mantém os registros financeiros sem identificação.
router.post('/customers/:id/anonymize', admin, (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const now = Date.now();
  db.tx((conn) => {
    const c = conn.prepare('SELECT * FROM customers WHERE id = ? AND anonymized_at IS NULL').get(id);
    if (!c) v.fail('Cliente não encontrado.', null, 404);
    conn.prepare("UPDATE appointments SET status = 'cancelado', cancelled_at = ?, cancel_reason = 'Exclusão de dados (LGPD)', cancelled_by = 'barbearia', updated_at = ? WHERE customer_id = ? AND status IN ('pendente','confirmado')").run(now, now, id);
    conn.prepare("UPDATE appointments SET customer_name = 'Cliente removido', notes = '', manage_token_hash = NULL WHERE customer_id = ?").run(id);
    conn.prepare("UPDATE customers SET name = 'Cliente removido', phone = ?, email = NULL, notes = '', marketing_consent = 0, anonymized_at = ?, updated_at = ? WHERE id = ?").run(`removido-${id}`, now, now, id);
    conn.prepare('DELETE FROM notifications WHERE customer_id = ?').run(id);
    conn.prepare('DELETE FROM sessions WHERE customer_id = ?').run(id);
    conn.prepare('DELETE FROM otp_codes WHERE customer_id = ?').run(id);
  });
  auth.audit(req, 'cliente_anonimizado', String(id));
  res.json({ ok: true });
});

// ---------- configurações ----------
router.get('/settings', admin, (req, res) => {
  res.json({ settings: settings.all(), integrations: config.integrations(), baseUrl: config.baseUrl, webhookUrl: `${config.baseUrl}/webhooks/mercadopago` });
});

router.put('/settings/:section', admin, (req, res) => {
  const section = v.oneOf(req.params.section, ['business', 'booking', 'notifications', 'payments'], 'section');
  const b = req.body || {};
  let value;
  if (section === 'business') {
    const t = (k, max = 160) => v.text(b[k], { field: k, max });
    value = {
      name: v.text(b.name, { field: 'name', label: 'o nome', min: 2, max: 80, required: true }),
      tagline: t('tagline'), description: t('description', 800), city: t('city', 80), state: t('state', 2).toUpperCase(),
      neighborhood: t('neighborhood', 80), street: t('street', 120), postalCode: t('postalCode', 12),
      phone: b.phone ? v.phoneBR(b.phone, 'phone') : '', whatsapp: b.whatsapp ? v.phoneBR(b.whatsapp, 'whatsapp') : '',
      email: v.email(b.email), instagram: t('instagram', 40).replace(/^@/, ''),
      mapEmbedUrl: t('mapEmbedUrl', 1000), mapLinkUrl: t('mapLinkUrl', 500),
      latitude: t('latitude', 20), longitude: t('longitude', 20), cnpj: t('cnpj', 20), legalName: t('legalName', 120),
      dpoContact: t('dpoContact', 120),
    };
    if (value.instagram && !/^[\w.]{1,30}$/.test(value.instagram)) v.fail('Usuário do Instagram inválido.', 'instagram');
    if (value.mapEmbedUrl && !/^https:\/\/www\.google\.com\/maps\/embed\?/.test(value.mapEmbedUrl)) v.fail('Use o link de incorporação do Google Maps (começa com https://www.google.com/maps/embed?).', 'mapEmbedUrl');
    if (value.mapLinkUrl && !/^https:\/\//.test(value.mapLinkUrl)) v.fail('O link do mapa precisa começar com https://', 'mapLinkUrl');
    for (const k of ['latitude', 'longitude']) if (value[k] && !/^-?\d{1,3}\.\d+$/.test(value[k])) v.fail('Coordenada inválida (ex.: -23.5505).', k);
  } else if (section === 'booking') {
    const i = (k, min, max, label) => v.int(b[k], { field: k, min, max, label });
    value = {
      slotStepMin: v.oneOf(Number(b.slotStepMin), [5, 10, 15, 20, 30, 60], 'slotStepMin'),
      minAdvanceMin: i('minAdvanceMin', 0, 10080, 'Antecedência mínima'),
      maxDaysAhead: i('maxDaysAhead', 1, 180, 'Limite de dias'),
      autoConfirm: v.bool(b.autoConfirm),
      cancelMinHours: i('cancelMinHours', 0, 168, 'Prazo de cancelamento'),
      rescheduleMinHours: i('rescheduleMinHours', 0, 168, 'Prazo de reagendamento'),
      maxReschedules: i('maxReschedules', 0, 10, 'Limite de reagendamentos'),
      allowClientCancel: v.bool(b.allowClientCancel), allowClientReschedule: v.bool(b.allowClientReschedule),
      maxServicesPerBooking: i('maxServicesPerBooking', 1, 8, 'Máximo de serviços'),
      policyText: v.text(b.policyText, { field: 'policyText', max: 1000 }),
    };
  } else if (section === 'notifications') {
    const hours = Array.isArray(b.reminderHoursBefore) ? b.reminderHoursBefore : String(b.reminderHoursBefore || '').split(',');
    const list = [...new Set(hours.map((h) => Number(String(h).trim())).filter((h) => Number.isInteger(h) && h >= 1 && h <= 168))].sort((x, y) => y - x).slice(0, 3);
    value = { emailEnabled: v.bool(b.emailEnabled), whatsappEnabled: v.bool(b.whatsappEnabled), reminderHoursBefore: list };
  } else {
    const mode = v.oneOf(b.mode, ['desligado', 'sinal', 'integral'], 'mode');
    if (mode !== 'desligado' && !config.integrations().mercadopago.ready) v.fail(`Para ativar pagamentos, configure: ${config.integrations().mercadopago.missing.join(', ')}.`, 'mode');
    value = {
      mode, depositPercent: v.int(b.depositPercent, { field: 'depositPercent', min: 5, max: 100, label: 'Percentual do sinal' }),
      holdMinutes: v.int(b.holdMinutes, { field: 'holdMinutes', min: 10, max: 1440, label: 'Prazo para pagar' }),
    };
  }
  const saved = settings.save(section, value);
  auth.audit(req, 'configuracao', section);
  res.json({ settings: saved });
});

// ---------- relatórios ----------
function report(req, from, to) {
  const list = listAppointments(req, { from, to, limit: 100000 });
  const conn = db.get();
  const by = (k) => list.filter((a) => a.status === k);
  const done = by('concluido');
  const notCancelled = list.filter((a) => a.status !== 'cancelado');
  const expected = notCancelled.filter((a) => a.status !== 'nao_compareceu').reduce((s, a) => s + a.total_price_cents, 0);
  const doneValue = done.reduce((s, a) => s + a.total_price_cents, 0);
  const received = list.reduce((s, a) => s + a.paid_cents, 0);
  const pendingOnDone = done.reduce((s, a) => s + Math.max(0, a.total_price_cents - a.paid_cents), 0);
  const ids = notCancelled.map((a) => a.id);
  const services = {};
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    if (!chunk.length) break;
    for (const r of conn.prepare(`SELECT s.name, s.price_cents, a.status FROM appointment_services s JOIN appointments a ON a.id = s.appointment_id WHERE s.appointment_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk)) {
      services[r.name] = services[r.name] || { name: r.name, count: 0, done: 0, done_cents: 0 };
      services[r.name].count += 1;
      if (r.status === 'concluido') { services[r.name].done += 1; services[r.name].done_cents += r.price_cents; }
    }
  }
  const pros = {};
  for (const a of list) {
    pros[a.professional_name] = pros[a.professional_name] || { name: a.professional_name, total: 0, done: 0, cancelled: 0, no_show: 0, done_cents: 0 };
    const p = pros[a.professional_name];
    p.total += 1;
    if (a.status === 'concluido') { p.done += 1; p.done_cents += a.total_price_cents; }
    if (a.status === 'cancelado') p.cancelled += 1;
    if (a.status === 'nao_compareceu') p.no_show += 1;
  }
  return {
    from, to,
    counts: { total: list.length, ...Object.fromEntries(booking.STATUS.map((s) => [s, by(s).length])) },
    values: { expected_cents: expected, done_cents: doneValue, received_cents: received, pending_on_done_cents: pendingOnDone },
    services: Object.values(services).sort((a, b) => b.count - a.count),
    professionals: Object.values(pros).sort((a, b) => b.done_cents - a.done_cents),
    sources: Object.entries(list.reduce((m, a) => { m[a.source] = (m[a.source] || 0) + 1; return m; }, {})).map(([source, count]) => ({ source, count })),
  };
}

router.get('/reports', admin, (req, res) => {
  const to = time.parseDate(req.query.to) ? req.query.to : time.todayLocal();
  const from = time.parseDate(req.query.from) ? req.query.from : time.addDays(to, -29);
  res.json(report(req, from, to));
});

// ---------- exportação CSV ----------
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita injeção de fórmula em planilhas
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sendCsv(res, filename, header, rows) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`﻿${body}\r\n`);
}
const reais = (c) => ((c || 0) / 100).toFixed(2).replace('.', ',');

router.get('/export/:kind', admin, (req, res) => {
  const kind = String(req.params.kind).replace(/\.csv$/, '');
  const to = time.parseDate(req.query.to) ? req.query.to : time.todayLocal();
  const from = time.parseDate(req.query.from) ? req.query.from : time.addDays(to, -29);
  const conn = db.get();
  auth.audit(req, 'exportacao', `${kind} ${from} ${to}`);
  if (kind === 'agendamentos') {
    const rows = listAppointments(req, { from, to, limit: 100000 });
    return sendCsv(res, `agendamentos_${from}_${to}.csv`,
      ['Número', 'Data', 'Início', 'Fim', 'Status', 'Origem', 'Cliente', 'Telefone', 'Profissional', 'Serviços', 'Duração (min)', 'Valor previsto (R$)', 'Valor recebido (R$)', 'Pendente (R$)'],
      rows.map((a) => [a.code, time.formatDateBR(a.date), a.time, a.end_time, booking.STATUS_LABEL[a.status], a.source, a.customer_name, fmt.phoneDisplay(a.customer_phone), a.professional_name, a.services, a.total_duration_min,
        reais(a.status === 'cancelado' ? 0 : a.total_price_cents), reais(a.paid_cents), reais(a.status === 'concluido' ? Math.max(0, a.total_price_cents - a.paid_cents) : 0)]));
  }
  if (kind === 'clientes') {
    const rows = conn.prepare(`SELECT c.*, (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id AND a.status = 'concluido') visits
      FROM customers c WHERE c.anonymized_at IS NULL ORDER BY c.name`).all();
    return sendCsv(res, 'clientes.csv', ['Nome', 'Telefone', 'E-mail', 'Aceita marketing', 'Atendimentos concluídos', 'Cadastro'],
      rows.map((c) => [c.name, fmt.phoneDisplay(c.phone), c.email || '', c.marketing_consent ? 'Sim' : 'Não', c.visits, time.formatDateBR(time.utcToLocal(c.created_at).date)]));
  }
  if (kind === 'pagamentos') {
    const [a, b] = dayRange(from, to);
    const rows = conn.prepare(`SELECT p.*, ap.code, ap.customer_name, ap.start_at FROM payments p JOIN appointments ap ON ap.id = p.appointment_id
      WHERE ap.start_at >= ? AND ap.start_at < ? ORDER BY p.created_at`).all(a, b);
    return sendCsv(res, `pagamentos_${from}_${to}.csv`, ['Agendamento', 'Data do atendimento', 'Cliente', 'Origem', 'Forma', 'Tipo', 'Valor (R$)', 'Estornado (R$)', 'Status', 'Registrado em'],
      rows.map((p) => [p.code, time.formatDateTimeBR(p.start_at), p.customer_name, p.provider === 'balcao' ? 'Balcão' : 'Mercado Pago', p.method, p.kind, reais(p.amount_cents), reais(p.refunded_cents), p.status, time.formatDateTimeBR(p.created_at)]));
  }
  if (kind === 'servicos') {
    const r = report(req, from, to);
    return sendCsv(res, `servicos_${from}_${to}.csv`, ['Serviço', 'Agendados', 'Concluídos', 'Valor concluído (R$)'], r.services.map((s) => [s.name, s.count, s.done, reais(s.done_cents)]));
  }
  v.fail('Exportação inválida.', null, 404);
});

// ---------- notificações, pedidos LGPD, usuários, auditoria ----------
router.get('/notifications', admin, (req, res) => {
  const rows = db.get().prepare(`SELECT n.id, n.channel, n.kind, n.status, n.scheduled_for, n.sent_at, n.attempts, n.last_error, a.code
    FROM notifications n LEFT JOIN appointments a ON a.id = n.appointment_id ORDER BY n.id DESC LIMIT 200`).all();
  res.json({ notifications: rows, integrations: config.integrations() });
});

router.post('/notifications/process', admin, wrap(async (req, res) => {
  res.json({ processed: await notify.processDue() });
}));

router.get('/privacy-requests', admin, (req, res) => {
  res.json({ requests: db.get().prepare('SELECT * FROM privacy_requests ORDER BY status, id DESC LIMIT 200').all() });
});
router.put('/privacy-requests/:id', admin, (req, res) => {
  const status = v.oneOf((req.body || {}).status, ['aberta', 'concluida', 'recusada'], 'status');
  db.get().prepare('UPDATE privacy_requests SET status = ?, resolved_at = ? WHERE id = ?').run(status, status === 'aberta' ? null : Date.now(), v.int(req.params.id, { field: 'id', min: 1 }));
  auth.audit(req, 'pedido_lgpd', `${req.params.id}: ${status}`);
  res.json({ ok: true });
});

router.get('/users', admin, (req, res) => {
  res.json({ users: db.get().prepare('SELECT id, name, email, role, professional_id, active, last_login_at, created_at FROM users ORDER BY name').all() });
});

router.post('/users', admin, (req, res) => {
  const b = req.body || {};
  const role = v.oneOf(b.role, ['admin', 'profissional'], 'role');
  const professionalId = role === 'profissional' ? v.int(b.professional_id, { field: 'professional_id', min: 1, label: 'Profissional' }) : null;
  try {
    const r = db.get().prepare('INSERT INTO users (name, email, password_hash, role, professional_id, created_at) VALUES (?,?,?,?,?,?)')
      .run(v.name(b.name), v.email(b.email, 'email', { required: true }), security.hashPassword(validPassword(b.password)), role, professionalId, Date.now());
    auth.audit(req, 'usuario_criado', b.email);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) v.fail('Já existe um usuário com esse e-mail.', 'email');
    throw err;
  }
});

router.put('/users/:id', admin, (req, res) => {
  const id = v.int(req.params.id, { field: 'id', min: 1 });
  const b = req.body || {};
  const role = v.oneOf(b.role, ['admin', 'profissional'], 'role');
  const active = v.bool(b.active) ? 1 : 0;
  if (id === req.staff.id && (!active || role !== 'admin')) v.fail('Você não pode remover o seu próprio acesso de administrador.', 'role');
  const professionalId = role === 'profissional' ? v.int(b.professional_id, { field: 'professional_id', min: 1, label: 'Profissional' }) : null;
  const conn = db.get();
  conn.prepare('UPDATE users SET name = ?, role = ?, professional_id = ?, active = ? WHERE id = ?').run(v.name(b.name), role, professionalId, active, id);
  if (b.password) conn.prepare('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').run(security.hashPassword(validPassword(b.password)), id);
  if (!active || b.password) conn.prepare("DELETE FROM sessions WHERE kind = 'staff' AND user_id = ?").run(id);
  auth.audit(req, 'usuario_editado', String(id));
  res.json({ ok: true });
});

router.get('/audit', admin, (req, res) => {
  res.json({ log: db.get().prepare('SELECT l.*, u.name AS user_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 200').all() });
});

module.exports = { router, report, csvCell };
