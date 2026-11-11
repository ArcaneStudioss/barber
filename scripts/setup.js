'use strict';
// Cria a estrutura do banco, o horário padrão e o primeiro administrador.
// Uso: ADMIN_EMAIL=dono@exemplo.com ADMIN_NAME="Nome" npm run setup
// A senha vem de ADMIN_PASSWORD; se não for informada, uma senha forte é gerada e mostrada UMA vez.
const crypto = require('node:crypto');
const db = require('../src/db');
const { bootstrap } = require('../src/bootstrap');
const security = require('../src/lib/security');

bootstrap();
const conn = db.get();
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const name = process.env.ADMIN_NAME || 'Administrador';
if (!email) {
  console.log('Banco pronto. Para criar o administrador: ADMIN_EMAIL=voce@exemplo.com npm run setup');
  process.exit(0);
}
const existing = conn.prepare('SELECT id FROM users WHERE email = ?').get(email);
if (existing) {
  console.log(`Já existe um usuário com ${email}. Nada alterado.`);
  process.exit(0);
}
let password = process.env.ADMIN_PASSWORD || '';
let generated = false;
if (!password) { password = crypto.randomBytes(12).toString('base64url') + '7a'; generated = true; }
if (password.length < 10) { console.error('ADMIN_PASSWORD precisa ter pelo menos 10 caracteres.'); process.exit(1); }
conn.prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)").run(name, email, security.hashPassword(password), Date.now());
console.log(`Administrador criado: ${email}`);
if (generated) console.log(`Senha gerada (anote agora, ela não será mostrada de novo): ${password}`);
