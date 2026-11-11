'use strict';
// Regras de negócio do agendamento. Toda escrita acontece em transação exclusiva
// e o banco ainda tem um gatilho que recusa sobreposição (dupla proteção).
const db = require('../db');
const time = require('./time');
const settings = require('./settings');
const availability = require('./availability');
const security = require('./security');
const { HttpError, fail } = require('./validate');

const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
function newCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[require('node:crypto').randomInt(CODE_ALPHABET.length)];
  return `BE-${s}`;
}

function loadServices(serviceIds, { activeOnly = true } = {}) {
  const conn = db.get();
  const rows = serviceIds.map((id) => conn.prepare(`SELECT * FROM services WHERE id = ? ${activeOnly ? 'AND active = 1' : ''}`).get(id));
  if (rows.some((r) => !r)) fail('Um dos serviços escolhidos não está disponível.', 'services');
  return rows;
}

function totals(services) {
  return {
    duration: services.reduce((a, s) => a + s.duration_min, 0),
    price: services.reduce((a, s) => a + s.price_cents, 0),
  };
}

function paymentRequirement(totalCents) {
  const p = settings.section('payments');
  const ready = require('../config').integrations().mercadopago.ready;
  if (!ready || p.mode === 'desligado' || totalCents <= 0) return { cents: 0, kind: null };
  if (p.mode === 'integral') return { cents: totalCents, kind: 'integral' };
  const pct = Math.min(100, Math.max(1, Number(p.depositPercent) || 30));
  return { cents: Math.max(100, Math.round((totalCents * pct) / 100)), kind: 'sinal' };
}

function logEvent(conn, appointmentId, type, detail, actor) {
  conn.prepare('INSERT INTO appointment_events (appointment_id, type, detail, actor, created_at) VALUES (?,?,?,?,?)')
    .run(appointmentId, type, detail || '', actor || '', Date.now());
}

function translateDbError(err) {
  if (String(err && err.message).includes('HORARIO_INDISPONIVEL')) {
    return new HttpError(409, 'Esse horário acabou de ser reservado. Escolha outro horário.', 'time');
  }
  return err;
}

/**
 * Cria um agendamento.
 * customerInput: { name, phone, email, marketingConsent }
 * opts.customerId: cliente autenticado (área do cliente) ou escolhido pelo painel
 * opts.staff: true quando criado pelo painel (pode ignorar antecedência e, com ignoreHours, encaixar fora do expediente)
 */
