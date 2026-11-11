/* Barbearia Exemplo · scripts compartilhados do site */
(function () {
  'use strict';

  // ---------- utilidades ----------
  const BE = (window.BE = window.BE || {});

  BE.api = async function api(url, { method = 'GET', body } = {}) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* sem corpo */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Não foi possível concluir. Verifique sua conexão e tente de novo.');
      err.status = res.status; err.field = data.field;
      throw err;
    }
    return data;
  };

  BE.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  BE.money = (cents) => brl.format((cents || 0) / 100);
  BE.duration = (min) => { const h = Math.floor(min / 60); const m = min % 60; return h ? (m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`) : `${m} min`; };
  BE.dateBR = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const WD = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  BE.MONTHS = MONTHS;
  BE.weekday = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  BE.dateLong = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${WD[BE.weekday(iso)]}, ${d} de ${MONTHS[m - 1]}`; };
  BE.addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
  BE.phoneMask = (v) => {
    const d = String(v).replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
    if (d.length <= 2) return d ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  // Modal próprio (nunca alert/confirm do navegador)
  BE.modal = function modal({ title, html, confirmText = 'Confirmar', cancelText = 'Voltar', danger = false }) {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'modal';
      el.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="mdl-t"><h2 id="mdl-t">${BE.esc(title)}</h2><div class="mdl-body">${html || ''}</div>
        <div class="modal-actions">${cancelText ? `<button type="button" class="btn btn-ghost" data-r="0">${BE.esc(cancelText)}</button>` : ''}<button type="button" class="btn ${danger ? 'btn-danger' : 'btn-dark'}" data-r="1">${BE.esc(confirmText)}</button></div></div>`;
      const prev = document.activeElement;
      document.body.appendChild(el);
      const close = (v) => { el.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); resolve(v); };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Tab') {
          const f = el.querySelectorAll('button, input, select, textarea, a[href]');
          if (!f.length) return;
          if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
      };
      document.addEventListener('keydown', onKey);
      el.addEventListener('click', (e) => {
        if (e.target === el) return close(false);
        const b = e.target.closest('[data-r]');
        if (b) close(b.dataset.r === '1' ? (el.querySelector('form, .mdl-body') || true) : false);
      });
      (el.querySelector('input, select, textarea') || el.querySelector('[data-r="1"]')).focus();
    });
  };

  let toastTimer;
  BE.toast = function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  };

  // ---------- menu ----------
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('menu');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('open', open);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('open')) { toggle.click(); toggle.focus(); }
    });
  }

  // ---------- formulário LGPD ----------
  const pf = document.getElementById('privacy-form');
  if (pf) {
    pf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = pf.querySelector('.form-status');
      const data = Object.fromEntries(new FormData(pf));
      const btn = pf.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await BE.api('/api/privacidade', { method: 'POST', body: data });
        pf.reset();
        status.innerHTML = '<div class="alert alert-ok">Pedido enviado. Vamos responder pelo contato informado em até 15 dias.</div>';
      } catch (err) {
        status.innerHTML = `<div class="alert alert-error">${BE.esc(err.message)}</div>`;
      } finally { btn.disabled = false; }
    });
  }
})();
