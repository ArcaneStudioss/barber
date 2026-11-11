'use strict';
// DADOS FICTÍCIOS SÓ PARA DEMONSTRAÇÃO. Tudo fica marcado com is_demo = 1.
// Para apagar: npm run demo:remove
const db = require('../src/db');
const { bootstrap } = require('../src/bootstrap');
const security = require('../src/lib/security');
const time = require('../src/lib/time');

bootstrap();
const conn = db.get();
if (conn.prepare('SELECT COUNT(*) c FROM services WHERE is_demo = 1').get().c) {
  console.log('Os dados de demonstração já existem. Rode "npm run demo:remove" antes para recriar.');
  process.exit(0);
}
const now = Date.now();

const services = [
  // nome, descrição, preço (centavos), duração, destaque
  ['Corte masculino', 'Tesoura e máquina, com lavagem e finalização.', 5000, 40, 1],
  ['Barba', 'Toalha quente, navalha e hidratação.', 4000, 30, 1],
  ['Corte + barba', 'Os dois serviços no mesmo horário.', 8000, 70, 1],
  ['Degradê (fade)', 'Transição na máquina com acabamento na navalha.', 5500, 45, 1],
  ['Pezinho e acabamento', 'Contorno e manutenção entre um corte e outro.', 2000, 15, 0],
  ['Sobrancelha', 'Limpeza com navalha ou pinça.', 1500, 10, 0],
  ['Corte infantil', 'Para crianças até 12 anos.', 4000, 30, 1],
  ['Pigmentação de barba', 'Preenchimento de falhas com pigmento.', 3500, 30, 0],
];
const sIds = services.map(([n, d, p, m, f], i) => Number(conn.prepare('INSERT INTO services (name, description, price_cents, duration_min, active, featured, sort, is_demo, created_at) VALUES (?,?,?,?,1,?,?,1,?)').run(n, d, p, m, f, i, now).lastInsertRowid));

const pros = [
  ['Lucas Exemplo', 'Barbeiro', 'Perfil fictício para demonstração. Substitua pela apresentação real do profissional.', 'Degradê, Navalha, Corte social', [0, 1, 2, 3, 4, 5, 7]],
  ['Diego Exemplo', 'Barbeiro', 'Perfil fictício para demonstração. Substitua pela apresentação real do profissional.', 'Barba, Pigmentação, Tesoura', [0, 1, 2, 4, 5, 7]],
  ['Marina Exemplo', 'Barbeira', 'Perfil fictício para demonstração. Substitua pela apresentação real do profissional.', 'Corte infantil, Degradê, Sobrancelha', [0, 3, 4, 5, 6]],
];
const pIds = pros.map(([n, r, b, s, svc], i) => {
  const id = Number(conn.prepare('INSERT INTO professionals (name, role_title, bio, specialties, active, online_booking, sort, is_demo, created_at) VALUES (?,?,?,?,1,1,?,1,?)').run(n, r, b, s, i, now).lastInsertRowid);
  for (const k of svc) conn.prepare('INSERT INTO professional_services VALUES (?,?)').run(id, sIds[k]);
  return id;
});
// expediente: terça a sexta 09-19 com almoço 12-13; sábado 09-17 sem intervalo. Marina folga na quarta.
for (const [i, id] of pIds.entries()) {
  for (const d of [2, 3, 4, 5]) {
    if (i === 2 && d === 3) continue;
    conn.prepare('INSERT INTO professional_hours VALUES (?,?,?,?,?,?)').run(id, d, 540, 1140, i === 1 ? 780 : 720, i === 1 ? 840 : 780);
  }
  conn.prepare('INSERT INTO professional_hours VALUES (?,?,?,?,NULL,NULL)').run(id, 6, 540, 1020);
}

