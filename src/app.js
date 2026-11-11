'use strict';
const path = require('node:path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const security = require('./lib/security');
const auth = require('./lib/auth');
const payments = require('./lib/payments');
const pages = require('./views/pages');
const { HttpError } = require('./lib/validate');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.use(security.securityHeaders);
  app.use('/fonts', express.static(path.join(__dirname, '..', 'public', 'fonts'), { maxAge: '365d', immutable: true }));
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    maxAge: config.isProduction ? '7d' : 0,
    setHeaders(res, file) { if (/\.(css|js)$/.test(file)) res.set('Cache-Control', 'public, max-age=604800'); },
  }));

  app.get('/healthz', (req, res) => {
    try { db.get().prepare('SELECT 1').get(); res.json({ ok: true }); } catch { res.status(500).json({ ok: false }); }
  });

  // Webhook do Mercado Pago: fora da checagem de origem (vem do servidor deles), validado por assinatura.
  app.post('/webhooks/mercadopago', express.json({ limit: '50kb' }), (req, res) => {
    payments.handleWebhook(req)
      .then((status) => res.sendStatus(status))
      .catch((err) => { console.error('[webhook mercadopago]', err.message); res.sendStatus(500); });
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(auth.loadSessions);
  app.use('/api', security.sameOrigin, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', require('./routes/api-public').router);
  app.use('/api/cliente', require('./routes/api-client').router);
  app.use('/api/admin', require('./routes/api-admin').router);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  // ---------- páginas ----------
  const page = (fn) => (req, res) => res.type('html').send(fn(res.locals.nonce));
  app.get('/', page(pages.home));
  app.get('/servicos', page(pages.servicesPage));
  app.get('/equipe', page(pages.teamPage));
  app.get('/sobre', page(pages.aboutPage));
  app.get('/galeria', page(pages.galleryPage));
  app.get('/contato', page(pages.contactPage));
  app.get('/agendar', page(pages.bookingPage));
  app.get('/agendar/retorno-pagamento', page(pages.paymentReturnPage));
  app.get('/cliente', (req, res) => { res.set('Cache-Control', 'no-store'); res.type('html').send(pages.clientPage(res.locals.nonce)); });
  app.get('/privacidade', page(pages.privacyPage));
  app.get('/termos', page(pages.termsPage));
  app.get(['/admin', '/admin/*'], (req, res) => { res.set('Cache-Control', 'no-store'); res.type('html').send(pages.adminShell(res.locals.nonce)); });

  // Link seguro do agendamento: troca o token da URL por um cookie e redireciona (o token some da barra de endereço).
  app.get('/cliente/acesso/:token', security.limiter('magic', { limit: 30, windowMs: 15 * 60000 }), (req, res) => {
    const token = String(req.params.token || '');
    const conn = db.get();
    const a = /^[\w-]{20,100}$/.test(token)
      ? conn.prepare('SELECT id, customer_id FROM appointments WHERE manage_token_hash = ? AND manage_token_expires_at > ?').get(security.hashToken(token), Date.now())
      : null;
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    if (!a) return res.redirect(303, '/cliente?link=invalido');
    const already = req.clientSession && req.clientSession.kind === 'cliente' && req.clientSession.customer.id === a.customer_id;
    if (!already) {
      auth.destroySession(req, res, 'cliente');
      auth.createSession(res, 'agendamento', { customerId: a.customer_id, appointmentId: a.id, ip: req.ip });
    }
    res.redirect(303, '/cliente');
  });

  app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nDisallow: /admin\nDisallow: /cliente\nDisallow: /api/\nSitemap: ${config.baseUrl}/sitemap.xml\n`));
  app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(pages.sitemap()));

  app.use((req, res) => res.status(404).type('html').send(pages.notFound(res.locals.nonce)));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Dados enviados em formato inválido.');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'Dados enviados grandes demais.');
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[erro]', err);
    const message = status >= 500 ? 'Erro interno. Tente novamente em instantes.' : err.message;
    if (req.path.startsWith('/api')) return res.status(status).json({ error: message, field: err.field });
    res.status(status).type('text').send(message);
  });

  return app;
}

module.exports = { createApp };
