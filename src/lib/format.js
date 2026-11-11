'use strict';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function money(cents) { return brl.format((Number(cents) || 0) / 100).replace(/ /g, ' '); }

function phoneDisplay(digits) {
  const d = String(digits || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

function duration(min) {
  const h = Math.floor(min / 60); const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function maskEmail(email) {
  if (!email) return '';
  const [u, d] = email.split('@');
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
}
function maskPhone(digits) {
  const d = phoneDisplay(digits);
  return d.replace(/\d(?=\d{2})/g, (c, i) => (i < 4 ? c : '•'));
}

function waLink(digits, message) {
  if (!digits) return '';
  return `https://wa.me/${String(digits).replace(/\D/g, '')}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

module.exports = { money, phoneDisplay, duration, maskEmail, maskPhone, waLink };
