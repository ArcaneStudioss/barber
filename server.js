'use strict';
const config = require('./src/config');
const { bootstrap } = require('./src/bootstrap');
const { createApp } = require('./src/app');
const notify = require('./src/lib/notify');
const auth = require('./src/lib/auth');

bootstrap();
const app = createApp();
notify.startWorker();
setInterval(() => { try { auth.cleanup(); } catch (e) { console.error(e.message); } }, 3600000).unref();

const server = app.listen(config.port, () => {
  console.log(`Barbearia Exemplo rodando em ${config.baseUrl} (porta ${config.port}, fuso ${config.timezone})`);
  const i = config.integrations();
  for (const [k, v] of Object.entries(i)) {
    if (!v.ready) console.log(`  · ${v.provider}: não configurado (faltando ${v.missing.join(', ')})`);
  }
});

// Encerramento limpo (deploy automático e docker stop): termina as requisições em andamento e sai.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} recebido, encerrando`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
