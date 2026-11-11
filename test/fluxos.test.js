'use strict';
// Testes de ponta a ponta dos fluxos principais, com banco temporário.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'barbearia-test-'));
process.env.DATABASE_FILE = path.join(tmp, 'test.db');
process.env.NODE_ENV = 'test';
process.env.MP_ACCESS_TOKEN = '';

const db = require('../src/db');
const { bootstrap } = require('../src/bootstrap');
const { createApp } = require('../src/app');
const security = require('../src/lib/security');
const time = require('../src/lib/time');

let server; let base; let ids = {};

function client() {
  const jar = {};
  return async function call(url, { method = 'GET', body } = {}) {
    const headers = { 'X-Requested-With': 'fetch', Origin: base };
    if (body) headers['Content-Type'] = 'application/json';
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      const v = kv.slice(i + 1);
      if (v) jar[kv.slice(0, i)] = v; else delete jar[kv.slice(0, i)];
    }
    let data = null;
    try { data = await res.json(); } catch { /* não-JSON */ }
    return { status: res.status, data, headers: res.headers };
  };
}

// Próxima terça-feira útil (não feriado) a pelo menos 2 dias de hoje
function nextWorkingTuesday() {
  let d = time.addDays(time.todayLocal(), 2);
  while (time.weekdayOf(d) !== 2 || db.get().prepare('SELECT 1 FROM holidays WHERE date = ?').get(d)) d = time.addDays(d, 1);
  return d;
}

