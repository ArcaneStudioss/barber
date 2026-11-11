'use strict';
const express = require('express');
const db = require('../db');
const v = require('../lib/validate');
const time = require('../lib/time');
const settings = require('../lib/settings');
const availability = require('../lib/availability');
const booking = require('../lib/booking');
const security = require('../lib/security');
const auth = require('../lib/auth');
const config = require('../config');

const router = express.Router();

function publicCatalog() {
  const conn = db.get();
  const services = conn.prepare('SELECT id, name, description, price_cents, duration_min, featured FROM services WHERE active = 1 ORDER BY sort, name').all();
  const pros = conn.prepare('SELECT id, name, role_title, specialties, photo FROM professionals WHERE active = 1 AND online_booking = 1 ORDER BY sort, name').all();
  const links = conn.prepare('SELECT professional_id, service_id FROM professional_services').all();
  for (const p of pros) p.services = links.filter((l) => l.professional_id === p.id).map((l) => l.service_id);
  const b = settings.section('booking');
  const pay = settings.section('payments');
  const payReady = config.integrations().mercadopago.ready && pay.mode !== 'desligado';
  const w = availability.bookingWindow();
  return {
    services, professionals: pros,
    rules: {
      today: w.today, lastDate: w.lastDate, minAdvanceMin: b.minAdvanceMin, maxServices: b.maxServicesPerBooking,
      policyText: b.policyText, cancelMinHours: b.cancelMinHours,
    },
    payment: payReady ? { mode: pay.mode, depositPercent: pay.depositPercent, holdMinutes: pay.holdMinutes } : null,
  };
}

router.get('/catalog', (req, res) => res.json(publicCatalog()));

function parseServicesQuery(q) {
  return v.idList(String(q || '').split(',').filter(Boolean), 'services', { max: settings.section('booking').maxServicesPerBooking });
}

function slotsFor({ serviceIds, professional, date, excludeAppointmentId, staff = false }) {
  const services = booking.loadServices(serviceIds, { activeOnly: !staff });
  const { duration } = booking.totals(services);
  const pros = availability.eligibleProfessionals(serviceIds, { onlineOnly: !staff });
  const opts = { enforceRules: !staff, excludeAppointmentId };
  if (professional === 'any') {
    return { duration, slots: availability.anySlots(pros, date, duration, opts).map((s) => ({ time: time.utcToLocal(s.start).time })) };
  }
  const id = Number(professional);
  if (!pros.some((p) => p.id === id)) v.fail('Esse profissional não realiza todos os serviços escolhidos.', 'professional');
  return { duration, slots: availability.slotsFor(id, date, duration, opts).map((t) => ({ time: time.utcToLocal(t).time })) };
}

router.get('/availability', security.limiter('avail', { limit: 120, windowMs: 60000 }), (req, res) => {
  const serviceIds = parseServicesQuery(req.query.services);
  const date = String(req.query.date || '');
  if (!time.parseDate(date)) v.fail('Data inválida.', 'date');
  const professional = req.query.professional === 'any' ? 'any' : v.int(req.query.professional, { field: 'professional', min: 1 });
  res.json(slotsFor({ serviceIds, professional, date }));
});

// Dias do período com pelo menos um horário livre (para desabilitar dias no calendário)
router.get('/availability/days', security.limiter('avail-days', { limit: 40, windowMs: 60000 }), (req, res) => {
  const serviceIds = parseServicesQuery(req.query.services);
  const professional = req.query.professional === 'any' ? 'any' : v.int(req.query.professional, { field: 'professional', min: 1 });
  const w = availability.bookingWindow();
  const days = [];
  for (let d = w.today; d <= w.lastDate; d = time.addDays(d, 1)) {
    if (slotsFor({ serviceIds, professional, date: d }).slots.length) days.push(d);
  }
  res.json({ from: w.today, to: w.lastDate, days });
});

router.post('/bookings', security.limiter('booking', { limit: 8, windowMs: 3600000 }), (req, res) => {
  const body = req.body || {};
  // Campo isca: robôs preenchem, pessoas não veem.
  if (body.website) v.fail('Não foi possível concluir o agendamento.', null, 400);
  const b = settings.section('booking');
  const serviceIds = v.idList(body.services, 'services', { max: b.maxServicesPerBooking });
  const professional = body.professional === 'any' ? 'any' : v.int(body.professional, { field: 'professional', min: 1 });
  const date = String(body.date || '');
  const startTime = String(body.time || '');
  const session = req.clientSession && req.clientSession.kind === 'cliente' ? req.clientSession : null;

  let customerInput; let customerId = null;
  if (session) {
    customerId = session.customer.id;
    customerInput = { name: v.name(body.name || session.customer.name), phone: session.customer.phone, email: session.customer.email };
  } else {
    if (!v.bool(body.privacyAccepted)) v.fail('Para agendar, é preciso concordar com a Política de Privacidade.', 'privacyAccepted');
    customerInput = {
      name: v.name(body.name),
      phone: v.phoneBR(body.phone),
      email: v.email(body.email),
      marketingConsent: v.bool(body.marketingConsent),
    };
    // limite por telefone: evita que alguém lote a agenda com o mesmo número
    const perPhone = security.rateLimit(`booking-phone:${customerInput.phone}`, { limit: 4, windowMs: 86400000 });
    if (!perPhone.ok) v.fail('Muitos agendamentos para este telefone hoje. Fale com a barbearia pelo WhatsApp.', 'phone', 429);
  }
  const notes = v.text(body.notes, { field: 'notes', label: 'Observação', max: 300 });

  const appt = booking.createAppointment({
    serviceIds, professionalId: professional, date, startTime, customerInput, customerId, notes, source: 'online', actor: 'cliente',
  });

  if (!session) auth.createSession(res, 'agendamento', { customerId: appt.customer_id, appointmentId: appt.id, ip: req.ip });

  res.status(201).json({
    appointment: summarize(appt),
    manageUrl: `${config.baseUrl}/cliente/acesso/${appt.manageToken}`,
    paymentRequired: appt.payment_required_cents > 0,
  });
});

function summarize(a) {
  return {
    id: a.id, code: a.code, status: a.status, date: a.date, time: a.time, endTime: a.end_time,
    professional: a.professional_name, professionalId: a.professional_id, customerName: a.customer_name,
    services: a.services.map((s) => ({ id: s.service_id, name: s.name, price_cents: s.price_cents, duration_min: s.duration_min })),
    total_price_cents: a.total_price_cents, total_duration_min: a.total_duration_min,
    payment_required_cents: a.payment_required_cents, paid_cents: a.paid_cents,
    payment_expires_at: a.payment_expires_at, start_at: a.start_at,
  };
}

// Pedido de titular (LGPD): acesso, correção, exclusão etc.
router.post('/privacidade', security.limiter('privacy', { limit: 5, windowMs: 3600000 }), (req, res) => {
  const body = req.body || {};
  if (body.website) v.fail('Não foi possível enviar.', null);
  const name = v.name(body.name);
  const contact = v.text(body.contact, { field: 'contact', label: 'telefone ou e-mail', min: 6, max: 120, required: true });
  const type = v.oneOf(body.type, ['acesso', 'correcao', 'exclusao', 'revogar_marketing', 'outro'], 'type');
  const message = v.text(body.message, { field: 'message', label: 'Mensagem', max: 1000 });
  db.get().prepare('INSERT INTO privacy_requests (name, contact, type, message, created_at) VALUES (?,?,?,?,?)').run(name, contact, type, message, Date.now());
  res.status(201).json({ ok: true });
});

module.exports = { router, summarize, slotsFor, publicCatalog };
