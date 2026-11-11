'use strict';
// Conversões de data/hora sempre no fuso da barbearia (padrão America/Sao_Paulo).
const config = require('../config');

const partsFormatters = new Map();
function partsFormatter(tz) {
  if (!partsFormatters.has(tz)) {
    partsFormatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return partsFormatters.get(tz);
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zonedParts(utcMs, tz = config.timezone) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(utcMs))) p[type] = value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
    weekday: WEEKDAYS[p.weekday],
  };
}

function offsetMs(utcMs, tz = config.timezone) {
  const p = zonedParts(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function parseDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d };
}

// Data local (AAAA-MM-DD) + minutos desde a meia-noite local => epoch ms UTC
function localToUtc(dateStr, minutes, tz = config.timezone) {
  const p = parseDate(dateStr);
  if (!p) throw new Error('Data inválida');
  const naive = Date.UTC(p.y, p.mo - 1, p.d, 0, minutes, 0);
  let guess = naive - offsetMs(naive, tz);
  // segunda passada corrige transições de horário de verão
  guess = naive - offsetMs(guess, tz);
  return guess;
}

function pad(n) { return String(n).padStart(2, '0'); }

function utcToLocal(utcMs, tz = config.timezone) {
  const p = zonedParts(utcMs, tz);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    minutes: p.hour * 60 + p.minute,
    weekday: p.weekday,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

function todayLocal(now = Date.now()) { return utcToLocal(now).date; }

function addDays(dateStr, n) {
  const p = parseDate(dateStr);
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function weekdayOf(dateStr) {
  const p = parseDate(dateStr);
  return new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
}

function diffDays(a, b) {
  const pa = parseDate(a); const pb = parseDate(b);
  return Math.round((Date.UTC(pb.y, pb.mo - 1, pb.d) - Date.UTC(pa.y, pa.mo - 1, pa.d)) / 86400000);
}

function minutesToHHMM(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
function hhmmToMinutes(str) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(str || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatDateBR(dateStr) {
  const p = parseDate(dateStr);
  return p ? `${pad(p.d)}/${pad(p.mo)}/${p.y}` : '';
}

const longFmt = new Map();
function formatLong(utcMs, tz = config.timezone) {
  if (!longFmt.has(tz)) {
    longFmt.set(tz, new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }));
  }
  return longFmt.get(tz).format(new Date(utcMs));
}
function formatDateTimeBR(utcMs) {
  const l = utcToLocal(utcMs);
  return `${formatDateBR(l.date)} às ${l.time}`;
}

const WEEKDAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

module.exports = {
  localToUtc, utcToLocal, todayLocal, addDays, weekdayOf, diffDays, parseDate,
  minutesToHHMM, hhmmToMinutes, formatDateBR, formatLong, formatDateTimeBR,
  WEEKDAY_NAMES, WEEKDAY_SHORT, offsetMs,
};