before(async () => {
  bootstrap();
  const conn = db.get();
  const now = Date.now();
  const s1 = Number(conn.prepare("INSERT INTO services (name, price_cents, duration_min, created_at) VALUES ('Corte', 5000, 40, ?)").run(now).lastInsertRowid);
  const s2 = Number(conn.prepare("INSERT INTO services (name, price_cents, duration_min, created_at) VALUES ('Barba', 4000, 30, ?)").run(now).lastInsertRowid);
  const p1 = Number(conn.prepare("INSERT INTO professionals (name, created_at) VALUES ('Ana Teste', ?)").run(now).lastInsertRowid);
  const p2 = Number(conn.prepare("INSERT INTO professionals (name, created_at) VALUES ('Beto Teste', ?)").run(now).lastInsertRowid);
  for (const p of [p1, p2]) {
    for (const s of [s1, s2]) conn.prepare('INSERT INTO professional_services VALUES (?,?)').run(p, s);
    for (const d of [2, 3, 4, 5, 6]) conn.prepare('INSERT INTO professional_hours VALUES (?,?,540,1140,720,780)').run(p, d);
  }
  conn.prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES ('Admin', 'admin@teste.local', ?, 'admin', ?)").run(security.hashPassword('senha-admin-123'), now);
  conn.prepare("INSERT INTO users (name, email, password_hash, role, professional_id, created_at) VALUES ('Beto', 'beto@teste.local', ?, 'profissional', ?, ?)").run(security.hashPassword('senha-beto-123'), p2, now);
  ids = { s1, s2, p1, p2, date: nextWorkingTuesday() };
  const app = createApp();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => security.resetRateLimits());

const booking = (over = {}) => ({
  services: [ids.s1], professional: ids.p1, date: ids.date, time: '10:00',
  name: 'Cliente Teste', phone: '(11) 98888-0001', email: 'cliente@teste.local', privacyAccepted: true, ...over,
});

async function adminClient() {
  const c = client();
  const r = await c('/api/admin/login', { method: 'POST', body: { email: 'admin@teste.local', password: 'senha-admin-123' } });
  assert.equal(r.status, 200);
  return c;
}

test('fuso horário: 10:00 em São Paulo é 13:00 UTC', () => {
  const utc = time.localToUtc('2026-12-01', 600, 'America/Sao_Paulo');
  assert.equal(new Date(utc).toISOString(), '2026-12-01T13:00:00.000Z');
  assert.equal(time.utcToLocal(utc).time, '10:00');
});

test('mostra só horários livres e soma a duração dos serviços', async () => {
  const c = client();
  const r = await c(`/api/availability?services=${ids.s1},${ids.s2}&professional=${ids.p1}&date=${ids.date}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.duration, 70);
  const times = r.data.slots.map((s) => s.time);
  assert.ok(times.includes('09:00'));
  assert.ok(!times.includes('11:00'), '11:00 + 70min invade o almoço (12:00)');
  assert.ok(!times.includes('12:00'), 'almoço bloqueado');
  assert.ok(times.includes('13:00'));
  assert.ok(!times.includes('18:00'), '18:00 + 70min passa do expediente');
});

test('agendamento é criado e aparece no painel', async () => {
  const c = client();
  const r = await c('/api/bookings', { method: 'POST', body: booking() });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.appointment.code, /^BE-/);
  assert.equal(r.data.appointment.status, 'confirmado');
  ids.firstCode = r.data.appointment.code; ids.firstId = r.data.appointment.id; ids.firstManage = r.data.manageUrl;

  const admin = await adminClient();
  const list = await admin(`/api/admin/appointments?from=${ids.date}&to=${ids.date}`);
  assert.ok(list.data.appointments.some((a) => a.code === ids.firstCode));
});

test('impede reserva duplicada do mesmo profissional, inclusive simultânea', async () => {
  const c = client();
  const dup = await c('/api/bookings', { method: 'POST', body: booking({ phone: '(11) 98888-0002', time: '10:15' }) });
  assert.equal(dup.status, 409);

  // 6 pedidos ao mesmo tempo para o mesmo horário: só 1 pode passar
  const results = await Promise.all([3, 4, 5, 6, 7, 8].map((n) => client()('/api/bookings', { method: 'POST', body: booking({ phone: `(11) 98888-000${n}`, time: '15:00' }) })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 5);

  // o gatilho do banco também barra uma inserção direta sobreposta
  const a = db.get().prepare('SELECT * FROM appointments WHERE id = ?').get(ids.firstId);
  assert.throws(() => db.get().prepare(`INSERT INTO appointments (code, customer_id, professional_id, start_at, end_at, status, customer_name, total_price_cents, total_duration_min, created_at, updated_at)
    VALUES ('X-1', ?, ?, ?, ?, 'confirmado', 'x', 0, 10, 0, 0)`).run(a.customer_id, a.professional_id, a.start_at + 60000, a.end_at), /HORARIO_INDISPONIVEL/);
});

test('"qualquer profissional" escolhe quem está livre', async () => {
  const c = client();
  const r = await c('/api/bookings', { method: 'POST', body: booking({ professional: 'any', phone: '(11) 98888-0010', time: '10:00' }) });
  assert.equal(r.status, 201);
  assert.equal(r.data.appointment.professionalId, ids.p2, 'Ana já está ocupada às 10:00');
});

test('respeita horários bloqueados e folgas', async () => {
  const admin = await adminClient();
  const b = await admin('/api/admin/time-off', { method: 'POST', body: { professional_id: ids.p1, kind: 'bloqueio', start_date: ids.date, end_date: ids.date, start_time: '16:00', end_time: '17:00', reason: 'teste' } });
  assert.equal(b.status, 201);
  const slots = await client()(`/api/availability?services=${ids.s1}&professional=${ids.p1}&date=${ids.date}`);
  const times = slots.data.slots.map((s) => s.time);
  assert.ok(!times.includes('16:00') && !times.includes('15:30'), 'bloqueio e horários que invadem o bloqueio somem');
  const tryBook = await client()('/api/bookings', { method: 'POST', body: booking({ phone: '(11) 98888-0011', time: '16:00' }) });
  assert.equal(tryBook.status, 409);
  // feriado fecha o dia todo
  const hol = await admin('/api/admin/holidays', { method: 'POST', body: { date: time.addDays(ids.date, 1), name: 'Feriado teste' } });
  assert.equal(hol.status, 201);
  const h = await client()(`/api/availability?services=${ids.s1}&professional=${ids.p1}&date=${time.addDays(ids.date, 1)}`);
  assert.equal(h.data.slots.length, 0);
});

test('cancelar libera o horário', async () => {
  const c = client();
  const r = await c('/api/bookings', { method: 'POST', body: booking({ phone: '(11) 98888-0020', time: '17:00' }) });
  assert.equal(r.status, 201);
  const id = r.data.appointment.id;
  const before = await c(`/api/availability?services=${ids.s1}&professional=${ids.p1}&date=${ids.date}`);
  assert.ok(!before.data.slots.some((s) => s.time === '17:00'));
  const cancel = await c(`/api/cliente/agendamentos/${id}/cancelar`, { method: 'POST', body: {} });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  assert.equal(cancel.data.appointment.status, 'cancelado');
  const afterR = await c(`/api/availability?services=${ids.s1}&professional=${ids.p1}&date=${ids.date}`);
  assert.ok(afterR.data.slots.some((s) => s.time === '17:00'));
  const rebook = await client()('/api/bookings', { method: 'POST', body: booking({ phone: '(11) 98888-0021', time: '17:00' }) });
  assert.equal(rebook.status, 201);
});

test('reagendar sem gerar conflito', async () => {
  const c = client();
  const r = await c('/api/bookings', { method: 'POST', body: booking({ phone: '(11) 98888-0030', time: '13:00' }) });
  const id = r.data.appointment.id;
  const conflict = await c(`/api/cliente/agendamentos/${id}/reagendar`, { method: 'POST', body: { date: ids.date, time: '10:00' } });
  assert.equal(conflict.status, 409, 'horário de outro cliente');
  const ok = await c(`/api/cliente/agendamentos/${id}/reagendar`, { method: 'POST', body: { date: ids.date, time: '14:00' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.appointment.time, '14:00');
  // pode "reagendar" sobrepondo o próprio horário antigo (13:30 sobrepõe 14:00-14:40 do próprio)
  const self = await c(`/api/cliente/agendamentos/${id}/reagendar`, { method: 'POST', body: { date: ids.date, time: '13:45' } });
  assert.equal(self.status, 200);
  const free = await client()(`/api/availability?services=${ids.s1}&professional=${ids.p1}&date=${ids.date}`);
  assert.ok(free.data.slots.some((s) => s.time === '13:00'), 'horário original liberado');
});

test('cliente não acessa dados de outro cliente', async () => {
  const victim = client();
  const v = await victim('/api/bookings', { method: 'POST', body: booking({ name: 'Vítima Real', phone: '(11) 97777-0001', email: 'vitima@teste.local', time: '09:00' }) });
  assert.equal(v.status, 201);
  const vid = v.data.appointment.id;

  const attacker = client();
  const a = await attacker('/api/bookings', { method: 'POST', body: booking({ name: 'Atacante', phone: '(11) 96666-0001', time: '09:00', professional: ids.p2 }) });
  assert.equal(a.status, 201);
  for (const url of [`/api/cliente/agendamentos/${vid}/calendario.ics`, `/api/cliente/agendamentos/${vid}/horarios?date=${ids.date}`]) {
    assert.equal((await attacker(url)).status, 404, url);
  }
  assert.equal((await attacker(`/api/cliente/agendamentos/${vid}/cancelar`, { method: 'POST', body: {} })).status, 404);
  const me = await attacker('/api/cliente/me');
  assert.ok(!JSON.stringify(me.data).includes('Vítima'));

  // agendar com o TELEFONE da vítima não dá acesso ao histórico nem ao e-mail dela
  const impostor = client();
  const imp = await impostor('/api/bookings', { method: 'POST', body: booking({ name: 'Impostor', phone: '(11) 97777-0001', email: 'impostor@teste.local', time: '09:00', date: time.addDays(ids.date, 2) }) });
  assert.equal(imp.status, 201);
  const impMe = await impostor('/api/cliente/me');
  assert.equal(impMe.data.access, 'agendamento');
  assert.equal(impMe.data.upcoming.length + impMe.data.history.length, 1, 'vê só o próprio agendamento');
  assert.ok(!JSON.stringify(impMe.data).includes('vitima@teste.local'));
  assert.equal((await impostor(`/api/cliente/agendamentos/${vid}/cancelar`, { method: 'POST', body: {} })).status, 404);
  const rec = db.get().prepare("SELECT * FROM customers WHERE phone = '5511977770001'").get();
  assert.equal(rec.name, 'Vítima Real', 'cadastro não foi sobrescrito');
  assert.equal(rec.email, 'vitima@teste.local');
  // alterar dados exige acesso completo (código)
  assert.equal((await impostor('/api/cliente/me', { method: 'PATCH', body: { name: 'Hack' } })).status, 403);

  // sem sessão nenhuma
  assert.equal((await client()('/api/cliente/me')).status, 401);
});

test('link seguro do agendamento dá acesso só àquele agendamento', async () => {
  const c = client();
  const token = ids.firstManage.split('/').pop();
  const r = await c(`/cliente/acesso/${token}`);
  assert.equal(r.status, 303);
  const me = await c('/api/cliente/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.upcoming[0].code, ids.firstCode);
  const bad = await client()('/cliente/acesso/token-invalido-com-mais-de-20-caracteres');
  assert.equal(bad.headers.get('location'), '/cliente?link=invalido');
});

test('código de verificação: acesso completo, sem revelar se o contato existe', async () => {
  // sem provedor configurado: avisa de forma genérica
  const r = await client()('/api/cliente/codigo', { method: 'POST', body: { identifier: '(11) 97777-0001' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.warning);
  const r2 = await client()('/api/cliente/codigo', { method: 'POST', body: { identifier: '(11) 95555-0000' } });
  assert.deepEqual(Object.keys(r.data).sort(), Object.keys(r2.data).sort());
  // fluxo de verificação com código gravado direto (simula o recebimento)
  const cust = db.get().prepare("SELECT * FROM customers WHERE phone = '5511977770001'").get();
  db.get().prepare('INSERT INTO otp_codes (customer_id, code_hash, channel, expires_at, created_at) VALUES (?,?,?,?,?)')
    .run(cust.id, security.hashToken(`${cust.id}:123456`), 'email', Date.now() + 600000, Date.now());
  const c = client();
  assert.equal((await c('/api/cliente/verificar', { method: 'POST', body: { identifier: '(11) 97777-0001', code: '000000' } })).status, 400);
  assert.equal((await c('/api/cliente/verificar', { method: 'POST', body: { identifier: '(11) 97777-0001', code: '123456' } })).status, 200);
  const me = await c('/api/cliente/me');
  assert.equal(me.data.access, 'completo');
  assert.equal(me.data.upcoming.length + me.data.history.length, 2, 'vê os dois agendamentos com esse telefone');
  assert.equal((await c('/api/cliente/verificar', { method: 'POST', body: { identifier: '(11) 97777-0001', code: '123456' } })).status, 400, 'código de uso único');
});

test('painel: rotas protegidas e profissional só vê a própria agenda', async () => {
  const anon = client();
  assert.equal((await anon('/api/admin/appointments?from=2026-01-01&to=2026-01-02')).status, 401);
  assert.equal((await anon('/api/admin/login', { method: 'POST', body: { email: 'admin@teste.local', password: 'errada' } })).status, 401);

  const beto = client();
  assert.equal((await beto('/api/admin/login', { method: 'POST', body: { email: 'beto@teste.local', password: 'senha-beto-123' } })).status, 200);
  const list = await beto(`/api/admin/appointments?from=${ids.date}&to=${ids.date}&professional=${ids.p1}`);
  assert.ok(list.data.appointments.length > 0);
  assert.ok(list.data.appointments.every((a) => a.professional_id === ids.p2));
  assert.equal((await beto(`/api/admin/appointments/${ids.firstId}`)).status, 403, 'agendamento da Ana');
  assert.equal((await beto('/api/admin/settings')).status, 403);
  assert.equal((await beto('/api/admin/export/clientes.csv')).status, 403);
  assert.equal((await beto('/api/admin/services', { method: 'POST', body: { name: 'x', price: 1, duration_min: 10 } })).status, 403);
});

test('bloqueio de login após tentativas repetidas', async () => {
  const c = client();
  for (let i = 0; i < 5; i++) await c('/api/admin/login', { method: 'POST', body: { email: 'beto@teste.local', password: `errada${i}` } });
  const r = await c('/api/admin/login', { method: 'POST', body: { email: 'beto@teste.local', password: 'senha-beto-123' } });
  assert.equal(r.status, 401);
  assert.match(r.data.error, /bloqueado/);
  db.get().prepare("UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE email = 'beto@teste.local'").run();
});

test('validação no servidor e proteção contra origem externa', async () => {
  const c = client();
  const bad = await c('/api/bookings', { method: 'POST', body: booking({ phone: '123', time: '11:00' }) });
  assert.equal(bad.status, 400); assert.equal(bad.data.field, 'phone');
  const noConsent = await c('/api/bookings', { method: 'POST', body: booking({ privacyAccepted: false, time: '11:00' }) });
  assert.equal(noConsent.status, 400);
  const bot = await c('/api/bookings', { method: 'POST', body: booking({ website: 'spam', time: '11:00' }) });
  assert.equal(bot.status, 400);
  const evil = await fetch(`${base}/api/bookings`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.example' }, body: JSON.stringify(booking()) });
  assert.equal(evil.status, 403);
  const off = await c('/api/bookings', { method: 'POST', body: booking({ time: '10:07' }) });
  assert.equal(off.status, 409, 'fora da grade de horários');
});

test('relatório distingue previsto, recebido e pendente; CSV exporta', async () => {
  const admin = await adminClient();
  const r = await admin(`/api/admin/reports?from=${ids.date}&to=${ids.date}`);
  assert.equal(r.status, 200);
  assert.ok(r.data.values.expected_cents > 0);
  assert.equal(r.data.values.received_cents, 0);
  const csv = await fetch(`${base}/api/admin/export/agendamentos.csv?from=${ids.date}&to=${ids.date}`, { headers: { Cookie: '' } });
  assert.equal(csv.status, 401);
});

test('webhook do Mercado Pago sem credencial ou com assinatura inválida é recusado', async () => {
  const r = await fetch(`${base}/webhooks/mercadopago?type=payment&data.id=123`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 503);
  const config = require('../src/config');
  config.mercadopago.accessToken = 'TEST'; config.mercadopago.webhookSecret = 'segredo';
  const prevBase = config.baseUrl; config.baseUrl = 'https://exemplo.test';
  try {
    const bad = await fetch(`${base}/webhooks/mercadopago?type=payment&data.id=123`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'r1' }, body: '{}' });
    assert.equal(bad.status, 401);
    // assinatura correta passa na validação (o resto depende da API do Mercado Pago)
    const payments = require('../src/lib/payments');
    const ts = '1700000000';
    const v1 = crypto.createHmac('sha256', 'segredo').update('id:123;request-id:r1;ts:1700000000;').digest('hex');
    const req = { get: (h) => ({ 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'r1' }[h]), query: { 'data.id': '123' }, body: {} };
    assert.equal(payments.validSignature(req), true);
  } finally { config.mercadopago.accessToken = ''; config.mercadopago.webhookSecret = ''; config.baseUrl = prevBase; }
});

test('CSV protege contra injeção de fórmula', () => {
  const { csvCell } = require('../src/routes/api-admin');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('Corte; barba'), '"Corte; barba"');
});

test('páginas públicas, SEO e cabeçalhos de segurança', async () => {
  for (const p of ['/', '/servicos', '/equipe', '/sobre', '/galeria', '/contato', '/agendar', '/cliente', '/privacidade', '/termos']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.ok(r.headers.get('content-security-policy'));
    const html = await r.text();
    assert.match(html, /<title>[^<]+<\/title>/);
    assert.match(html, /name="description"/);
  }
  const home = await (await fetch(`${base}/`)).text();
  assert.match(home, /application\/ld\+json/);
  assert.match(home, /"@type":"HairSalon"/);
  const sm = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.match(sm, /<loc>/);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/data/barbearia.db`)).status, 404);
});

test('atrás da Cloudflare, o limite de tentativas usa o IP real do visitante', async () => {
  const config = require('../src/config');
  config.trustCloudflare = true;
  const app2 = createApp();
  const srv = await new Promise((r) => { const s = app2.listen(0, () => r(s)); });
  try {
    const url = `http://127.0.0.1:${srv.address().port}/api/admin/login`;
    const hit = (ip) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Origin: `http://127.0.0.1:${srv.address().port}`, 'CF-Connecting-IP': ip }, body: JSON.stringify({ email: 'x@x.xx', password: 'y' }) });
    for (let i = 0; i < 10; i++) await hit('203.0.113.7');
    assert.equal((await hit('203.0.113.7')).status, 429, 'mesmo IP é limitado');
    assert.equal((await hit('203.0.113.8')).status, 401, 'outro visitante não é afetado');
  } finally { config.trustCloudflare = false; srv.close(); security.resetRateLimits(); }
});
