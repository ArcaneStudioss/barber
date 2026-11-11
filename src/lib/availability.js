'use strict';
// Cálculo de horários livres: expediente do profissional ∩ funcionamento da barbearia,
// menos intervalos, feriados, folgas/bloqueios e agendamentos ativos.
const db = require('../db');
const time = require('./time');
const settings = require('./settings');

const ACTIVE_STATUSES = "('pendente','confirmado','concluido')";

function subtract(intervals, cut) {
  const out = [];
  for (const [s, e] of intervals) {
    if (cut[1] <= s || cut[0] >= e) { out.push([s, e]); continue; }
    if (cut[0] > s) out.push([s, cut[0]]);
    if (cut[1] < e) out.push([cut[1], e]);
  }
  return out;
}

function intersect(a, b) {
  const s = Math.max(a[0], b[0]); const e = Math.min(a[1], b[1]);
  return e > s ? [s, e] : null;
}

// Intervalos de trabalho (ms UTC) de um profissional numa data local, sem descontar agenda.
function workingIntervals(professionalId, dateStr) {
  const conn = db.get();
  if (conn.prepare('SELECT 1 FROM holidays WHERE date = ?').get(dateStr)) return [];
  const weekday = time.weekdayOf(dateStr);
  const shop = conn.prepare('SELECT * FROM business_hours WHERE weekday = ?').get(weekday);
  if (!shop || shop.closed) return [];
  const h = conn.prepare('SELECT * FROM professional_hours WHERE professional_id = ? AND weekday = ?').get(professionalId, weekday);
  if (!h) return [];
  const day = intersect([h.start_min, h.end_min], [shop.open_min, shop.close_min]);
  if (!day) return [];
  let mins = [day];
  if (h.break_start_min != null && h.break_end_min != null && h.break_end_min > h.break_start_min) {
    mins = subtract(mins, [h.break_start_min, h.break_end_min]);
  }
  return mins.map(([s, e]) => [time.localToUtc(dateStr, s), time.localToUtc(dateStr, e)]);
}

function busyIntervals(professionalId, fromMs, toMs, excludeAppointmentId) {
  const conn = db.get();
  const appts = conn.prepare(`SELECT start_at, end_at FROM appointments
    WHERE professional_id = ? AND status IN ${ACTIVE_STATUSES} AND start_at < ? AND end_at > ? AND id <> ?`)
    .all(professionalId, toMs, fromMs, excludeAppointmentId || 0);
  const blocks = conn.prepare(`SELECT start_at, end_at FROM time_off
    WHERE (professional_id = ? OR professional_id IS NULL) AND start_at < ? AND end_at > ?`)
    .all(professionalId, toMs, fromMs);
  return [...appts, ...blocks].map((r) => [r.start_at, r.end_at]);
}

function freeIntervals(professionalId, dateStr, { excludeAppointmentId } = {}) {
  let free = workingIntervals(professionalId, dateStr);
  if (!free.length) return [];
  const from = free[0][0]; const to = free[free.length - 1][1];
  for (const b of busyIntervals(professionalId, from, to, excludeAppointmentId)) free = subtract(free, b);
  return free;
}

function bookingWindow(now = Date.now()) {
  const b = settings.section('booking');
  const today = time.todayLocal(now);
  return {
    earliest: now + b.minAdvanceMin * 60000,
    lastDate: time.addDays(today, b.maxDaysAhead),
    today,
    step: Math.max(5, Number(b.slotStepMin) || 15),
  };
}

// Lista horários de início livres para um profissional numa data.
function slotsFor(professionalId, dateStr, durationMin, { now = Date.now(), enforceRules = true, excludeAppointmentId } = {}) {
  const w = bookingWindow(now);
  if (enforceRules && (dateStr < w.today || dateStr > w.lastDate)) return [];
  const free = freeIntervals(professionalId, dateStr, { excludeAppointmentId });
  const dur = durationMin * 60000;
  const out = [];
  for (const [s, e] of free) {
    // alinha o início à grade de minutos da barbearia (ex.: 09:00, 09:15...)
    const local = time.utcToLocal(s);
    const offset = (w.step - (local.minutes % w.step)) % w.step;
    for (let t = s + offset * 60000; t + dur <= e; t += w.step * 60000) {
      if (enforceRules && t < w.earliest) continue;
      out.push(t);
    }
  }
  return out;
}

function isSlotFree(professionalId, startMs, durationMin, { now = Date.now(), enforceRules = true, excludeAppointmentId, ignoreHours = false } = {}) {
  const endMs = startMs + durationMin * 60000;
  const local = time.utcToLocal(startMs);
  if (enforceRules) {
    const w = bookingWindow(now);
    if (startMs < w.earliest || local.date > w.lastDate) return false;
    if (local.minutes % w.step !== 0) return false;
  }
  if (ignoreHours) {
    return busyIntervals(professionalId, startMs, endMs, excludeAppointmentId).length === 0;
  }
  return freeIntervals(professionalId, local.date, { excludeAppointmentId })
    .some(([s, e]) => startMs >= s && endMs <= e);
}

// Profissionais que fazem TODOS os serviços escolhidos.
function eligibleProfessionals(serviceIds, { onlineOnly = true } = {}) {
  const conn = db.get();
  const ids = [...new Set(serviceIds.map(Number))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return conn.prepare(`SELECT p.* FROM professionals p
    WHERE p.active = 1 ${onlineOnly ? 'AND p.online_booking = 1' : ''}
      AND (SELECT COUNT(*) FROM professional_services ps WHERE ps.professional_id = p.id AND ps.service_id IN (${placeholders})) = ?
    ORDER BY p.sort, p.name`).all(...ids, ids.length);
}

// Para "qualquer profissional": junta os horários de todos e escolhe quem tem menos atendimentos no dia.
function anySlots(professionals, dateStr, durationMin, opts = {}) {
  const map = new Map();
  for (const p of professionals) {
    for (const t of slotsFor(p.id, dateStr, durationMin, opts)) {
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(p.id);
    }
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([t, pros]) => ({ start: t, professionals: pros }));
}

function pickLeastBusy(professionalIds, dateStr) {
  const conn = db.get();
  const from = time.localToUtc(dateStr, 0); const to = time.localToUtc(time.addDays(dateStr, 1), 0);
  let best = null; let bestCount = Infinity;
  for (const id of professionalIds) {
    const { c } = conn.prepare(`SELECT COUNT(*) c FROM appointments WHERE professional_id = ? AND status IN ${ACTIVE_STATUSES} AND start_at >= ? AND start_at < ?`).get(id, from, to);
    if (c < bestCount) { best = id; bestCount = c; }
  }
  return best;
}

module.exports = { slotsFor, isSlotFree, eligibleProfessionals, anySlots, pickLeastBusy, bookingWindow, workingIntervals, freeIntervals, subtract };
