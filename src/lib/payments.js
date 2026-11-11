'use strict';
// Pagamento online opcional via Mercado Pago (Checkout Pro: Pix e cartão).
// Dados de cartão nunca passam por este servidor: o cliente paga na página do Mercado Pago.
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const booking = require('./booking');
const { fail } = require('./validate');

const MP = 'https://api.mercadopago.com';

async function mpFetch(path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${config.mercadopago.accessToken}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${MP}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mercado Pago respondeu ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

function paidCents(conn, appointmentId) {
  return conn.prepare("SELECT COALESCE(SUM(amount_cents - refunded_cents),0) v FROM payments WHERE appointment_id = ? AND status = 'aprovado'").get(appointmentId).v;
}

// Cria (ou reaproveita) o link de pagamento. Nunca cria duas cobranças abertas para o mesmo agendamento.
async function checkoutFor(appointmentId) {
  if (!config.integrations().mercadopago.ready) fail('Pagamento online não configurado.', null, 503);
  const conn = db.get();
  const a = booking.getAppointment(appointmentId);
  if (!a || a.status !== 'pendente' || a.payment_required_cents <= 0) fail('Este agendamento não aguarda pagamento.', null, 422);
  if (a.payment_expires_at && a.payment_expires_at < Date.now()) fail('O prazo para pagamento terminou. Faça um novo agendamento.', null, 422);
  if (paidCents(conn, a.id) >= a.payment_required_cents) fail('Pagamento já recebido.', null, 422);

  const open = conn.prepare("SELECT * FROM payments WHERE appointment_id = ? AND provider = 'mercadopago' AND status IN ('aguardando','em_analise') ORDER BY id DESC").get(a.id);
  if (open && open.checkout_url) return open.checkout_url;

  const kind = a.payment_required_cents >= a.total_price_cents ? 'integral' : 'sinal';
  const idem = `appt-${a.id}-pref`;
  const pref = await mpFetch('/checkout/preferences', {
    method: 'POST',
    idempotencyKey: idem,
    body: {
      items: [{
        id: a.code,
        title: `${kind === 'sinal' ? 'Sinal' : 'Pagamento'} · ${a.services.map((s) => s.name).join(', ')}`.slice(0, 250),
        quantity: 1, currency_id: 'BRL', unit_price: a.payment_required_cents / 100,
      }],
      external_reference: String(a.id),
      notification_url: `${config.baseUrl}/webhooks/mercadopago`,
      back_urls: {
        success: `${config.baseUrl}/agendar/retorno-pagamento`,
        pending: `${config.baseUrl}/agendar/retorno-pagamento`,
        failure: `${config.baseUrl}/agendar/retorno-pagamento`,
      },
      auto_return: 'approved',
      statement_descriptor: 'BARBEARIA',
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }], installments: 1 },
      expires: true,
      expiration_date_to: new Date(a.payment_expires_at).toISOString(),
      date_of_expiration: new Date(a.payment_expires_at).toISOString(),
    },
  });
  const now = Date.now();
  conn.prepare(`INSERT INTO payments (appointment_id, provider, kind, amount_cents, status, provider_preference_id, idempotency_key, checkout_url, created_at, updated_at)
    VALUES (?, 'mercadopago', ?, ?, 'aguardando', ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`)
    .run(a.id, kind, a.payment_required_cents, pref.id, idem, pref.init_point, now, now);
  return pref.init_point;
}

// Validação da assinatura do webhook (cabeçalho x-signature do Mercado Pago).
function validSignature(req) {
  const sig = req.get('x-signature') || '';
  const requestId = req.get('x-request-id') || '';
  const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2));
  if (!parts.ts || !parts.v1) return false;
  let dataId = String(req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || '');
  if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', config.mercadopago.webhookSecret).update(manifest).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(String(parts.v1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const STATUS_MAP = {
  approved: 'aprovado', authorized: 'em_analise', pending: 'em_analise', in_process: 'em_analise', in_mediation: 'em_analise',
  rejected: 'recusado', cancelled: 'cancelado', refunded: 'estornado', charged_back: 'estornado',
};

