'use strict';
// Validação no servidor. Toda entrada externa passa por aqui.

class HttpError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

function fail(message, field, status = 400) { throw new HttpError(status, message, field); }

function text(value, { field, label, min = 0, max = 200, required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' && typeof value !== 'number') fail(`${label || field} inválido.`, field);
  // remove caracteres de controle, mantém quebras de linha
  const v = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (required && !v) fail(`Informe ${label || field}.`, field);
  if (v && v.length < min) fail(`${label || field} precisa ter pelo menos ${min} caracteres.`, field);
  if (v.length > max) fail(`${label || field} pode ter no máximo ${max} caracteres.`, field);
  return v;
}

function name(value, field = 'name') {
  const v = text(value, { field, label: 'seu nome', min: 2, max: 80, required: true });
  if (!/\p{L}/u.test(v)) fail('Informe um nome válido.', field);
  return v.replace(/\s+/g, ' ');
}

// Telefone brasileiro: aceita com ou sem +55, retorna só dígitos com DDI 55.
function phoneBR(value, field = 'phone', { required = true } = {}) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) { if (required) fail('Informe seu telefone com DDD.', field); return ''; }
  let d = digits;
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  else if (d.length === 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) fail('Telefone inválido. Use DDD + número, ex.: (11) 91234-5678.', field);
  if (/^0/.test(d) || /^(\d)\1+$/.test(d)) fail('Telefone inválido.', field);
  if (d.length === 11 && d[2] !== '9') fail('Celular deve começar com 9 depois do DDD.', field);
  return `55${d}`;
}

function email(value, field = 'email', { required = false } = {}) {
  const v = text(value, { field, label: 'e-mail', max: 120, required }).toLowerCase();
  if (!v) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) fail('E-mail inválido.', field);
  return v;
}

function int(value, { field, label, min = -Infinity, max = Infinity, required = true } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  const n = Number(value);
  if (!Number.isInteger(n)) fail(`${label || field} inválido.`, field);
  if (n < min || n > max) fail(`${label || field} fora do limite permitido.`, field);
  return n;
}

function bool(value) { return value === true || value === 1 || value === '1' || value === 'true' || value === 'on'; }

function oneOf(value, list, field) {
  if (!list.includes(value)) fail(`${field} inválido.`, field);
  return value;
}

function idList(value, field, { min = 1, max = 10 } = {}) {
  if (!Array.isArray(value)) fail('Escolha pelo menos um serviço.', field);
  const ids = [...new Set(value.map((v) => Number(v)))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) fail('Seleção inválida.', field);
  if (ids.length < min) fail('Escolha pelo menos um serviço.', field);
  if (ids.length > max) fail(`Escolha no máximo ${max} serviços.`, field);
  return ids;
}

// Preço digitado em reais ("45,90" ou 45.9) => centavos
function priceToCents(value, field = 'price') {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) fail('Preço inválido.', field);
    return Math.round(value * 100);
  }
  let s = String(value ?? '').trim().replace(/^R\$\s?/, '');
  s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(s);
  if (!s || !Number.isFinite(n) || n < 0 || n > 100000) fail('Preço inválido.', field);
  return Math.round(n * 100);
}

module.exports = { HttpError, fail, text, name, phoneBR, email, int, bool, oneOf, idList, priceToCents };
