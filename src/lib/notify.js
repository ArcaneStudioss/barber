'use strict';
// Fila de notificações (e-mail via Resend, WhatsApp via Cloud API oficial da Meta).
// Sem credenciais, a mensagem é registrada como "nao_configurado": nada é simulado como enviado.
const db = require('../db');
const config = require('../config');
const settings = require('./settings');
const time = require('./time');
const fmt = require('./format');
const { esc } = require('./security');

const KIND_LABEL = {
  confirmacao: 'Confirmação', lembrete: 'Lembrete', cancelamento: 'Cancelamento',
  reagendamento: 'Reagendamento', codigo: 'Código de acesso',
};

function channelReady(channel) {
  const i = config.integrations();
  if (channel === 'email') return i.email.ready;
  return i.whatsapp.ready;
}

function enqueue(conn, { appointmentId, customerId, channel, kind, recipient, scheduledFor }) {
  const ready = channelReady(channel) || config.devConsoleNotifications;
  conn.prepare(`INSERT INTO notifications (appointment_id, customer_id, channel, kind, recipient, status, scheduled_for, created_at, last_error)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    appointmentId, customerId, channel, kind, recipient, ready ? 'pendente' : 'nao_configurado', scheduledFor, Date.now(),
    ready ? null : 'Integração não configurada: veja Configurações > Integrações no painel.',
  );
}

function scheduleForAppointment(appointmentId, kind) {
  const conn = db.get();
  const a = conn.prepare('SELECT a.*, c.email, c.phone FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE a.id = ?').get(appointmentId);
  if (!a) return;
  const n = settings.section('notifications');
  const now = Date.now();
  const channels = [];
  if (n.emailEnabled && a.email) channels.push(['email', a.email]);
  if (n.whatsappEnabled && a.phone) channels.push(['whatsapp', a.phone]);
  for (const [channel, recipient] of channels) {
    enqueue(conn, { appointmentId, customerId: a.customer_id, channel, kind, recipient, scheduledFor: now });
    if (['confirmacao', 'reagendamento'].includes(kind)) {
      for (const h of n.reminderHoursBefore || []) {
        const at = a.start_at - Number(h) * 3600000;
        if (at > now + 10 * 60000) {
          enqueue(conn, { appointmentId, customerId: a.customer_id, channel, kind: 'lembrete', recipient, scheduledFor: at });
        }
      }
    }
  }
}

function appointmentData(appointmentId) {
  const booking = require('./booking');
  const a = booking.getAppointment(appointmentId);
  if (!a) return null;
  const biz = settings.section('business');
  return {
    a, biz,
    nome: a.customer_name.split(' ')[0],
    data: time.formatDateBR(a.date),
    hora: a.time,
    servicos: a.services.map((s) => s.name).join(', '),
    profissional: a.professional_name,
    codigo: a.code,
    valor: fmt.money(a.total_price_cents),
  };
}

function emailContent(kind, d) {
  const titles = {
    confirmacao: `Agendamento confirmado: ${d.data} às ${d.hora}`,
    lembrete: `Lembrete: seu horário é ${d.data} às ${d.hora}`,
    cancelamento: `Agendamento cancelado: ${d.data} às ${d.hora}`,
    reagendamento: `Agendamento remarcado para ${d.data} às ${d.hora}`,
  };
  const intro = {
    confirmacao: 'Seu horário está confirmado.',
    lembrete: 'Passando para lembrar do seu horário.',
    cancelamento: 'Seu agendamento foi cancelado.',
    reagendamento: 'Seu agendamento foi remarcado.',
  };
  const manage = `${config.baseUrl}/cliente`;
  const text = `Olá, ${d.nome}! ${intro[kind]}\n\nData: ${d.data} às ${d.hora}\nServiços: ${d.servicos}\nProfissional: ${d.profissional}\nValor: ${d.valor}\nNúmero do agendamento: ${d.codigo}\n\nGerencie em ${manage}\n${d.biz.name}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#151412">
    <p style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#8a6a2f">${esc(d.biz.name)}</p>
    <h1 style="font-size:22px">${esc(titles[kind])}</h1>
    <p>Olá, ${esc(d.nome)}! ${esc(intro[kind])}</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      <tr><td style="padding:6px 0;color:#6b665c">Data</td><td>${esc(d.data)} às ${esc(d.hora)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b665c">Serviços</td><td>${esc(d.servicos)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b665c">Profissional</td><td>${esc(d.profissional)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b665c">Valor</td><td>${esc(d.valor)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b665c">Número</td><td><strong>${esc(d.codigo)}</strong></td></tr>
    </table>
    <p><a href="${esc(manage)}" style="color:#8a6a2f">Ver ou alterar meu agendamento</a></p>
  </div>`;
  return { subject: titles[kind], text, html };
}

async function sendEmail({ to, subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.email.from, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Resend respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendWhatsAppTemplate({ to, template, params, buttonParam }) {
  if (!template) throw new Error('Modelo de mensagem do WhatsApp não configurado para este tipo.');
  const components = [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t) })) }];
  if (buttonParam) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: buttonParam }] });
  const res = await fetch(`https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.whatsapp.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: template, language: { code: config.whatsapp.templateLanguage }, components },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`WhatsApp respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function deliver(n) {
  const d = appointmentData(n.appointment_id);
  if (!d) throw new Error('Agendamento não encontrado');
  if (config.devConsoleNotifications && !channelReady(n.channel)) {
    console.log(`[DEV · NÃO ENVIADO] ${n.channel} ${KIND_LABEL[n.kind]} para ${n.recipient}: ${d.data} ${d.hora} ${d.codigo}`);
    return 'dev';
  }
  if (n.channel === 'email') {
    await sendEmail({ to: n.recipient, ...emailContent(n.kind, d) });
  } else {
    // Parâmetros na ordem: {{1}} nome, {{2}} data, {{3}} hora, {{4}} serviços, {{5}} profissional, {{6}} número
    await sendWhatsAppTemplate({
      to: n.recipient,
      template: config.whatsapp.templates[n.kind],
      params: [d.nome, d.data, d.hora, d.servicos, d.profissional, d.codigo],
    });
  }
  return 'ok';
}

let running = false;
async function processDue(now = Date.now()) {
  if (running) return 0;
  running = true;
  const conn = db.get();
  let count = 0;
  try {
    const due = conn.prepare("SELECT * FROM notifications WHERE status = 'pendente' AND scheduled_for <= ? ORDER BY scheduled_for LIMIT 20").all(now);
    for (const n of due) {
      try {
        const r = await deliver(n);
        conn.prepare("UPDATE notifications SET status = ?, sent_at = ?, attempts = attempts + 1, last_error = ? WHERE id = ?")
          .run(r === 'dev' ? 'nao_configurado' : 'enviado', Date.now(), r === 'dev' ? 'Modo de desenvolvimento: mostrado no console, não enviado.' : null, n.id);
        count += 1;
      } catch (err) {
        const attempts = n.attempts + 1;
        const giveUp = attempts >= 4;
        conn.prepare('UPDATE notifications SET status = ?, attempts = ?, last_error = ?, scheduled_for = ? WHERE id = ?')
          .run(giveUp ? 'falhou' : 'pendente', attempts, String(err.message).slice(0, 300), now + attempts * 5 * 60000, n.id);
      }
    }
  } finally { running = false; }
  return count;
}

// Envio imediato do código de acesso da área do cliente (não fica na fila).
async function sendAccessCode(customer, channel, code) {
  const biz = settings.section('business');
  if (config.devConsoleNotifications && !channelReady(channel)) {
    console.log(`[DEV · NÃO ENVIADO] código de acesso para ${channel === 'email' ? customer.email : customer.phone}: ${code}`);
    return true;
  }
  if (!channelReady(channel)) return false;
  if (channel === 'email') {
    await sendEmail({
      to: customer.email,
      subject: `Seu código de acesso: ${code}`,
      text: `Seu código para acessar a área do cliente da ${biz.name} é ${code}. Ele vale por 10 minutos. Se não foi você, ignore esta mensagem.`,
      html: `<div style="font-family:Arial,sans-serif"><p>Seu código para acessar a área do cliente da ${esc(biz.name)}:</p><p style="font-size:28px;letter-spacing:.2em"><strong>${code}</strong></p><p>Vale por 10 minutos. Se não foi você, ignore esta mensagem.</p></div>`,
    });
  } else {
    if (!config.whatsapp.templates.codigo) return false;
    await sendWhatsAppTemplate({ to: customer.phone, template: config.whatsapp.templates.codigo, params: [code], buttonParam: code });
  }
  return true;
}

function accessChannels(customer) {
  const out = [];
  if (customer.email && (channelReady('email') || config.devConsoleNotifications)) out.push('email');
  if (channelReady('whatsapp') && config.whatsapp.templates.codigo) out.push('whatsapp');
  else if (config.devConsoleNotifications) out.push('whatsapp');
  return out;
}

let timer = null;
function startWorker() {
  if (timer) return;
  timer = setInterval(() => {
    processDue().catch((e) => console.error('[notificações]', e.message));
    try { require('./booking').releaseExpiredHolds(); } catch (e) { console.error('[pagamentos]', e.message); }
  }, 30000);
  timer.unref();
}

module.exports = { scheduleForAppointment, processDue, startWorker, sendAccessCode, accessChannels, KIND_LABEL, emailContent };