async function handleWebhook(req) {
  const conn = db.get();
  const log = (outcome, resourceId) => conn.prepare('INSERT INTO webhook_events (provider, request_id, resource_id, outcome, created_at) VALUES (?,?,?,?,?)')
    .run('mercadopago', req.get('x-request-id') || null, resourceId || null, outcome, Date.now());

  if (!config.integrations().mercadopago.ready) { log('ignorado: não configurado'); return 503; }
  if (!validSignature(req)) { log('assinatura inválida'); return 401; }
  const type = req.query.type || req.query.topic || (req.body && req.body.type);
  const id = String(req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || '');
  if (type !== 'payment' || !/^\d+$/.test(id)) { log(`ignorado: ${type}`, id); return 200; }

  // Nunca confiamos no corpo do webhook: buscamos o pagamento direto na API.
  const p = await mpFetch(`/v1/payments/${id}`);
  const appointmentId = Number(p.external_reference);
  const appt = booking.getAppointment(appointmentId);
  if (!appt) { log('agendamento não encontrado', id); return 200; }
  const status = STATUS_MAP[p.status] || 'em_analise';
  const amount = Math.round(Number(p.transaction_amount) * 100);
  const refunded = Math.round(Number(p.transaction_amount_refunded || 0) * 100);
  const method = p.payment_type_id === 'bank_transfer' || p.payment_method_id === 'pix' ? 'pix' : (p.payment_type_id || '').includes('card') ? 'cartao' : p.payment_type_id || '';
  const now = Date.now();

  db.tx((c) => {
    const existing = c.prepare('SELECT * FROM payments WHERE provider_payment_id = ?').get(id);
    if (existing) {
      c.prepare('UPDATE payments SET status = ?, amount_cents = ?, refunded_cents = ?, method = ?, raw_status = ?, updated_at = ? WHERE id = ?')
        .run(status, amount, refunded, method, p.status, now, existing.id);
    } else {
      const waiting = c.prepare("SELECT * FROM payments WHERE appointment_id = ? AND provider = 'mercadopago' AND provider_payment_id IS NULL ORDER BY id DESC").get(appointmentId);
      if (waiting) {
        c.prepare('UPDATE payments SET provider_payment_id = ?, status = ?, amount_cents = ?, refunded_cents = ?, method = ?, raw_status = ?, updated_at = ? WHERE id = ?')
          .run(id, status, amount, refunded, method, p.status, now, waiting.id);
      } else {
        c.prepare(`INSERT INTO payments (appointment_id, provider, method, kind, amount_cents, refunded_cents, status, provider_payment_id, raw_status, created_at, updated_at)
          VALUES (?, 'mercadopago', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(appointmentId, method, amount >= appt.total_price_cents ? 'integral' : 'sinal', amount, refunded, status, id, p.status, now, now);
      }
    }
  });

  if (status === 'aprovado' && paidCents(conn, appointmentId) >= appt.payment_required_cents) {
    if (appt.status === 'pendente') {
      booking.setStatus(appointmentId, 'confirmado', { actor: 'mercadopago' });
    } else if (appt.status === 'cancelado') {
      // pagou depois do prazo: tenta reativar; se o horário foi ocupado, sinaliza estorno no painel
      try {
        booking.setStatus(appointmentId, 'confirmado', { actor: 'mercadopago' });
        db.tx((c) => booking.logEvent(c, appointmentId, 'reativado', 'pagamento aprovado após o prazo', 'mercadopago'));
      } catch {
        db.tx((c) => booking.logEvent(c, appointmentId, 'estorno_necessario', 'pagamento aprovado para agendamento cancelado; horário ocupado', 'mercadopago'));
      }
    }
  }
  log(`pagamento ${p.status}`, id);
  return 200;
}

async function refund(paymentRowId, actor) {
  const conn = db.get();
  const pay = conn.prepare('SELECT * FROM payments WHERE id = ?').get(paymentRowId);
  if (!pay) fail('Pagamento não encontrado.', null, 404);
  if (pay.status !== 'aprovado') fail('Só é possível estornar pagamentos aprovados.', null, 422);
  if (pay.provider === 'balcao') {
    conn.prepare("UPDATE payments SET status = 'estornado', refunded_cents = amount_cents, updated_at = ? WHERE id = ?").run(Date.now(), pay.id);
  } else {
    if (!config.integrations().mercadopago.ready) fail('Mercado Pago não configurado.', null, 503);
    await mpFetch(`/v1/payments/${pay.provider_payment_id}/refunds`, { method: 'POST', body: {}, idempotencyKey: `refund-${pay.id}` });
    conn.prepare("UPDATE payments SET status = 'estornado', refunded_cents = amount_cents, updated_at = ? WHERE id = ?").run(Date.now(), pay.id);
  }
  db.tx((c) => booking.logEvent(c, pay.appointment_id, 'estorno', `pagamento #${pay.id}`, actor));
}

function recordCounterPayment(appointmentId, { amountCents, method, userId, actor }) {
  const conn = db.get();
  const a = booking.getAppointment(appointmentId);
  if (!a) fail('Agendamento não encontrado.', null, 404);
  if (a.status === 'cancelado') fail('Agendamento cancelado.', null, 422);
  const now = Date.now();
  conn.prepare(`INSERT INTO payments (appointment_id, provider, method, kind, amount_cents, status, recorded_by, created_at, updated_at)
    VALUES (?, 'balcao', ?, ?, ?, 'aprovado', ?, ?, ?)`).run(a.id, method, a.paid_cents > 0 ? 'restante' : 'integral', amountCents, userId, now, now);
  db.tx((c) => booking.logEvent(c, a.id, 'pagamento', `${method} R$ ${(amountCents / 100).toFixed(2).replace('.', ',')}`, actor));
}

module.exports = { checkoutFor, handleWebhook, refund, recordCounterPayment, validSignature };