const pw = 'demo-' + security.randomToken(6);
conn.prepare("INSERT INTO users (name, email, password_hash, role, is_demo, created_at) VALUES ('Admin demonstração', 'admin@demo.local', ?, 'admin', 1, ?)").run(security.hashPassword(pw + '1'), now);
conn.prepare("INSERT INTO users (name, email, password_hash, role, professional_id, is_demo, created_at) VALUES ('Lucas Exemplo', 'lucas@demo.local', ?, 'profissional', ?, 1, ?)").run(security.hashPassword(pw + '2'), pIds[0], now);

// clientes e agendamentos fictícios (telefones de faixa inexistente 55 11 90000-xxxx)
const names = ['Cliente Demo Um', 'Cliente Demo Dois', 'Cliente Demo Três', 'Cliente Demo Quatro', 'Cliente Demo Cinco'];
const cIds = names.map((n, i) => Number(conn.prepare('INSERT INTO customers (name, phone, email, is_demo, created_at, updated_at) VALUES (?,?,?,1,?,?)').run(n, `551190000000${i}`, `cliente${i + 1}@demo.local`, now, now).lastInsertRowid));
let n = 0;
const today = time.todayLocal();
for (let offset = -20; offset <= 10; offset++) {
  const date = time.addDays(today, offset);
  const wd = time.weekdayOf(date);
  if (wd < 2) continue;
  if (conn.prepare('SELECT 1 FROM holidays WHERE date = ?').get(date)) continue;
  for (const [pi, pid] of pIds.entries()) {
    const h = conn.prepare('SELECT * FROM professional_hours WHERE professional_id = ? AND weekday = ?').get(pid, wd);
    if (!h) continue;
    for (const startMin of [600, 900, 1020]) {
      if (startMin + 40 > h.end_min || (offset + pi + startMin / 60) % 3 === 0) continue;
      n += 1;
      const svcIdx = [0, 2, 1, 3, 6][n % 5];
      const svcRow = conn.prepare('SELECT * FROM services WHERE id = ?').get(sIds[svcIdx]);
      if (!conn.prepare('SELECT 1 FROM professional_services WHERE professional_id = ? AND service_id = ?').get(pid, svcRow.id)) continue;
      if (h.break_start_min != null && startMin < h.break_end_min && startMin + svcRow.duration_min > h.break_start_min) continue;
      const startAt = time.localToUtc(date, startMin);
      const status = offset < 0 ? (n % 9 === 0 ? 'nao_compareceu' : n % 7 === 0 ? 'cancelado' : 'concluido') : (n % 6 === 0 ? 'pendente' : 'confirmado');
      const cid = cIds[n % cIds.length];
      const r = conn.prepare(`INSERT INTO appointments (code, customer_id, professional_id, start_at, end_at, status, source, customer_name, total_price_cents, total_duration_min, is_demo, created_at, updated_at, cancelled_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(`DEMO-${String(n).padStart(4, '0')}`, cid, pid, startAt, startAt + svcRow.duration_min * 60000, status, n % 4 === 0 ? 'telefone' : 'online', names[n % names.length], svcRow.price_cents, svcRow.duration_min, now, now, status === 'cancelado' ? now : null);
      const aid = Number(r.lastInsertRowid);
      conn.prepare('INSERT INTO appointment_services VALUES (?,?,?,?,?,0)').run(aid, svcRow.id, svcRow.name, svcRow.price_cents, svcRow.duration_min);
      if (status === 'concluido' && n % 3 !== 0) {
        conn.prepare("INSERT INTO payments (appointment_id, provider, method, kind, amount_cents, status, created_at, updated_at) VALUES (?, 'balcao', ?, 'integral', ?, 'aprovado', ?, ?)").run(aid, n % 2 ? 'pix' : 'dinheiro', svcRow.price_cents, now, now);
      }
    }
  }
}
console.log(`Demonstração criada: ${sIds.length} serviços, ${pIds.length} profissionais, ${cIds.length} clientes, ${n} agendamentos (todos fictícios).`);
console.log('Acessos do painel de DEMONSTRAÇÃO (anote; não são mostrados de novo):');
console.log(`  Administrador: admin@demo.local / ${pw}1`);
console.log(`  Profissional:  lucas@demo.local / ${pw}2`);
