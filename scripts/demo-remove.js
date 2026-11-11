'use strict';
// Remove tudo que foi criado por demo-seed (marcado com is_demo = 1).
const db = require('../src/db');

db.tx((conn) => {
  const demoCustomers = conn.prepare('SELECT id FROM customers WHERE is_demo = 1').all().map((r) => r.id);
  conn.prepare('DELETE FROM payments WHERE appointment_id IN (SELECT id FROM appointments WHERE is_demo = 1)').run();
  conn.prepare('DELETE FROM appointments WHERE is_demo = 1').run();
  for (const id of demoCustomers) {
    const used = conn.prepare('SELECT 1 FROM appointments WHERE customer_id = ?').get(id);
    if (!used) conn.prepare('DELETE FROM customers WHERE id = ?').run(id);
  }
  conn.prepare('DELETE FROM users WHERE is_demo = 1').run();
  for (const p of conn.prepare('SELECT id FROM professionals WHERE is_demo = 1').all()) {
    if (conn.prepare('SELECT 1 FROM appointments WHERE professional_id = ?').get(p.id)) {
      conn.prepare('UPDATE professionals SET active = 0, online_booking = 0 WHERE id = ?').run(p.id);
    } else {
      conn.prepare('DELETE FROM professionals WHERE id = ?').run(p.id);
    }
  }
  for (const s of conn.prepare('SELECT id FROM services WHERE is_demo = 1').all()) {
    conn.prepare('DELETE FROM services WHERE id = ?').run(s.id);
  }
});
console.log('Dados de demonstração removidos. Itens que você editou no painel deixaram de ser "demo" e foram mantidos.');
