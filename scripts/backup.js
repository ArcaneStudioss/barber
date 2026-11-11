'use strict';
// Backup consistente do banco (VACUUM INTO), criptografado com AES-256-GCM e verificado.
// Uso: BACKUP_KEY=<64 caracteres hex> npm run backup
// Gere a chave uma vez com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Guarde a chave FORA do servidor (gerenciador de senhas). Sem ela, o backup não pode ser lido.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const db = require('../src/db');

const key = Buffer.from(process.env.BACKUP_KEY || '', 'hex');
if (key.length !== 32) { console.error('Defina BACKUP_KEY com 64 caracteres hexadecimais.'); process.exit(1); }
const dir = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const keep = Number(process.env.BACKUP_KEEP || 14);
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const raw = path.join(dir, `tmp-${stamp}.db`);
db.get().exec(`VACUUM INTO '${raw.replace(/'/g, "''")}'`);

const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([cipher.update(fs.readFileSync(raw)), cipher.final()]);
const out = path.join(dir, `barbearia-${stamp}.db.enc`);
fs.writeFileSync(out, Buffer.concat([Buffer.from('BEBK1'), iv, cipher.getAuthTag(), enc]));
fs.rmSync(raw);

// Verificação: decifra em arquivo temporário e roda integrity_check
const check = require('./restore').decrypt(out, key);
const tmp = path.join(dir, `verify-${stamp}.db`);
fs.writeFileSync(tmp, check);
const v = new DatabaseSync(tmp);
const ok = v.prepare('PRAGMA integrity_check').get();
const count = v.prepare('SELECT COUNT(*) c FROM appointments').get().c;
v.close(); fs.rmSync(tmp);
if (Object.values(ok)[0] !== 'ok') { console.error('Falha na verificação do backup!'); process.exit(2); }

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db.enc')).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.rmSync(path.join(dir, f));
console.log(`Backup criado e verificado: ${out} (${count} agendamentos). Copie para fora do servidor (R2/B2/Drive).`);
