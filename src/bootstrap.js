'use strict';
// Dados mínimos para o sistema funcionar (não são dados de demonstração).
const db = require('./db');

// Feriados nacionais (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023). Feriados estaduais e municipais: cadastrar no painel.
const NATIONAL_HOLIDAYS = [
  ['2026-01-01', 'Confraternização Universal'], ['2026-04-03', 'Sexta-feira Santa'], ['2026-04-21', 'Tiradentes'],
  ['2026-05-01', 'Dia do Trabalho'], ['2026-09-07', 'Independência do Brasil'], ['2026-10-12', 'Nossa Senhora Aparecida'],
  ['2026-11-02', 'Finados'], ['2026-11-15', 'Proclamação da República'], ['2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
  ['2026-12-25', 'Natal'],
  ['2027-01-01', 'Confraternização Universal'], ['2027-03-26', 'Sexta-feira Santa'], ['2027-04-21', 'Tiradentes'],
  ['2027-05-01', 'Dia do Trabalho'], ['2027-09-07', 'Independência do Brasil'], ['2027-10-12', 'Nossa Senhora Aparecida'],
  ['2027-11-02', 'Finados'], ['2027-11-15', 'Proclamação da República'], ['2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
  ['2027-12-25', 'Natal'],
];

function bootstrap() {
  const conn = db.get();
  const has = conn.prepare('SELECT COUNT(*) c FROM business_hours').get().c;
  if (!has) {
    // Padrão inicial: terça a sábado 09:00 às 19:00 (sábado até 17:00). Ajuste no painel.
    const ins = conn.prepare('INSERT INTO business_hours (weekday, closed, open_min, close_min) VALUES (?,?,?,?)');
    ins.run(0, 1, 540, 1140); ins.run(1, 1, 540, 1140);
    for (const d of [2, 3, 4, 5]) ins.run(d, 0, 540, 1140);
    ins.run(6, 0, 540, 1020);
  }
  const flag = conn.prepare("SELECT value FROM settings WHERE key = '_holidays_seeded'").get();
  if (!flag) {
    const ins = conn.prepare('INSERT OR IGNORE INTO holidays (date, name) VALUES (?, ?)');
    for (const [d, n] of NATIONAL_HOLIDAYS) ins.run(d, n);
    conn.prepare("INSERT INTO settings (key, value) VALUES ('_holidays_seeded', 'true')").run();
  }
}

module.exports = { bootstrap, NATIONAL_HOLIDAYS };
