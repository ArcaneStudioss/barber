'use strict';
// Restaura um backup criptografado. Uso:
// BACKUP_KEY=<chave> node scripts/restore.js backups/arquivo.db.enc data/restaurado.db
// Pare o servidor antes de substituir data/barbearia.db pelo arquivo restaurado.
const fs = require('node:fs');
const crypto = require('node:crypto');

function decrypt(file, key) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 5).toString() !== 'BEBK1') throw new Error('Arquivo de backup inválido.');
  const iv = buf.subarray(5, 17); const tag = buf.subarray(17, 33);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(33)), d.final()]);
}

if (require.main === module) {
  const [src, dest] = process.argv.slice(2);
  const key = Buffer.from(process.env.BACKUP_KEY || '', 'hex');
  if (!src || !dest || key.length !== 32) { console.error('Uso: BACKUP_KEY=<hex> node scripts/restore.js <backup.db.enc> <destino.db>'); process.exit(1); }
  if (fs.existsSync(dest)) { console.error(`${dest} já existe. Escolha outro destino.`); process.exit(1); }
  fs.writeFileSync(dest, decrypt(src, key));
  console.log(`Restaurado em ${dest}.`);
}
module.exports = { decrypt };
