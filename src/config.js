'use strict';
// Toda configuração sensível vem de variáveis de ambiente. Veja .env.example.
const path = require('node:path');
const fs = require('node:fs');

// Carrega .env local (sem dependência externa). Variáveis já definidas no ambiente têm prioridade.
function loadDotEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

const config = {
  isProduction,
  port: Number(env.PORT || 8080),
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 8080}`).replace(/\/$/, ''),
  databaseFile: env.DATABASE_FILE || path.join(__dirname, '..', 'data', 'barbearia.db'),
  timezone: env.TZ_BARBEARIA || 'America/Sao_Paulo',
  trustProxy: env.TRUST_PROXY === '1',
  // Segredo usado para assinar/derivar tokens. Obrigatório em produção.
  appSecret: env.APP_SECRET || '',
  devConsoleNotifications: !isProduction && env.DEV_CONSOLE_NOTIFICATIONS === '1',

  email: {
    resendApiKey: env.RESEND_API_KEY || '',
    from: env.EMAIL_FROM || '',
  },
  whatsapp: {
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
    templateLanguage: env.WHATSAPP_TEMPLATE_LANG || 'pt_BR',
    templates: {
      confirmacao: env.WHATSAPP_TEMPLATE_CONFIRMACAO || '',
      lembrete: env.WHATSAPP_TEMPLATE_LEMBRETE || '',
      cancelamento: env.WHATSAPP_TEMPLATE_CANCELAMENTO || '',
      reagendamento: env.WHATSAPP_TEMPLATE_REAGENDAMENTO || '',
      codigo: env.WHATSAPP_TEMPLATE_CODIGO || '',
    },
  },
  mercadopago: {
    accessToken: env.MP_ACCESS_TOKEN || '',
    webhookSecret: env.MP_WEBHOOK_SECRET || '',
  },
};

if (isProduction) {
  if (!config.appSecret || config.appSecret.length < 32) {
    throw new Error('APP_SECRET precisa ter pelo menos 32 caracteres em produção.');
  }
  if (!config.baseUrl.startsWith('https://')) {
    throw new Error('BASE_URL precisa começar com https:// em produção.');
  }
}
if (!config.appSecret) config.appSecret = 'dev-only-secret-nao-use-em-producao-0000';

config.integrations = function integrations() {
  const missing = (pairs) => pairs.filter(([, v]) => !v).map(([k]) => k);
  const emailMissing = missing([['RESEND_API_KEY', config.email.resendApiKey], ['EMAIL_FROM', config.email.from]]);
  const waMissing = missing([
    ['WHATSAPP_TOKEN', config.whatsapp.token],
    ['WHATSAPP_PHONE_NUMBER_ID', config.whatsapp.phoneNumberId],
    ['WHATSAPP_TEMPLATE_CONFIRMACAO', config.whatsapp.templates.confirmacao],
    ['WHATSAPP_TEMPLATE_LEMBRETE', config.whatsapp.templates.lembrete],
  ]);
  const waOptional = missing([
    ['WHATSAPP_TEMPLATE_CANCELAMENTO', config.whatsapp.templates.cancelamento],
    ['WHATSAPP_TEMPLATE_REAGENDAMENTO', config.whatsapp.templates.reagendamento],
    ['WHATSAPP_TEMPLATE_CODIGO', config.whatsapp.templates.codigo],
  ]);
  const mpMissing = missing([['MP_ACCESS_TOKEN', config.mercadopago.accessToken], ['MP_WEBHOOK_SECRET', config.mercadopago.webhookSecret]]);
  return {
    email: { ready: emailMissing.length === 0, missing: emailMissing, provider: 'Resend' },
    whatsapp: { ready: waMissing.length === 0, missing: waMissing, optionalMissing: waOptional, provider: 'WhatsApp Cloud API (Meta)' },
    mercadopago: { ready: mpMissing.length === 0 && config.baseUrl.startsWith('https://'), missing: config.baseUrl.startsWith('https://') ? mpMissing : [...mpMissing, 'BASE_URL com https://'], provider: 'Mercado Pago' },
  };
};

module.exports = config;