function createAppointment({ serviceIds, professionalId, date, startTime, customerInput, source = 'online', notes = '', actor = 'cliente', staff = false, ignoreHours = false, customerId = null, staffUserId = null, status }) {
  const services = loadServices(serviceIds, { activeOnly: !staff });
  const { duration, price } = totals(services);
  if (!time.parseDate(date)) fail('Data inválida.', 'date');
  const minutes = time.hhmmToMinutes(startTime);
  if (minutes === null) fail('Horário inválido.', 'time');
  const startAt = time.localToUtc(date, minutes);
  const endAt = startAt + duration * 60000;
  const now = Date.now();
  const enforceRules = !staff;
  if (startAt < now - 60000 && !staff) fail('Esse horário já passou.', 'time');

  const pros = availability.eligibleProfessionals(serviceIds, { onlineOnly: !staff });
  if (!pros.length) fail('Nenhum profissional realiza todos os serviços escolhidos juntos.', 'services');

  const pay = staff ? { cents: 0, kind: null } : paymentRequirement(price);
  const bookingCfg = settings.section('booking');
  const token = security.randomToken();

  let result;
  try {
    result = db.tx((conn) => {
      // 1) escolhe e confere o profissional dentro da transação
      let proId;
      const slotOpts = { now, enforceRules, ignoreHours };
      if (professionalId === 'any' || !professionalId) {
        const freeIds = pros.filter((p) => availability.isSlotFree(p.id, startAt, duration, slotOpts)).map((p) => p.id);
        if (!freeIds.length) throw new HttpError(409, 'Esse horário não está mais disponível. Escolha outro.', 'time');
        proId = availability.pickLeastBusy(freeIds, date);
      } else {
        proId = Number(professionalId);
        if (!pros.some((p) => p.id === proId)) fail('Esse profissional não realiza todos os serviços escolhidos.', 'professional');
        if (!availability.isSlotFree(proId, startAt, duration, slotOpts)) {
          throw new HttpError(409, 'Esse horário não está mais disponível. Escolha outro.', 'time');
        }
      }

      // 2) cliente: nunca sobrescreve dados de um cadastro existente a partir de um agendamento sem login
      let cid = customerId;
      if (!cid) {
        const existing = conn.prepare('SELECT * FROM customers WHERE phone = ?').get(customerInput.phone);
        if (existing) {
          cid = existing.id;
          if (staff) {
            conn.prepare('UPDATE customers SET name = ?, email = COALESCE(NULLIF(?, \'\'), email), updated_at = ? WHERE id = ?')
              .run(customerInput.name, customerInput.email || '', now, cid);
          } else if (customerInput.marketingConsent && !existing.marketing_consent) {
            // consentimento só pode ser acrescentado, nunca retirado por terceiros
            conn.prepare('UPDATE customers SET marketing_consent = 1, marketing_consent_at = ?, updated_at = ? WHERE id = ?').run(now, now, cid);
          }
        } else {
          const r = conn.prepare(`INSERT INTO customers (name, phone, email, marketing_consent, marketing_consent_at, privacy_accepted_at, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?)`).run(
            customerInput.name, customerInput.phone, customerInput.email || null,
            customerInput.marketingConsent ? 1 : 0, customerInput.marketingConsent ? now : null,
            staff ? null : now, now, now,
          );
          cid = Number(r.lastInsertRowid);
        }
      }
      const customer = conn.prepare('SELECT * FROM customers WHERE id = ?').get(cid);

      // 3) grava
      const st = status || (pay.cents > 0 ? 'pendente' : (staff || bookingCfg.autoConfirm ? 'confirmado' : 'pendente'));
      let code; let apptId;
      for (let i = 0; i < 5; i++) {
        code = newCode();
        if (!conn.prepare('SELECT 1 FROM appointments WHERE code = ?').get(code)) break;
      }
      const ins = conn.prepare(`INSERT INTO appointments
        (code, customer_id, professional_id, start_at, end_at, status, source, customer_name, total_price_cents, total_duration_min,
         notes, manage_token_hash, manage_token_expires_at, payment_required_cents, payment_expires_at, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        code, cid, proId, startAt, endAt, st, source,
        customerInput?.name || customer.name, price, duration, notes,
        security.hashToken(token), endAt + 60 * 86400000,
        pay.cents, pay.cents > 0 ? now + settings.section('payments').holdMinutes * 60000 : null,
        staffUserId, now, now,
      );
      apptId = Number(ins.lastInsertRowid);
      services.forEach((s, i) => {
        conn.prepare('INSERT INTO appointment_services (appointment_id, service_id, name, price_cents, duration_min, position) VALUES (?,?,?,?,?,?)')
          .run(apptId, s.id, s.name, s.price_cents, s.duration_min, i);
      });
      logEvent(conn, apptId, 'criado', `origem: ${source}`, actor);
      return { id: apptId, code, status: st };
    });
  } catch (err) { throw translateDbError(err); }

  // Notificações nunca derrubam o agendamento
  if (result.status === 'confirmado') safeNotify(result.id, 'confirmacao');
  return { ...getAppointment(result.id), manageToken: token, paymentKind: pay.kind };
}

function safeNotify(appointmentId, kind) {
  try { require('./notify').scheduleForAppointment(appointmentId, kind); } catch (err) {
    console.error('[notificação] falha ao agendar envio:', err.message);
  }
}

function getAppointment(id) {
  const conn = db.get();
  const a = conn.prepare(`SELECT a.*, p.name AS professional_name, c.phone AS customer_phone, c.email AS customer_email, c.name AS customer_record_name
    FROM appointments a JOIN professionals p ON p.id = a.professional_id JOIN customers c ON c.id = a.customer_id WHERE a.id = ?`).get(id);
  if (!a) return null;
  a.services = conn.prepare('SELECT service_id, name, price_cents, duration_min FROM appointment_services WHERE appointment_id = ? ORDER BY position').all(id);
  const paid = conn.prepare("SELECT COALESCE(SUM(amount_cents - refunded_cents),0) v FROM payments WHERE appointment_id = ? AND status IN ('aprovado','estornado')").get(id);
  a.paid_cents = paid.v;
  const local = time.utcToLocal(a.start_at);
  a.date = local.date; a.time = local.time; a.end_time = time.utcToLocal(a.end_at).time;
  delete a.manage_token_hash;
  return a;
}

function policyCheck(appt, kind) {
  const b = settings.section('booking');
  if (!['pendente', 'confirmado'].includes(appt.status)) return 'Esse agendamento não pode mais ser alterado.';
  if (kind === 'cancel' && !b.allowClientCancel) return 'Cancelamentos pelo site estão desativados. Fale com a barbearia.';
  if (kind === 'reschedule' && !b.allowClientReschedule) return 'Reagendamentos pelo site estão desativados. Fale com a barbearia.';
  const limitH = kind === 'cancel' ? b.cancelMinHours : b.rescheduleMinHours;
  if (appt.start_at - Date.now() < limitH * 3600000) {
    return `Pelo site só é possível ${kind === 'cancel' ? 'cancelar' : 'reagendar'} até ${limitH} hora(s) antes. Fale com a barbearia pelo WhatsApp.`;
  }
  if (kind === 'reschedule' && appt.reschedule_count >= b.maxReschedules) return 'Limite de reagendamentos atingido. Fale com a barbearia.';
  return null;
}

function cancelAppointment(id, { by = 'cliente', reason = '', enforcePolicy = true, actor } = {}) {
  const appt = getAppointment(id);
  if (!appt) fail('Agendamento não encontrado.', null, 404);
  if (enforcePolicy) {
    const msg = policyCheck(appt, 'cancel');
    if (msg) fail(msg, null, 422);
  } else if (!['pendente', 'confirmado'].includes(appt.status)) {
    fail('Só é possível cancelar agendamentos pendentes ou confirmados.', null, 422);
  }
  db.tx((conn) => {
    conn.prepare("UPDATE appointments SET status = 'cancelado', cancelled_at = ?, cancel_reason = ?, cancelled_by = ?, updated_at = ? WHERE id = ?")
      .run(Date.now(), reason || null, by, Date.now(), id);
    conn.prepare("UPDATE notifications SET status = 'cancelado' WHERE appointment_id = ? AND status = 'pendente'").run(id);
    conn.prepare("UPDATE payments SET status = 'cancelado', updated_at = ? WHERE appointment_id = ? AND status = 'aguardando'").run(Date.now(), id);
    logEvent(conn, id, 'cancelado', reason || '', actor || by);
  });
  if (appt.status === 'confirmado') safeNotify(id, 'cancelamento');
  return getAppointment(id);
}

function rescheduleAppointment(id, { date, startTime, professionalId, by = 'cliente', enforcePolicy = true, staff = false, ignoreHours = false, actor } = {}) {
  const appt = getAppointment(id);
  if (!appt) fail('Agendamento não encontrado.', null, 404);
  if (enforcePolicy) {
    const msg = policyCheck(appt, 'reschedule');
    if (msg) fail(msg, null, 422);
  } else if (!['pendente', 'confirmado'].includes(appt.status)) {
    fail('Só é possível reagendar agendamentos pendentes ou confirmados.', null, 422);
  }
  if (!time.parseDate(date)) fail('Data inválida.', 'date');
  const minutes = time.hhmmToMinutes(startTime);
  if (minutes === null) fail('Horário inválido.', 'time');
  const startAt = time.localToUtc(date, minutes);
  const endAt = startAt + appt.total_duration_min * 60000;
  const serviceIds = appt.services.map((s) => s.service_id).filter(Boolean);
  const pros = availability.eligibleProfessionals(serviceIds, { onlineOnly: !staff });
  const now = Date.now();
  const opts = { now, enforceRules: !staff, excludeAppointmentId: id, ignoreHours };

  try {
    db.tx((conn) => {
      let proId;
      if (professionalId === 'any') {
        const freeIds = pros.filter((p) => availability.isSlotFree(p.id, startAt, appt.total_duration_min, opts)).map((p) => p.id);
        if (!freeIds.length) throw new HttpError(409, 'Esse horário não está disponível. Escolha outro.', 'time');
        proId = freeIds.includes(appt.professional_id) ? appt.professional_id : availability.pickLeastBusy(freeIds, date);
      } else {
        proId = professionalId ? Number(professionalId) : appt.professional_id;
        if (serviceIds.length && !pros.some((p) => p.id === proId)) fail('Esse profissional não realiza os serviços deste agendamento.', 'professional');
        if (!availability.isSlotFree(proId, startAt, appt.total_duration_min, opts)) {
          throw new HttpError(409, 'Esse horário não está disponível. Escolha outro.', 'time');
        }
      }
      conn.prepare('UPDATE appointments SET start_at = ?, end_at = ?, professional_id = ?, reschedule_count = reschedule_count + ?, updated_at = ? WHERE id = ?')
        .run(startAt, endAt, proId, staff ? 0 : 1, now, id);
      conn.prepare("UPDATE notifications SET status = 'cancelado' WHERE appointment_id = ? AND status = 'pendente'").run(id);
      logEvent(conn, id, 'reagendado', `de ${time.formatDateTimeBR(appt.start_at)} para ${time.formatDateTimeBR(startAt)}`, actor || by);
    });
  } catch (err) { throw translateDbError(err); }
  const updated = getAppointment(id);
  if (updated.status === 'confirmado') safeNotify(id, 'reagendamento');
  return updated;
}

const STATUS = ['pendente', 'confirmado', 'concluido', 'cancelado', 'nao_compareceu'];
const STATUS_LABEL = { pendente: 'Pendente', confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado', nao_compareceu: 'Não compareceu' };

function setStatus(id, status, { actor, reason } = {}) {
  if (!STATUS.includes(status)) fail('Status inválido.', 'status');
  const appt = getAppointment(id);
  if (!appt) fail('Agendamento não encontrado.', null, 404);
  if (status === appt.status) return appt;
  if (status === 'cancelado') return cancelAppointment(id, { by: 'barbearia', reason, enforcePolicy: false, actor });
  if (['concluido', 'nao_compareceu'].includes(status) && appt.start_at > Date.now()) {
    fail('Só é possível marcar como concluído ou não compareceu depois do horário de início.', 'status', 422);
  }
  try {
    db.tx((conn) => {
      conn.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
      if (status !== 'confirmado' && status !== 'pendente') {
        conn.prepare("UPDATE notifications SET status = 'cancelado' WHERE appointment_id = ? AND status = 'pendente'").run(id);
      }
      logEvent(conn, id, 'status', `${STATUS_LABEL[appt.status]} → ${STATUS_LABEL[status]}`, actor);
    });
  } catch (err) { throw translateDbError(err); }
  if (status === 'confirmado' && appt.status === 'pendente') safeNotify(id, 'confirmacao');
  return getAppointment(id);
}

// Libera horários de agendamentos que aguardavam pagamento e não foram pagos a tempo.
function releaseExpiredHolds(now = Date.now()) {
  const conn = db.get();
  const rows = conn.prepare(`SELECT id FROM appointments WHERE status = 'pendente' AND payment_required_cents > 0
    AND payment_expires_at IS NOT NULL AND payment_expires_at < ?`).all(now);
  for (const r of rows) {
    const paid = conn.prepare("SELECT 1 FROM payments WHERE appointment_id = ? AND status IN ('aprovado','em_analise')").get(r.id);
    if (paid) continue;
    db.tx((c) => {
      c.prepare("UPDATE appointments SET status = 'cancelado', cancelled_at = ?, cancel_reason = 'Pagamento não realizado no prazo', cancelled_by = 'sistema', updated_at = ? WHERE id = ?").run(now, now, r.id);
      c.prepare("UPDATE payments SET status = 'cancelado', updated_at = ? WHERE appointment_id = ? AND status = 'aguardando'").run(now, r.id);
      logEvent(c, r.id, 'cancelado', 'pagamento não realizado no prazo', 'sistema');
    });
  }
  return rows.length;
}

module.exports = {
  createAppointment, cancelAppointment, rescheduleAppointment, setStatus, getAppointment,
  policyCheck, loadServices, totals, releaseExpiredHolds, logEvent, STATUS, STATUS_LABEL, translateDbError,
};
