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

app.listen(config.port, () => {
  console.log(`Barbearia Exemplo rodando em ${config.baseUrl} (porta ${config.port}, fuso ${config.timezone})`);
  const i = config.integrations();
  for (const [k, v] of Object.entries(i)) {
    if (!v.ready) console.log(`  · ${v.provider}: não configurado (faltando ${v.missing.join(', ')})`);
  }
});
