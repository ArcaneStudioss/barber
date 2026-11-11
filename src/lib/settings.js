'use strict';
// Configurações editáveis pelo painel. Valores entre [colchetes] são campos para substituir.
const db = require('../db');

const DEFAULTS = {
  business: {
    name: 'Barbearia Exemplo',
    tagline: 'Corte, barba e cuidado no tempo certo.',
    description: '[DESCRIÇÃO DA BARBEARIA: conte em 2 ou 3 frases a história, o estilo e o que torna o atendimento especial.]',
    city: '[CIDADE]',
    state: '[UF]',
    neighborhood: '[BAIRRO]',
    street: '[RUA E NÚMERO]',
    postalCode: '[CEP]',
    phone: '',               // só dígitos com DDI, ex.: 5511999999999
    whatsapp: '',            // só dígitos com DDI
    email: '',
    instagram: '',           // usuário sem @
    mapEmbedUrl: '',         // URL de incorporação do Google Maps (https://www.google.com/maps/embed?...)
    mapLinkUrl: '',          // link "abrir no mapa"
    latitude: '',
    longitude: '',
    priceRange: '$$',
    cnpj: '',
    legalName: '',
    dpoContact: '',          // canal de privacidade (LGPD); se vazio usa e-mail
  },
  booking: {
    slotStepMin: 15,             // de quantos em quantos minutos os horários aparecem
    minAdvanceMin: 120,          // antecedência mínima para agendar online
    maxDaysAhead: 30,            // até quantos dias à frente
    autoConfirm: true,           // agendamento online já entra como confirmado
    cancelMinHours: 3,           // cliente pode cancelar até X horas antes
    rescheduleMinHours: 3,       // cliente pode reagendar até X horas antes
    maxReschedules: 2,
    allowClientCancel: true,
    allowClientReschedule: true,
    maxServicesPerBooking: 4,
    policyText: 'Cancelamentos e reagendamentos podem ser feitos pelo site até 3 horas antes do horário marcado. Depois disso, fale com a barbearia pelo WhatsApp.',
  },
  notifications: {
    emailEnabled: true,
    whatsappEnabled: true,
    reminderHoursBefore: [24, 2],
  },
  payments: {
    mode: 'desligado',           // desligado | sinal | integral
    depositPercent: 30,
    holdMinutes: 30,             // tempo para pagar antes de liberar o horário
    methods: ['pix', 'cartao'],
  },
};

let cache = null;

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function all() {
  if (cache) return cache;
  const rows = db.get().prepare('SELECT key, value FROM settings').all();
  const stored = {};
  for (const r of rows) {
    try { stored[r.key] = JSON.parse(r.value); } catch { /* ignora valor corrompido */ }
  }
  cache = deepMerge(DEFAULTS, stored);
  return cache;
}

function section(name) { return all()[name]; }

function save(name, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, name)) throw new Error('Seção inválida');
  const merged = deepMerge(section(name), value);
  db.get().prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(name, JSON.stringify(merged));
  cache = null;
  return section(name);
}

function invalidate() { cache = null; }

function isPlaceholder(value) { return typeof value === 'string' && /^\[.*\]$/.test(value.trim()); }

module.exports = { all, section, save, invalidate, DEFAULTS, isPlaceholder };
