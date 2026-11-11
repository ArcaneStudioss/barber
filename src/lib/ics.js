'use strict';
const settings = require('./settings');
const config = require('../config');

function stamp(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function escIcs(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }

function address(biz) {
  return [biz.street, biz.neighborhood, `${biz.city}${biz.state ? ` - ${biz.state}` : ''}`]
    .filter((p) => p && !settings.isPlaceholder(p) && !/^\[/.test(p)).join(', ');
}

function ics(a) {
  const biz = settings.section('business');
  const summary = `${biz.name}: ${a.services.map((s) => s.name).join(', ')}`;
  const desc = `Profissional: ${a.professional_name}\nNúmero do agendamento: ${a.code}\nGerenciar: ${config.baseUrl}/cliente`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barbearia Exemplo//Agendamento//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${a.code}@${new URL(config.baseUrl).hostname}`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(a.start_at)}`,
    `DTEND:${stamp(a.end_at)}`,
    `SUMMARY:${escIcs(summary)}`,
    `DESCRIPTION:${escIcs(desc)}`,
    `LOCATION:${escIcs(address(biz))}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(summary)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

function googleLink(a) {
  const biz = settings.section('business');
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${biz.name}: ${a.services.map((s) => s.name).join(', ')}`,
    dates: `${stamp(a.start_at)}/${stamp(a.end_at)}`,
    details: `Profissional: ${a.professional_name}. Número: ${a.code}`,
    location: address(biz),
    ctz: config.timezone,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

module.exports = { ics, googleLink, address };
