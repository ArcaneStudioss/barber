/* Painel administrativo · Barbearia Exemplo */
(function () {
  'use strict';
  const app = document.getElementById('admin-app');

  // ---------- utilidades ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const money = (c) => brl.format((c || 0) / 100);
  const dur = (m) => { const h = Math.floor(m / 60); const r = m % 60; return h ? (r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`) : `${r} min`; };
  const dateBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const WD = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const weekday = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const dateLong = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${WD[weekday(iso)]}, ${d} de ${MONTHS[m - 1]}`; };
  const fmtTs = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: window.__TZ__, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const phone = (d) => { const s = String(d || '').replace(/^55(?=\d{10,11}$)/, ''); return s.length === 11 ? `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}` : s.length === 10 ? `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}` : s; };
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const hhmm = (m) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  const STATUS = { pendente: 'Pendente', confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado', nao_compareceu: 'Não compareceu' };
  const SOURCE = { online: 'Site', telefone: 'Telefone', presencial: 'Presencial', whatsapp: 'WhatsApp', painel: 'Painel' };
  const badge = (s) => `<span class="badge st-${s}">${STATUS[s] || s}</span>`;

  async function api(url, { method = 'GET', body } = {}) {
    const res = await fetch(`/api/admin${url}`, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let data = {};
    try { data = await res.json(); } catch (e) { /* vazio */ }
    if (res.status === 401 && !url.startsWith('/login')) { S.me = null; renderLogin(); throw Object.assign(new Error('Sessão expirada.'), { silent: true }); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Não foi possível concluir.'), { status: res.status, field: data.field });
    return data;
  }

  let toastT;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3500);
  }
  const fail = (err) => { if (!err.silent) toast(err.message); };

  // Modal próprio. actions: [{ label, cls, run: async (box) => fecha? }]
  function modal({ title, body, wide = false, actions = [], onOpen }) {
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="modal-box ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="m-title">
      <div class="modal-head"><h2 id="m-title">${esc(title)}</h2><button class="x" type="button" aria-label="Fechar">×</button></div>
      <div class="m-body">${body}</div><div class="m-err" role="alert"></div>
      ${actions.length ? `<div class="modal-actions">${actions.map((a, i) => `<button type="button" class="btn ${a.cls || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
    const prev = document.activeElement;
    document.body.appendChild(el);
    const close = () => { el.remove(); document.removeEventListener('keydown', key); if (prev && prev.focus) prev.focus(); };
    const key = (e) => {
      if (e.key === 'Escape' && document.body.lastElementChild === el) close();
      if (e.key === 'Tab') {
        const f = [...el.querySelectorAll('button:not([disabled]), input, select, textarea, a[href]')];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    el.querySelector('.x').addEventListener('click', close);
    const errBox = el.querySelector('.m-err');
    el.showError = (m) => { errBox.innerHTML = m ? `<div class="alert alert-error">${esc(m)}</div>` : ''; };
    el.close = close;
    el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
      const a = actions[Number(b.dataset.i)];
      if (!a.run) return close();
      b.disabled = true; el.showError('');
      try { const keep = await a.run(el); if (keep !== true) close(); } catch (err) {
        el.showError(err.message);
        if (err.field) { const f = el.querySelector(`[name="${err.field}"]`); if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); } }
      } finally { b.disabled = false; }
    }));
    if (onOpen) onOpen(el);
    const first = el.querySelector('.m-body input:not([type=hidden]), .m-body select, .m-body textarea') || el.querySelector('[data-i]') || el.querySelector('.x');
    first.focus();
    return el;
  }
  function confirmModal(title, text, label = 'Confirmar', danger = false) {
    return new Promise((resolve) => {
      modal({ title, body: `<p>${esc(text)}</p>`, actions: [{ label: 'Voltar', run: () => resolve(false) }, { label, cls: danger ? 'btn-danger' : 'btn-primary', run: () => resolve(true) }] });
    });
  }
  const formData = (root) => {
    const out = {};
    root.querySelectorAll('[name]').forEach((el) => {
      if (el.type === 'checkbox') { if (el.dataset.multi) { out[el.name] = out[el.name] || []; if (el.checked) out[el.name].push(el.value); } else out[el.name] = el.checked; } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; } else out[el.name] = el.value;
    });
    return out;
  };

  // ---------- estado e navegação ----------
  const S = { me: null, pros: [], services: [], view: null };
  const isAdmin = () => S.me && S.me.user.role === 'admin';

  const ROUTES = {
    hoje: { label: 'Hoje', fn: viewToday },
    agenda: { label: 'Agenda', fn: viewAgenda },
    clientes: { label: 'Clientes', fn: viewCustomers },
    bloqueios: { label: 'Folgas e bloqueios', fn: viewTimeOff },
    servicos: { label: 'Serviços', fn: viewServices, admin: true, group: 'Cadastros' },
    equipe: { label: 'Equipe e horários', fn: viewPros, admin: true },
    relatorios: { label: 'Relatórios', fn: viewReports, admin: true, group: 'Gestão' },
    notificacoes: { label: 'Notificações', fn: viewNotifications, admin: true },
    privacidade: { label: 'Pedidos LGPD', fn: viewPrivacy, admin: true },
    usuarios: { label: 'Usuários', fn: viewUsers, admin: true },
    configuracoes: { label: 'Configurações', fn: viewSettings, admin: true },
    conta: { label: 'Minha senha', fn: viewAccount, group: 'Conta' },
  };

  async function boot() {
    try {
      S.me = await api('/me');
      await loadRefs();
      renderShell();
      route();
    } catch (err) { if (!err.silent) renderLogin(); }
  }
  async function loadRefs() {
    const [p, s] = await Promise.all([api('/professionals'), api('/services')]);
    S.pros = p.professionals; S.services = s.services;
  }

  function renderLogin() {
    app.innerHTML = `<div class="login"><form class="card" id="login" novalidate>
      <img class="logo" src="/img/logo-mark.svg" alt=""><h1>Painel da barbearia</h1>
      <div class="field"><label for="l-email">E-mail</label><input class="input" id="l-email" name="email" type="email" autocomplete="username" required></div>
      <div class="field"><label for="l-pw">Senha</label><input class="input" id="l-pw" name="password" type="password" autocomplete="current-password" required></div>
      <div class="l-err" role="alert"></div>
      <button class="btn btn-primary" style="width:100%" type="submit">Entrar</button>
      <p class="small muted" style="margin-top:14px;text-align:center"><a href="/">Voltar ao site</a></p></form></div>`;
    const f = document.getElementById('login');
    f.email.focus();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = f.querySelector('button'); b.disabled = true;
      try { await api('/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } }); boot(); } catch (err) { f.querySelector('.l-err').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; b.disabled = false; f.password.select(); }
    });
  }

  function renderShell() {
    const u = S.me.user;
    let lastGroup = null;
    app.innerHTML = `<div class="shell">
      <header class="topbar"><a class="brand" href="#/hoje"><img src="/img/logo-mark.svg" alt="">${esc(S.me.business.name)}</a>
        <span class="who">${esc(u.name)} · ${u.role === 'admin' ? 'Administrador' : 'Profissional'}</span>
        <a class="btn btn-sm hide-mob" href="/" target="_blank" rel="noopener" style="background:none;color:#fff;border-color:#3a3632">Ver site</a>
        <button class="btn btn-sm" id="logout" style="background:none;color:#fff;border-color:#3a3632">Sair</button>
        <button class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="sidenav">Menu</button></header>
      <div class="layout"><nav class="sidenav" id="sidenav" aria-label="Seções">
        ${Object.entries(ROUTES).filter(([, r]) => !r.admin || isAdmin()).map(([k, r]) => {
          const g = r.group && r.group !== lastGroup ? `<div class="group">${r.group}</div>` : '';
          if (r.group) lastGroup = r.group;
          return `${g}<a href="#/${k}" data-route="${k}">${r.label}<span class="count" data-count="${k}" hidden></span></a>`;
        }).join('')}
      </nav><main class="view" id="view" tabindex="-1"></main></div></div>`;
    document.getElementById('logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }).catch(() => {}); S.me = null; renderLogin(); });
    const mb = document.getElementById('menu-btn'); const nav = document.getElementById('sidenav');
    mb.addEventListener('click', () => { const o = !nav.classList.contains('open'); nav.classList.toggle('open', o); mb.setAttribute('aria-expanded', String(o)); });
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('open'); mb.setAttribute('aria-expanded', 'false'); } });
  }

  function route() {
    if (!S.me) return;
    const [name, ...rest] = (location.hash.replace(/^#\/?/, '') || 'hoje').split('/');
    const r = ROUTES[name] && (!ROUTES[name].admin || isAdmin()) ? ROUTES[name] : ROUTES.hoje;
    document.querySelectorAll('.sidenav a').forEach((a) => { if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const view = document.getElementById('view');
    view.innerHTML = '<p class="muted">Carregando...</p>';
    document.title = `${r.label} | Painel`;
    Promise.resolve(r.fn(view, rest)).catch((err) => { if (!err.silent) view.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; });
  }
  window.addEventListener('hashchange', route);
  const refresh = () => route();

  // ---------- HOJE ----------
  async function viewToday(view, [dateParam]) {
    const date = dateParam || S.me.today;
    const d = await api(`/dashboard?date=${date}`);
    const pending = d.appointments.filter((a) => a.status === 'concluido').reduce((s, a) => s + Math.max(0, a.total_price_cents - a.paid_cents), 0);
    const alerts = [];
    if (d.alerts.pendingPrivacy) alerts.push(`<a href="#/privacidade">${d.alerts.pendingPrivacy} pedido(s) de privacidade (LGPD) aguardando resposta</a>`);
    if (d.alerts.failedNotifications) alerts.push(`<a href="#/notificacoes">${d.alerts.failedNotifications} notificação(ões) com falha nos últimos 7 dias</a>`);
    if (d.alerts.refundNeeded) alerts.push(`<a href="#/notificacoes">${d.alerts.refundNeeded} pagamento(s) recebido(s) para agendamento já ocupado: avalie estorno</a>`);
    const pc = document.querySelector('[data-count="privacidade"]'); if (pc) { pc.hidden = !d.alerts.pendingPrivacy; pc.textContent = d.alerts.pendingPrivacy; }
    view.innerHTML = `
      <div class="view-head"><h1>${date === d.today ? 'Hoje' : esc(dateLong(date))}</h1>
        <div class="toolbar"><a class="btn btn-sm" href="#/hoje/${addDays(date, -1)}" aria-label="Dia anterior">‹</a><a class="btn btn-sm" href="#/hoje">Hoje</a><a class="btn btn-sm" href="#/hoje/${addDays(date, 1)}" aria-label="Próximo dia">›</a>
        <button class="btn btn-primary" id="new">Novo agendamento</button></div></div>
      ${alerts.map((a) => `<div class="alert">${a}</div>`).join('')}
      <div class="grid grid-4" style="margin-bottom:18px">
        <div class="kpi"><div class="label">Atendimentos</div><div class="value">${d.appointments.filter((a) => !['cancelado'].includes(a.status)).length}</div><div class="hint">${d.counts.confirmado} confirmados, ${d.counts.pendente} pendentes, ${d.counts.concluido} concluídos</div></div>
        <div class="kpi expected"><div class="label">Valor previsto</div><div class="value">${money(d.expected_cents)}</div><div class="hint">Soma dos agendamentos não cancelados</div></div>
        <div class="kpi received"><div class="label">Valor recebido</div><div class="value">${money(d.received_cents)}</div><div class="hint">Pagamentos registrados ou confirmados</div></div>
        <div class="kpi pending"><div class="label">Pendente de pagamento</div><div class="value">${money(pending)}</div><div class="hint">Concluídos sem pagamento total</div></div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        ${d.appointments.length ? d.appointments.map((a) => `
          <div class="appt-row" data-id="${a.id}" tabindex="0" role="button" aria-label="Abrir agendamento de ${esc(a.customer_name)} às ${a.time}">
            <div><div class="t">${a.time}</div><div class="small muted">${a.end_time}</div></div>
            <div><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><strong>${esc(a.customer_name)}</strong>${badge(a.status)}</div>
              <div class="small">${esc(a.services)} · ${esc(a.professional_name)} · ${money(a.total_price_cents)}${a.paid_cents ? ` · <span style="color:var(--ok)">pago ${money(a.paid_cents)}</span>` : ''}</div>
              <div class="actions">${quickActions(a)}</div></div>
          </div>`).join('') : '<div class="empty">Nenhum agendamento neste dia.</div>'}
      </div>`;
    view.querySelector('#new').addEventListener('click', () => newAppointment({ date }));
    bindApptRows(view);
  }

  function quickActions(a) {
    const out = [];
    if (a.status === 'pendente') out.push(`<button class="btn btn-sm" data-q="confirmado" data-id="${a.id}">Confirmar</button>`);
    if (['pendente', 'confirmado'].includes(a.status)) {
      out.push(`<button class="btn btn-sm" data-q="concluido" data-id="${a.id}">Concluído</button>`);
      out.push(`<button class="btn btn-sm" data-q="nao_compareceu" data-id="${a.id}">Não veio</button>`);
    }
    if (a.status === 'concluido' && a.paid_cents < a.total_price_cents) out.push(`<button class="btn btn-sm btn-brass" data-pay="${a.id}">Registrar pagamento</button>`);
    return out.join('');
  }
  function bindApptRows(view) {
    view.querySelectorAll('.appt-row').forEach((r) => {
      const open = (e) => { if (e.target.closest('button')) return; openAppointment(Number(r.dataset.id)); };
      r.addEventListener('click', open);
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === r) open(e); });
    });
    view.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/appointments/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.q } }); toast(`Marcado como ${STATUS[b.dataset.q].toLowerCase()}.`); refresh(); } catch (err) { fail(err); }
    }));
    view.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', async () => {
      const { appointment } = await api(`/appointments/${b.dataset.pay}`);
      recordPayment(appointment);
    }));
  }

  // ---------- DETALHE DO AGENDAMENTO ----------
  async function openAppointment(id) {
    let a;
    try { a = (await api(`/appointments/${id}`)).appointment; } catch (err) { return fail(err); }
    const active = ['pendente', 'confirmado'].includes(a.status);
    const started = a.start_at <= Date.now();
    const pending = Math.max(0, a.total_price_cents - a.paid_cents);
    const m = modal({
      title: `${a.customer_name} · ${a.time}`, wide: true,
      body: `<div class="grid grid-2">
        <dl class="kv">
          <dt>Status</dt><dd>${badge(a.status)}</dd>
          <dt>Número</dt><dd>${esc(a.code)}</dd>
          <dt>Quando</dt><dd>${esc(dateLong(a.date))}, ${a.time} às ${a.end_time}</dd>
          <dt>Profissional</dt><dd>${esc(a.professional_name)}</dd>
          <dt>Serviços</dt><dd>${a.services.map((s) => `${esc(s.name)} <span class="muted">(${dur(s.duration_min)}, ${money(s.price_cents)})</span>`).join('<br>')}</dd>
          <dt>Origem</dt><dd>${SOURCE[a.source] || a.source}</dd>
        </dl>
        <dl class="kv">
          <dt>Cliente</dt><dd>${esc(a.customer_name)}</dd>
          <dt>Celular</dt><dd><a href="https://wa.me/${esc(a.customer_phone)}" target="_blank" rel="noopener">${esc(phone(a.customer_phone))}</a></dd>
          ${a.customer_email ? `<dt>E-mail</dt><dd>${esc(a.customer_email)}</dd>` : ''}
          <dt>Valor previsto</dt><dd>${money(a.total_price_cents)}</dd>
          <dt>Recebido</dt><dd>${money(a.paid_cents)}</dd>
          <dt>Pendente</dt><dd>${a.status === 'cancelado' ? '-' : money(pending)}</dd>
          ${a.payment_required_cents ? `<dt>Cobrança online</dt><dd>${money(a.payment_required_cents)}${a.status === 'pendente' ? ` até ${fmtTs(a.payment_expires_at)}` : ''}</dd>` : ''}
        </dl></div>
        ${a.cancel_reason ? `<div class="alert" style="margin-top:12px">Cancelado: ${esc(a.cancel_reason)}</div>` : ''}
        <div class="field" style="margin-top:16px"><label for="a-notes">Observações internas</label><textarea class="input" id="a-notes" name="notes" maxlength="500">${esc(a.notes)}</textarea></div>
        <div class="toolbar" style="margin-bottom:14px"><button class="btn btn-sm" id="save-notes">Salvar observação</button></div>
        <h3>Status</h3>
        <div class="toolbar" style="margin-bottom:14px">${Object.keys(STATUS).filter((s) => s !== a.status).filter((s) => !(['concluido', 'nao_compareceu'].includes(s) && !started)).filter((s) => !(a.status === 'cancelado')).map((s) => `<button class="btn btn-sm ${s === 'cancelado' ? 'btn-danger' : ''}" data-st="${s}">${STATUS[s]}</button>`).join('') || '<span class="muted small">Agendamento cancelado não pode ser reaberto. Crie um novo.</span>'}</div>
        <div class="toolbar" style="margin-bottom:14px">
          ${active ? '<button class="btn btn-sm" id="resched">Remarcar</button>' : ''}
          ${a.status !== 'cancelado' ? '<button class="btn btn-sm btn-brass" id="pay">Registrar pagamento</button>' : ''}
        </div>
        ${a.payments.length ? `<h3>Pagamentos</h3><div class="table-wrap"><table class="list"><thead><tr><th>Data</th><th>Origem</th><th>Forma</th><th class="right">Valor</th><th>Status</th><th></th></tr></thead><tbody>${a.payments.map((p) => `<tr><td>${fmtTs(p.created_at)}</td><td>${p.provider === 'balcao' ? 'Balcão' : 'Mercado Pago'}</td><td>${esc(p.method)}</td><td class="right num">${money(p.amount_cents)}${p.refunded_cents ? ` <span class="muted">(-${money(p.refunded_cents)})</span>` : ''}</td><td>${esc(p.status)}</td><td>${isAdmin() && p.status === 'aprovado' ? `<button class="btn btn-sm" data-refund="${p.id}">Estornar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${a.notifications.length ? `<h3 style="margin-top:14px">Notificações</h3><ul class="timeline">${a.notifications.map((n) => `<li><span class="badge n-${n.status}">${esc(n.status.replace('_', ' '))}</span> ${esc(n.channel)} · ${esc(n.kind)} · ${fmtTs(n.sent_at || n.scheduled_for)}${n.last_error ? ` <span class="muted">(${esc(n.last_error)})</span>` : ''}</li>`).join('')}</ul>` : ''}
        <h3 style="margin-top:14px">Histórico</h3><ul class="timeline">${a.events.map((e) => `<li>${fmtTs(e.created_at)} · <strong>${esc(e.type)}</strong> ${esc(e.detail)} <span class="muted">${esc(e.actor)}</span></li>`).join('')}</ul>`,
    });
    m.querySelector('#save-notes').addEventListener('click', async () => {
      try { await api(`/appointments/${a.id}`, { method: 'PATCH', body: { notes: m.querySelector('#a-notes').value } }); toast('Observação salva.'); } catch (err) { m.showError(err.message); }
    });
    m.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => {
      const st = b.dataset.st;
      let reason = '';
      if (st === 'cancelado') {
        const ok = await confirmModal('Cancelar agendamento?', 'O horário volta a ficar livre e o cliente recebe aviso (se as notificações estiverem configuradas).', 'Cancelar agendamento', true);
        if (!ok) return;
        reason = 'Cancelado pela barbearia';
      }
      try { await api(`/appointments/${a.id}/status`, { method: 'POST', body: { status: st, reason } }); m.close(); toast(`Status: ${STATUS[st]}.`); refresh(); } catch (err) { m.showError(err.message); }
    }));
    const rs = m.querySelector('#resched'); if (rs) rs.addEventListener('click', () => { m.close(); reschedule(a); });
    const pay = m.querySelector('#pay'); if (pay) pay.addEventListener('click', () => { m.close(); recordPayment(a); });
    m.querySelectorAll('[data-refund]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmModal('Estornar pagamento?', 'Pagamentos do Mercado Pago são devolvidos ao cliente pela própria plataforma. Pagamentos de balcão só são marcados como estornados.', 'Estornar', true))) return;
      try { await api(`/payments/${b.dataset.refund}/refund`, { method: 'POST' }); m.close(); toast('Estorno registrado.'); refresh(); } catch (err) { m.showError(err.message); }
    }));
  }

  function recordPayment(a) {
    const pending = Math.max(0, a.total_price_cents - (a.paid_cents || 0));
    modal({
      title: 'Registrar pagamento',
      body: `<p class="small muted">${esc(a.customer_name)} · previsto ${money(a.total_price_cents)} · recebido ${money(a.paid_cents)}</p>
        <div class="row row-2"><div class="field"><label for="p-am">Valor recebido (R$)</label><input class="input" id="p-am" name="amount" inputmode="decimal" value="${(pending / 100).toFixed(2).replace('.', ',')}"></div>
        <div class="field"><label for="p-me">Forma</label><select class="input" id="p-me" name="method"><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="cartao_debito">Cartão de débito</option><option value="cartao_credito">Cartão de crédito</option><option value="outro">Outro</option></select></div></div>`,
      actions: [{ label: 'Voltar' }, { label: 'Registrar', cls: 'btn-primary', run: async (m) => { await api(`/appointments/${a.id}/payments`, { method: 'POST', body: formData(m) }); toast('Pagamento registrado.'); refresh(); } }],
    });
  }

  // Seletor de horário compartilhado por "novo" e "remarcar"
  function slotPicker(m, { getServices, getPro, getDate, exclude }) {
    const box = m.querySelector('.slot-box');
    const timeInput = m.querySelector('[name=time]');
    async function load() {
      timeInput.value = '';
      const services = getServices(); const date = getDate(); const pro = getPro();
      if (!services.length || !date || !pro) { box.innerHTML = '<p class="small muted">Escolha serviço, profissional e data.</p>'; return; }
      box.innerHTML = '<p class="small muted">Buscando horários livres...</p>';
      try {
        const r = await api(`/availability?services=${services.join(',')}&professional=${pro}&date=${date}${exclude ? `&exclude=${exclude}` : ''}`);
        box.innerHTML = r.slots.length ? `<p class="small muted">Duração: ${dur(r.duration)}</p><div class="slots">${r.slots.map((t) => `<button type="button" class="slot" data-t="${t}" aria-pressed="false">${t}</button>`).join('')}</div>` : '<p class="small">Sem horários livres no expediente deste dia.</p>';
        box.querySelectorAll('.slot').forEach((b) => b.addEventListener('click', () => {
          box.querySelectorAll('.slot').forEach((x) => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true'); timeInput.value = b.dataset.t;
        }));
      } catch (err) { box.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
    }
    return load;
  }

  function newAppointment({ date, customer } = {}) {
    const myPro = S.me.user.role === 'profissional' ? S.me.user.professional_id : null;
    const pros = S.pros.filter((p) => p.active && (!myPro || p.id === myPro));
    const services = S.services.filter((s) => s.active);
    const m = modal({
      title: 'Novo agendamento', wide: true,
      body: `<div class="grid grid-2"><div>
        <div class="field"><span class="label">Serviços</span><div class="checks">${services.map((s) => `<label class="check"><input type="checkbox" data-multi="1" name="services" value="${s.id}"><span>${esc(s.name)} <span class="muted small">${dur(s.duration_min)} · ${money(s.price_cents)}</span></span></label>`).join('')}</div></div>
        <div class="field"><label for="n-pro">Profissional</label><select class="input" id="n-pro" name="professional">${myPro ? '' : '<option value="any">Primeiro disponível</option>'}${pros.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="n-date">Data</label><input class="input" id="n-date" name="date" type="date" value="${date || S.me.today}"></div>
        <div class="slot-box"></div>
        <div class="field" style="margin-top:10px"><label for="n-time">Horário escolhido</label><input class="input" id="n-time" name="time" placeholder="Escolha acima${isAdmin() ? ' ou digite (encaixe)' : ''}" ${isAdmin() ? '' : 'readonly'} pattern="[0-2][0-9]:[0-5][0-9]"></div>
        ${isAdmin() ? '<label class="check"><input type="checkbox" name="ignoreHours"><span>Encaixe fora do expediente (ainda impede conflito com outro cliente)</span></label>' : ''}
      </div><div>
        <div class="field"><label for="n-search">Cliente cadastrado</label><input class="input" id="n-search" placeholder="Buscar por nome ou telefone" autocomplete="off"><div class="cust-results small"></div><input type="hidden" name="customerId" value="${customer ? customer.id : ''}"></div>
        <div class="cust-new">
          <div class="field"><label for="n-name">Nome</label><input class="input" id="n-name" name="name" value="${customer ? esc(customer.name) : ''}" autocomplete="off"></div>
          <div class="field"><label for="n-phone">Celular</label><input class="input" id="n-phone" name="phone" inputmode="tel" value="${customer ? esc(phone(customer.phone)) : ''}" autocomplete="off"></div>
          <div class="field"><label for="n-email">E-mail (opcional)</label><input class="input" id="n-email" name="email" type="email" autocomplete="off"></div>
        </div>
        <div class="field"><label for="n-src">Recebido por</label><select class="input" id="n-src" name="source"><option value="telefone">Telefone</option><option value="presencial">Presencial</option><option value="whatsapp">WhatsApp</option><option value="painel">Outro</option></select></div>
        <div class="field"><label for="n-notes">Observação</label><textarea class="input" id="n-notes" name="notes" maxlength="500"></textarea></div>
      </div></div>`,
      actions: [{ label: 'Voltar' }, {
        label: 'Criar agendamento', cls: 'btn-primary', run: async (mm) => {
          const d = formData(mm);
          if (!d.time) throw new Error('Escolha um horário.');
          const body = { services: d.services.map(Number), professional: d.professional, date: d.date, time: d.time, source: d.source, notes: d.notes, ignoreHours: !!d.ignoreHours };
          if (d.customerId) body.customerId = Number(d.customerId); else Object.assign(body, { name: d.name, phone: d.phone, email: d.email });
          const r = await api('/appointments', { method: 'POST', body });
          toast(`Agendamento ${r.appointment.code} criado.`);
          refresh();
        },
      }],
    });
    const load = slotPicker(m, { getServices: () => formData(m).services || [], getPro: () => m.querySelector('[name=professional]').value, getDate: () => m.querySelector('[name=date]').value });
    m.querySelectorAll('[name=services], [name=professional], [name=date]').forEach((el) => el.addEventListener('change', load));
    load();
    const search = m.querySelector('#n-search'); const results = m.querySelector('.cust-results'); const cid = m.querySelector('[name=customerId]'); const newBox = m.querySelector('.cust-new');
    if (customer) { newBox.style.opacity = '.5'; newBox.querySelectorAll('input').forEach((i) => { i.disabled = true; }); search.value = customer.name; }
    let t;
    search.addEventListener('input', () => {
      clearTimeout(t);
      cid.value = ''; newBox.style.opacity = ''; newBox.querySelectorAll('input').forEach((i) => { i.disabled = false; });
      const q = search.value.trim();
      if (q.length < 2) { results.innerHTML = ''; return; }
      t = setTimeout(async () => {
        const r = await api(`/customers?q=${encodeURIComponent(q)}`);
        results.innerHTML = r.customers.slice(0, 6).map((c) => `<button type="button" class="btn btn-sm" style="margin:4px 4px 0 0" data-c="${c.id}" data-n="${esc(c.name)}">${esc(c.name)} · ${esc(phone(c.phone))}</button>`).join('') || '<span class="muted">Nenhum cliente encontrado. Preencha abaixo para cadastrar.</span>';
        results.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
          cid.value = b.dataset.c; search.value = b.dataset.n; results.innerHTML = '<span style="color:var(--ok)">Cliente selecionado.</span>';
          newBox.style.opacity = '.5'; newBox.querySelectorAll('input').forEach((i) => { i.disabled = true; });
        }));
      }, 250);
    });
  }

  function reschedule(a) {
    const myPro = S.me.user.role === 'profissional';
    const m = modal({
      title: `Remarcar ${a.code}`,
      body: `<p class="small muted">Atual: ${esc(dateLong(a.date))}, ${a.time}, com ${esc(a.professional_name)}.</p>
        ${myPro ? `<input type="hidden" name="professional" value="${a.professional_id}">` : `<div class="field"><label for="r-pro">Profissional</label><select class="input" id="r-pro" name="professional">${S.pros.filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.id === a.professional_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`}
        <div class="field"><label for="r-date">Nova data</label><input class="input" id="r-date" name="date" type="date" value="${a.date}"></div>
        <div class="slot-box"></div>
        <div class="field" style="margin-top:10px"><label for="r-time">Novo horário</label><input class="input" id="r-time" name="time" ${isAdmin() ? '' : 'readonly'}></div>
        ${isAdmin() ? '<label class="check"><input type="checkbox" name="ignoreHours"><span>Encaixe fora do expediente</span></label>' : ''}`,
      actions: [{ label: 'Voltar' }, { label: 'Remarcar', cls: 'btn-primary', run: async (mm) => {
        const d = formData(mm);
        if (!d.time) throw new Error('Escolha um horário.');
        await api(`/appointments/${a.id}/reschedule`, { method: 'POST', body: { date: d.date, time: d.time, professional: d.professional, ignoreHours: !!d.ignoreHours } });
        toast('Agendamento remarcado.'); refresh();
      } }],
    });
    const services = a.services.map((s) => s.service_id).filter(Boolean);
    const load = slotPicker(m, { getServices: () => services, getPro: () => m.querySelector('[name=professional]').value, getDate: () => m.querySelector('[name=date]').value, exclude: a.id });
    m.querySelectorAll('[name=professional], [name=date]').forEach((el) => el.addEventListener('change', load));
    load();
  }

  // ---------- AGENDA (dia, semana, mês) ----------
  const agendaState = { mode: 'dia', date: null, pro: '' };
  async function viewAgenda(view) {
    if (!agendaState.date) agendaState.date = S.me.today;
    if (window.innerWidth < 700 && !agendaState.touched) agendaState.mode = 'semana';
    const st = agendaState;
    let from = st.date; let to = st.date;
    if (st.mode === 'semana') { from = addDays(st.date, -weekday(st.date)); to = addDays(from, 6); }
    if (st.mode === 'mes') { from = `${st.date.slice(0, 7)}-01`; const [y, mo] = st.date.split('-').map(Number); to = `${st.date.slice(0, 7)}-${new Date(Date.UTC(y, mo, 0)).getUTCDate()}`; }
    const gridFrom = st.mode === 'mes' ? addDays(from, -weekday(from)) : from;
    const gridTo = st.mode === 'mes' ? addDays(to, 6 - weekday(to)) : to;
    const [list, offs] = await Promise.all([
      api(`/appointments?from=${gridFrom}&to=${gridTo}${st.pro ? `&professional=${st.pro}` : ''}`),
      api(`/time-off?from=${gridFrom}&to=${gridTo}`),
    ]);
    const appts = list.appointments;
    const step = st.mode === 'dia' ? 1 : st.mode === 'semana' ? 7 : 30;
    const title = st.mode === 'dia' ? dateLong(st.date) : st.mode === 'semana' ? `Semana de ${dateBR(from)} a ${dateBR(to)}` : `${MONTHS[Number(st.date.slice(5, 7)) - 1].replace(/^./, (c) => c.toUpperCase())} de ${st.date.slice(0, 4)}`;
    view.innerHTML = `
      <div class="view-head"><h1>Agenda</h1><div class="toolbar">
        <div class="seg" role="group" aria-label="Visualização">${[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']].map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${st.mode === k}">${l}</button>`).join('')}</div>
        ${isAdmin() ? `<select class="input" id="ag-pro" style="width:auto" aria-label="Profissional"><option value="">Todos</option>${S.pros.map((p) => `<option value="${p.id}" ${String(p.id) === String(st.pro) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
        <button class="btn btn-primary" id="new">Novo agendamento</button></div></div>
      <div class="toolbar" style="margin-bottom:14px"><button class="btn btn-sm" data-nav="-1" aria-label="Anterior">‹</button><button class="btn btn-sm" data-nav="0">Hoje</button><button class="btn btn-sm" data-nav="1" aria-label="Próximo">›</button><strong style="margin-left:6px">${esc(title)}</strong></div>
      <div id="cal"></div>`;
    view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.mode; st.touched = true; refresh(); }));
    view.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
      const n = Number(b.dataset.nav);
      if (!n) st.date = S.me.today;
      else if (st.mode === 'mes') { const [y, mo] = st.date.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); st.date = d.toISOString().slice(0, 10); } else st.date = addDays(st.date, n * step);
      refresh();
    }));
    const ps = view.querySelector('#ag-pro'); if (ps) ps.addEventListener('change', () => { st.pro = ps.value; refresh(); });
    view.querySelector('#new').addEventListener('click', () => newAppointment({ date: st.date }));
    const cal = view.querySelector('#cal');
    if (st.mode === 'dia') renderDay(cal, appts, offs.timeOff);
    else if (st.mode === 'semana') renderWeek(cal, appts, from);
    else renderMonth(cal, appts, gridFrom, gridTo, from, to);
    cal.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openAppointment(Number(b.dataset.open))));
    cal.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => { st.date = b.dataset.day; st.mode = 'dia'; st.touched = true; refresh(); }));
  }

  function renderDay(cal, appts, offs) {
    const st = agendaState;
    const pros = S.pros.filter((p) => (p.active || appts.some((a) => a.professional_id === p.id)) && (!st.pro || String(p.id) === String(st.pro)));
    const startH = 7; const endH = 22; const pxMin = 1.4;
    const top = (min) => 40 + (min - startH * 60) * pxMin;
    const height = 40 + (endH - startH) * 60 * pxMin;
    const hours = []; for (let h = startH; h <= endH; h++) hours.push(`<div class="hour" style="top:${top(h * 60)}px">${String(h).padStart(2, '0')}h</div>`);
    const now = new Date(); const nowLocal = new Intl.DateTimeFormat('en-GB', { timeZone: window.__TZ__, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const nowLine = st.date === S.me.today ? `<div class="now" style="top:${top(toMin(nowLocal))}px" aria-hidden="true"></div>` : '';
    const dayStart = st.date;
    cal.innerHTML = `<div class="daygrid" style="grid-template-columns:52px repeat(${pros.length}, minmax(150px, 1fr));height:${height + 10}px">
      <div class="col hours-col"><div class="col-head"></div>${hours.join('')}</div>
      ${pros.map((p) => {
        const hrs = p.hours.find((h) => h.weekday === weekday(dayStart));
        const blocks = [];
        if (!hrs) blocks.push(`<div class="block" style="top:40px;height:${height - 40}px">Sem expediente</div>`);
        else {
          blocks.push(`<div class="block" style="top:40px;height:${Math.max(0, top(hrs.start_min) - 40)}px"></div>`);
          blocks.push(`<div class="block" style="top:${top(hrs.end_min)}px;height:${Math.max(0, height - top(hrs.end_min))}px"></div>`);
          if (hrs.break_start_min != null) blocks.push(`<div class="block" style="top:${top(hrs.break_start_min)}px;height:${(hrs.break_end_min - hrs.break_start_min) * pxMin}px">Intervalo</div>`);
        }
        for (const o of offs.filter((x) => !x.professional_id || x.professional_id === p.id)) {
          const s = o.start_date < dayStart ? 0 : o.start_date > dayStart ? null : toMin(o.start_time);
          const e = o.end_date > dayStart ? 24 * 60 : o.end_date < dayStart ? null : toMin(o.end_time);
          if (s == null || e == null || e <= s) continue;
          const ss = Math.max(s, startH * 60); const ee = Math.min(e, endH * 60);
          if (ee > ss) blocks.push(`<div class="block" style="top:${top(ss)}px;height:${(ee - ss) * pxMin}px">${esc(o.kind)}${o.reason ? `: ${esc(o.reason)}` : ''}</div>`);
        }
        const evs = appts.filter((a) => a.professional_id === p.id && a.date === dayStart).map((a) => {
          const s = toMin(a.time); const e = toMin(a.end_time);
          return `<button type="button" class="ev st-${a.status}" data-open="${a.id}" style="top:${top(s)}px;height:${Math.max(22, (e - s) * pxMin - 2)}px" aria-label="${esc(a.time)} ${esc(a.customer_name)}, ${STATUS[a.status]}"><strong>${a.time}</strong> ${esc(a.customer_name)}<br><span class="muted">${esc(a.services)}</span></button>`;
        });
        return `<div class="col"><div class="col-head">${esc(p.name)}</div>${blocks.join('')}${evs.join('')}${nowLine}</div>`;
      }).join('')}
    </div>`;
  }

  function renderWeek(cal, appts, from) {
    const days = []; for (let i = 0; i < 7; i++) days.push(addDays(from, i));
    cal.innerHTML = `<div class="week">${days.map((d) => {
      const list = appts.filter((a) => a.date === d);
      return `<section class="day ${d === S.me.today ? 'today' : ''}"><h3><button type="button" class="btn btn-sm" data-day="${d}" style="border:0;padding:0;min-height:0;background:none">${WD[weekday(d)].slice(0, 3)} ${dateBR(d).slice(0, 5)}</button><span class="muted">${list.filter((a) => a.status !== 'cancelado').length}</span></h3>
        ${list.map((a) => `<button type="button" class="chip st-${a.status}" data-open="${a.id}"><strong>${a.time}</strong> ${esc(a.customer_name)}<br><span class="muted">${esc(a.professional_name)}</span></button>`).join('') || '<span class="small muted">Livre</span>'}</section>`;
    }).join('')}</div>`;
  }

  function renderMonth(cal, appts, gridFrom, gridTo, from, to) {
    const cells = [];
    for (let d = gridFrom; d <= gridTo; d = addDays(d, 1)) {
      const list = appts.filter((a) => a.date === d && a.status !== 'cancelado');
      const value = list.reduce((s, a) => s + a.total_price_cents, 0);
      cells.push(`<button type="button" class="cell ${d < from || d > to ? 'out' : ''} ${d === S.me.today ? 'today' : ''}" data-day="${d}" aria-label="${dateLong(d)}: ${list.length} agendamentos"><span class="d">${Number(d.slice(8))}</span>${list.length ? `<span class="c">${list.length} atend.</span><span class="c">${money(value)}</span>` : ''}</button>`);
    }
    cal.innerHTML = `<div class="month">${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((w) => `<div class="wd">${w}</div>`).join('')}${cells.join('')}</div>`;
  }

  // ---------- CLIENTES ----------
  async function viewCustomers(view, [id]) {
    if (id) return viewCustomer(view, id);
    view.innerHTML = `<div class="view-head"><h1>Clientes</h1><div class="toolbar">${isAdmin() ? '<a class="btn" href="/api/admin/export/clientes.csv">Exportar CSV</a>' : ''}</div></div>
      <div class="field" style="max-width:420px"><label for="c-q" class="sr-only">Buscar</label><input class="input" id="c-q" placeholder="Buscar por nome, telefone ou e-mail" autocomplete="off"></div>
      <div id="c-list"></div>`;
    const q = view.querySelector('#c-q'); const listEl = view.querySelector('#c-list');
    async function load() {
      const r = await api(`/customers?q=${encodeURIComponent(q.value.trim())}`);
      listEl.innerHTML = r.customers.length ? `<div class="table-wrap"><table class="list stack"><thead><tr><th>Nome</th><th>Celular</th>${isAdmin() ? '<th>E-mail</th><th>Marketing</th>' : ''}<th class="right">Atendimentos</th><th>Último</th></tr></thead><tbody>
        ${r.customers.map((c) => `<tr class="clickable" data-c="${c.id}" tabindex="0"><td data-l="Nome"><strong>${esc(c.name)}</strong></td><td data-l="Celular">${esc(phone(c.phone))}</td>${isAdmin() ? `<td data-l="E-mail">${esc(c.email || '')}</td><td data-l="Marketing">${c.marketing_consent ? 'Aceita' : 'Não'}</td>` : ''}<td data-l="Atendimentos" class="right num">${c.visits}</td><td data-l="Último">${c.last_visit ? fmtTs(c.last_visit).slice(0, 10) : '-'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nenhum cliente encontrado.</div>';
      listEl.querySelectorAll('[data-c]').forEach((tr) => { const go = () => { location.hash = `#/clientes/${tr.dataset.c}`; }; tr.addEventListener('click', go); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); });
    }
    let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
    q.focus();
    load();
  }

  async function viewCustomer(view, id) {
    const { customer: c, history } = await api(`/customers/${id}`);
    const done = history.filter((a) => a.status === 'concluido');
    view.innerHTML = `<div class="view-head"><h1>${esc(c.name)}</h1><div class="toolbar"><a class="btn" href="#/clientes">Voltar</a><button class="btn btn-primary" id="book">Agendar</button>${isAdmin() && !c.anonymized_at ? '<button class="btn" id="edit">Editar</button><button class="btn btn-danger" id="anon">Excluir dados (LGPD)</button>' : ''}</div></div>
      ${c.is_demo ? '<div class="alert alert-info">Cliente fictício de demonstração.</div>' : ''}
      <div class="grid grid-3" style="margin-bottom:16px">
        <div class="card"><dl class="kv"><dt>Celular</dt><dd><a href="https://wa.me/${esc(c.phone)}" target="_blank" rel="noopener">${esc(phone(c.phone))}</a></dd>${c.email ? `<dt>E-mail</dt><dd>${esc(c.email)}</dd>` : ''}${'marketing_consent' in c ? `<dt>Marketing</dt><dd>${c.marketing_consent ? `Aceito em ${fmtTs(c.marketing_consent_at)}` : 'Não aceita'}</dd>` : ''}</dl></div>
        <div class="kpi"><div class="label">Atendimentos concluídos</div><div class="value">${done.length}</div><div class="hint">${history.filter((a) => a.status === 'nao_compareceu').length} faltas, ${history.filter((a) => a.status === 'cancelado').length} cancelamentos</div></div>
        <div class="kpi"><div class="label">Total em serviços concluídos</div><div class="value">${money(done.reduce((s, a) => s + a.total_price_cents, 0))}</div></div>
      </div>
      ${c.notes ? `<div class="card" style="margin-bottom:16px"><h3>Observações</h3><p style="margin:0">${esc(c.notes)}</p></div>` : ''}
      <h2>Histórico</h2>
      <div class="table-wrap"><table class="list stack"><thead><tr><th>Data</th><th>Serviços</th><th>Profissional</th><th>Status</th><th class="right">Valor</th></tr></thead><tbody>
      ${history.map((a) => `<tr class="clickable" data-open="${a.id}"><td data-l="Data">${dateBR(a.date)} ${a.time}</td><td data-l="Serviços">${esc(a.services)}</td><td data-l="Profissional">${esc(a.professional_name)}</td><td data-l="Status">${badge(a.status)}</td><td data-l="Valor" class="right num">${money(a.total_price_cents)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sem agendamentos.</td></tr>'}</tbody></table></div>`;
    view.querySelectorAll('[data-open]').forEach((tr) => tr.addEventListener('click', () => openAppointment(Number(tr.dataset.open))));
    view.querySelector('#book').addEventListener('click', () => newAppointment({ customer: c }));
    const ed = view.querySelector('#edit');
    if (ed) ed.addEventListener('click', () => modal({
      title: 'Editar cliente',
      body: `<div class="field"><label for="ce-n">Nome</label><input class="input" id="ce-n" name="name" value="${esc(c.name)}"></div>
        <div class="field"><label for="ce-p">Celular</label><input class="input" id="ce-p" name="phone" value="${esc(phone(c.phone))}"></div>
        <div class="field"><label for="ce-e">E-mail</label><input class="input" id="ce-e" name="email" type="email" value="${esc(c.email || '')}"></div>
        <div class="field"><label for="ce-o">Observações internas</label><textarea class="input" id="ce-o" name="notes">${esc(c.notes || '')}</textarea><span class="hint">Não registre dados sensíveis (saúde, religião etc.).</span></div>`,
      actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'btn-primary', run: async (m) => { await api(`/customers/${c.id}`, { method: 'PUT', body: formData(m) }); toast('Cliente atualizado.'); refresh(); } }],
    }));
    const an = view.querySelector('#anon');
    if (an) an.addEventListener('click', async () => {
      if (!(await confirmModal('Excluir dados pessoais?', 'Nome, telefone, e-mail e observações serão apagados, horários futuros cancelados e o histórico financeiro fica anônimo. Não dá para desfazer.', 'Excluir dados', true))) return;
      try { await api(`/customers/${c.id}/anonymize`, { method: 'POST' }); toast('Dados excluídos.'); location.hash = '#/clientes'; } catch (err) { fail(err); }
    });
  }

  // ---------- FOLGAS, BLOQUEIOS E FERIADOS ----------
  async function viewTimeOff(view) {
    const [t, h] = await Promise.all([api('/time-off'), isAdmin() ? api('/holidays') : Promise.resolve({ holidays: [] })]);
    const KIND = { bloqueio: 'Bloqueio', folga: 'Folga', ferias: 'Férias', intervalo: 'Intervalo extra' };
    view.innerHTML = `<div class="view-head"><h1>Folgas e bloqueios</h1><div class="toolbar"><button class="btn btn-primary" id="add">Novo bloqueio</button></div></div>
      <p class="muted">Horários bloqueados somem do agendamento online. Intervalos fixos de almoço ficam em Equipe e horários.</p>
      <div class="table-wrap" style="margin-bottom:24px"><table class="list stack"><thead><tr><th>Quem</th><th>Tipo</th><th>De</th><th>Até</th><th>Motivo</th><th></th></tr></thead><tbody>
      ${t.timeOff.map((o) => `<tr><td data-l="Quem">${esc(o.professional_name || 'Barbearia toda')}</td><td data-l="Tipo">${KIND[o.kind]}</td><td data-l="De">${dateBR(o.start_date)} ${o.start_time}</td><td data-l="Até">${dateBR(o.end_date)} ${o.end_time}</td><td data-l="Motivo">${esc(o.reason)}</td><td><button class="btn btn-sm" data-del="${o.id}">Remover</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum bloqueio nos próximos 90 dias.</td></tr>'}
      </tbody></table></div>
      ${isAdmin() ? `<div class="view-head"><h2>Feriados (barbearia fechada)</h2><button class="btn" id="add-h">Adicionar feriado</button></div>
      <p class="small muted">Feriados nacionais já vêm cadastrados. Inclua os feriados estaduais e municipais da sua cidade.</p>
      <div class="table-wrap"><table class="list"><tbody>${h.holidays.map((x) => `<tr><td class="num">${dateBR(x.date)}</td><td>${esc(x.name)}</td><td class="right"><button class="btn btn-sm" data-delh="${x.date}">Remover</button></td></tr>`).join('') || '<tr><td class="empty">Nenhum feriado futuro.</td></tr>'}</tbody></table></div>` : ''}`;
    view.querySelector('#add').addEventListener('click', () => {
      const myPro = S.me.user.role === 'profissional';
      const m = modal({
        title: 'Novo bloqueio',
        body: `${myPro ? '' : `<div class="field"><label for="b-p">Quem</label><select class="input" id="b-p" name="professional_id"><option value="">Barbearia toda</option>${S.pros.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>`}
          <div class="field"><label for="b-k">Tipo</label><select class="input" id="b-k" name="kind"><option value="bloqueio">Bloqueio</option><option value="folga">Folga</option><option value="ferias">Férias</option><option value="intervalo">Intervalo extra</option></select></div>
          <label class="check"><input type="checkbox" name="all_day" checked><span>Dia inteiro</span></label>
          <div class="row row-2" style="margin-top:10px"><div class="field"><label for="b-sd">Data inicial</label><input class="input" id="b-sd" type="date" name="start_date" value="${S.me.today}"></div><div class="field"><label for="b-ed">Data final</label><input class="input" id="b-ed" type="date" name="end_date" value="${S.me.today}"></div></div>
          <div class="row row-2 times" hidden><div class="field"><label for="b-st">Hora inicial</label><input class="input" id="b-st" type="time" name="start_time" value="12:00"></div><div class="field"><label for="b-et">Hora final</label><input class="input" id="b-et" type="time" name="end_time" value="13:00"></div></div>
          <div class="field"><label for="b-r">Motivo (opcional)</label><input class="input" id="b-r" name="reason" maxlength="120"></div>`,
        actions: [{ label: 'Voltar' }, { label: 'Bloquear', cls: 'btn-primary', run: async (mm) => {
          const r = await api('/time-off', { method: 'POST', body: formData(mm) });
          if (r.conflicts.length) toast(`Bloqueio criado. Atenção: ${r.conflicts.length} agendamento(s) já marcados nesse período (${r.conflicts.join(', ')}). Remarque ou cancele.`);
          else toast('Bloqueio criado.');
          refresh();
        } }],
      });
      const ad = m.querySelector('[name=all_day]'); const times = m.querySelector('.times');
      ad.addEventListener('change', () => { times.hidden = ad.checked; });
    });
    view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmModal('Remover bloqueio?', 'Os horários voltam a aparecer para agendamento.', 'Remover'))) return;
      try { await api(`/time-off/${b.dataset.del}`, { method: 'DELETE' }); refresh(); } catch (err) { fail(err); }
    }));
    const ah = view.querySelector('#add-h');
    if (ah) ah.addEventListener('click', () => modal({
      title: 'Adicionar feriado',
      body: '<div class="field"><label for="h-d">Data</label><input class="input" id="h-d" type="date" name="date"></div><div class="field"><label for="h-n">Nome</label><input class="input" id="h-n" name="name" maxlength="80"></div>',
      actions: [{ label: 'Voltar' }, { label: 'Adicionar', cls: 'btn-primary', run: async (m) => { const r = await api('/holidays', { method: 'POST', body: formData(m) }); toast(r.conflicts.length ? `Feriado salvo. ${r.conflicts.length} agendamento(s) nesse dia precisam ser remarcados.` : 'Feriado salvo.'); refresh(); } }],
    }));
    view.querySelectorAll('[data-delh]').forEach((b) => b.addEventListener('click', async () => { try { await api(`/holidays/${b.dataset.delh}`, { method: 'DELETE' }); refresh(); } catch (err) { fail(err); } }));
  }

  // ---------- SERVIÇOS ----------
  async function viewServices(view) {
    await loadRefs();
    view.innerHTML = `<div class="view-head"><h1>Serviços</h1><div class="toolbar"><button class="btn btn-primary" id="add">Novo serviço</button></div></div>
      ${S.services.some((s) => s.is_demo) ? '<div class="alert alert-info">Itens marcados como demonstração são fictícios. Edite com os dados reais ou rode "npm run demo:remove".</div>' : ''}
      <div class="table-wrap"><table class="list stack"><thead><tr><th>Serviço</th><th class="right">Preço</th><th class="right">Duração</th><th>Destaque</th><th>Situação</th></tr></thead><tbody>
      ${S.services.map((s) => `<tr class="clickable" data-s="${s.id}" tabindex="0"><td data-l="Serviço"><strong>${esc(s.name)}</strong>${s.is_demo ? ' <span class="badge n-pendente">demonstração</span>' : ''}<br><span class="small muted">${esc(s.description)}</span></td><td data-l="Preço" class="right num">${money(s.price_cents)}</td><td data-l="Duração" class="right">${dur(s.duration_min)}</td><td data-l="Destaque">${s.featured ? 'Página inicial' : '-'}</td><td data-l="Situação">${s.active ? 'Ativo' : '<span class="muted">Desativado</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Cadastre o primeiro serviço.</td></tr>'}
      </tbody></table></div>`;
    view.querySelector('#add').addEventListener('click', () => editService());
    view.querySelectorAll('[data-s]').forEach((tr) => { const go = () => editService(S.services.find((s) => s.id === Number(tr.dataset.s))); tr.addEventListener('click', go); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); }); });
  }
  function editService(s) {
    const v = s || { name: '', description: '', price_cents: 0, duration_min: 30, active: 1, featured: 0, sort: S.services.length };
    modal({
      title: s ? 'Editar serviço' : 'Novo serviço',
      body: `<div class="field"><label for="s-n">Nome</label><input class="input" id="s-n" name="name" value="${esc(v.name)}" maxlength="80"></div>
        <div class="field"><label for="s-d">Descrição curta</label><textarea class="input" id="s-d" name="description" maxlength="400">${esc(v.description)}</textarea></div>
        <div class="row row-3"><div class="field"><label for="s-p">Preço (R$)</label><input class="input" id="s-p" name="price" inputmode="decimal" value="${(v.price_cents / 100).toFixed(2).replace('.', ',')}"></div>
        <div class="field"><label for="s-m">Duração (min)</label><input class="input" id="s-m" name="duration_min" type="number" min="5" max="600" step="5" value="${v.duration_min}"></div>
        <div class="field"><label for="s-o">Ordem</label><input class="input" id="s-o" name="sort" type="number" min="0" value="${v.sort}"></div></div>
        <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}><span>Ativo (aparece no site e no agendamento)</span></label>
        <label class="check"><input type="checkbox" name="featured" ${v.featured ? 'checked' : ''}><span>Mostrar entre os mais procurados na página inicial</span></label>
        ${s ? '' : '<p class="small muted">Depois de criar, marque quais profissionais fazem este serviço em Equipe e horários.</p>'}`,
      actions: [{ label: 'Voltar' }, { label: s ? 'Salvar' : 'Criar serviço', cls: 'btn-primary', run: async (m) => {
        await api(s ? `/services/${s.id}` : '/services', { method: s ? 'PUT' : 'POST', body: formData(m) });
        toast('Serviço salvo.'); refresh();
      } }],
    });
  }

  // ---------- EQUIPE ----------
  async function viewPros(view) {
    await loadRefs();
    view.innerHTML = `<div class="view-head"><h1>Equipe e horários</h1><div class="toolbar"><button class="btn btn-primary" id="add">Novo profissional</button></div></div>
      <div class="grid grid-3">${S.pros.map((p) => `<div class="card setting-card"><h2 style="margin:0">${esc(p.name)} ${p.is_demo ? '<span class="badge n-pendente">demonstração</span>' : ''}</h2>
        <div class="state">${p.active ? (p.online_booking ? 'Ativo, aceita agendamento online' : 'Ativo, só agendamento pelo painel') : 'Desativado'}<br>${p.services.length} serviço(s)<br>${p.hours.map((h) => `${WD[h.weekday].slice(0, 3)} ${hhmm(h.start_min)}-${hhmm(h.end_min)}`).join(', ') || 'Sem expediente cadastrado'}</div>
        <button class="btn btn-sm" data-p="${p.id}">Editar</button></div>`).join('') || '<div class="empty">Cadastre o primeiro profissional.</div>'}</div>`;
    view.querySelector('#add').addEventListener('click', () => editPro());
    view.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => editPro(S.pros.find((p) => p.id === Number(b.dataset.p)))));
  }
  function editPro(p) {
    const v = p || { name: '', role_title: 'Barbeiro', bio: '', specialties: '', photo: '', active: 1, online_booking: 1, sort: S.pros.length, services: [], hours: [] };
    const hourRow = (d) => {
      const h = v.hours.find((x) => x.weekday === d);
      return `<div class="h-row" data-wd="${d}"><label class="check"><input type="checkbox" class="h-on" ${h ? 'checked' : ''}><span>${WD[d].slice(0, 3)}</span></label>
        <div class="h-times"><input class="input h-start" type="time" value="${h ? hhmm(h.start_min) : '09:00'}" aria-label="${WD[d]} início"> às <input class="input h-end" type="time" value="${h ? hhmm(h.end_min) : '19:00'}" aria-label="${WD[d]} fim">
        <span class="small muted">intervalo</span><input class="input h-bs" type="time" value="${h ? hhmm(h.break_start_min) : ''}" aria-label="${WD[d]} início do intervalo"> às <input class="input h-be" type="time" value="${h ? hhmm(h.break_end_min) : ''}" aria-label="${WD[d]} fim do intervalo"></div></div>`;
    };
    modal({
      title: p ? `Editar ${p.name}` : 'Novo profissional', wide: true,
      body: `<div class="row row-2"><div class="field"><label for="p-n">Nome</label><input class="input" id="p-n" name="name" value="${esc(v.name)}"></div><div class="field"><label for="p-r">Cargo</label><input class="input" id="p-r" name="role_title" value="${esc(v.role_title)}"></div></div>
        <div class="field"><label for="p-b">Apresentação</label><textarea class="input" id="p-b" name="bio" maxlength="600">${esc(v.bio)}</textarea></div>
        <div class="row row-2"><div class="field"><label for="p-s">Especialidades</label><input class="input" id="p-s" name="specialties" value="${esc(v.specialties)}"><span class="hint">Separadas por vírgula.</span></div>
        <div class="field"><label for="p-f">Foto</label><input class="input" id="p-f" name="photo" value="${esc(v.photo)}" placeholder="/img/equipe/nome.webp"><span class="hint">Caminho do arquivo em public/img (vertical 900×1200).</span></div></div>
        <div class="row row-3"><label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}><span>Ativo</span></label><label class="check"><input type="checkbox" name="online_booking" ${v.online_booking ? 'checked' : ''}><span>Aceita agendamento online</span></label><div class="field"><label for="p-o">Ordem</label><input class="input" id="p-o" type="number" name="sort" value="${v.sort}"></div></div>
        <div class="field"><span class="label">Serviços que realiza</span><div class="checks">${S.services.map((s) => `<label class="check"><input type="checkbox" data-multi="1" name="services" value="${s.id}" ${v.services.includes(s.id) ? 'checked' : ''}><span>${esc(s.name)}${s.active ? '' : ' (desativado)'}</span></label>`).join('')}</div></div>
        <div class="field"><span class="label">Expediente semanal</span><span class="hint">O horário real é o cruzamento com o funcionamento da barbearia. Intervalo é opcional.</span><div class="hours-edit">${[1, 2, 3, 4, 5, 6, 0].map(hourRow).join('')}</div></div>`,
      actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'btn-primary', run: async (m) => {
        const d = formData(m);
        d.services = (d.services || []).map(Number);
        d.hours = [...m.querySelectorAll('.h-row')].filter((r) => r.querySelector('.h-on').checked).map((r) => ({
          weekday: Number(r.dataset.wd), start: r.querySelector('.h-start').value, end: r.querySelector('.h-end').value,
          break_start: r.querySelector('.h-bs').value, break_end: r.querySelector('.h-be').value,
        }));
        await api(p ? `/professionals/${p.id}` : '/professionals', { method: p ? 'PUT' : 'POST', body: d });
        toast('Profissional salvo.'); await loadRefs(); refresh();
      } }],
    });
  }

  // ---------- RELATÓRIOS ----------
  const repState = {};
  async function viewReports(view) {
    const to = repState.to || S.me.today; const from = repState.from || addDays(to, -29);
    const r = await api(`/reports?from=${from}&to=${to}`);
    const max = Math.max(1, ...r.services.map((s) => s.count));
    const q = `from=${from}&to=${to}`;
    view.innerHTML = `<div class="view-head"><h1>Relatórios</h1></div>
      <form class="toolbar card" id="period" style="margin-bottom:16px"><div class="field" style="margin:0"><label for="r-f">De</label><input class="input" type="date" id="r-f" name="from" value="${from}"></div><div class="field" style="margin:0"><label for="r-t">Até</label><input class="input" type="date" id="r-t" name="to" value="${to}"></div>
        <button class="btn btn-primary" type="submit" style="align-self:end">Atualizar</button>
        <div class="toolbar" style="align-self:end;margin-left:auto"><a class="btn btn-sm" href="/api/admin/export/agendamentos.csv?${q}">CSV agendamentos</a><a class="btn btn-sm" href="/api/admin/export/pagamentos.csv?${q}">CSV pagamentos</a><a class="btn btn-sm" href="/api/admin/export/servicos.csv?${q}">CSV serviços</a></div></form>
      <div class="grid grid-4" style="margin-bottom:16px">
        <div class="kpi"><div class="label">Atendimentos concluídos</div><div class="value">${r.counts.concluido}</div><div class="hint">de ${r.counts.total} agendamentos</div></div>
        <div class="kpi"><div class="label">Cancelamentos</div><div class="value">${r.counts.cancelado}</div><div class="hint">${r.counts.total ? Math.round(r.counts.cancelado / r.counts.total * 100) : 0}% do total</div></div>
        <div class="kpi"><div class="label">Não compareceram</div><div class="value">${r.counts.nao_compareceu}</div></div>
        <div class="kpi"><div class="label">Ainda por acontecer</div><div class="value">${r.counts.confirmado + r.counts.pendente}</div><div class="hint">confirmados e pendentes</div></div>
      </div>
      <div class="grid grid-4" style="margin-bottom:22px">
        <div class="kpi expected"><div class="label">Valor previsto</div><div class="value">${money(r.values.expected_cents)}</div><div class="hint">Todos os agendamentos não cancelados e sem falta</div></div>
        <div class="kpi"><div class="label">Valor dos serviços concluídos</div><div class="value">${money(r.values.done_cents)}</div><div class="hint">Preço dos atendimentos feitos</div></div>
        <div class="kpi received"><div class="label">Valor recebido</div><div class="value">${money(r.values.received_cents)}</div><div class="hint">Pagamentos aprovados, menos estornos</div></div>
        <div class="kpi pending"><div class="label">Pagamentos pendentes</div><div class="value">${money(r.values.pending_on_done_cents)}</div><div class="hint">Concluídos ainda não pagos</div></div>
      </div>
      <div class="grid grid-2">
        <div class="card"><h2>Serviços mais procurados</h2>${r.services.map((s) => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(s.name)}</span><span class="num">${s.count} · ${money(s.done_cents)}</span></div><div class="bar" aria-hidden="true"><span style="width:${s.count / max * 100}%"></span></div></div>`).join('') || '<p class="muted">Sem dados no período.</p>'}</div>
        <div class="card"><h2>Por profissional</h2><div class="table-wrap" style="border:0"><table class="list"><thead><tr><th>Profissional</th><th class="right">Concluídos</th><th class="right">Faltas</th><th class="right">Valor</th></tr></thead><tbody>${r.professionals.map((p) => `<tr><td>${esc(p.name)}</td><td class="right num">${p.done}</td><td class="right num">${p.no_show}</td><td class="right num">${money(p.done_cents)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sem dados.</td></tr>'}</tbody></table></div>
        <h3 style="margin-top:14px">Origem dos agendamentos</h3><p class="small">${r.sources.map((s) => `${SOURCE[s.source] || s.source}: ${s.count}`).join(' · ') || '-'}</p></div>
      </div>`;
    view.querySelector('#period').addEventListener('submit', (e) => { e.preventDefault(); const d = formData(e.target); repState.from = d.from; repState.to = d.to; refresh(); });
  }

  // ---------- NOTIFICAÇÕES ----------
  async function viewNotifications(view) {
    const r = await api('/notifications');
    const i = r.integrations;
    view.innerHTML = `<div class="view-head"><h1>Notificações</h1><button class="btn" id="run">Processar fila agora</button></div>
      ${integrationAlerts(i)}
      <p class="muted small">Mensagens "não configurado" foram registradas mas não enviadas, porque falta a credencial do provedor. O agendamento funciona normalmente mesmo assim.</p>
      <div class="table-wrap"><table class="list stack"><thead><tr><th>Agendamento</th><th>Canal</th><th>Tipo</th><th>Status</th><th>Programada</th><th>Detalhe</th></tr></thead><tbody>
      ${r.notifications.map((n) => `<tr><td data-l="Agendamento">${esc(n.code || '-')}</td><td data-l="Canal">${n.channel === 'email' ? 'E-mail' : 'WhatsApp'}</td><td data-l="Tipo">${esc(n.kind)}</td><td data-l="Status"><span class="badge n-${n.status}">${esc(n.status.replace('_', ' '))}</span></td><td data-l="Programada">${fmtTs(n.scheduled_for)}</td><td data-l="Detalhe" class="small">${esc(n.last_error || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma notificação ainda.</td></tr>'}</tbody></table></div>`;
    view.querySelector('#run').addEventListener('click', async () => { const x = await api('/notifications/process', { method: 'POST' }); toast(`${x.processed} processada(s).`); refresh(); });
  }
  function integrationAlerts(i) {
    return Object.values(i).filter((x) => !x.ready).map((x) => `<div class="alert"><strong>${esc(x.provider)}</strong> não configurado. Falta: ${x.missing.map((m) => `<code>${esc(m)}</code>`).join(', ')}. Veja o README, seção Integrações.</div>`).join('');
  }

  // ---------- LGPD ----------
  async function viewPrivacy(view) {
    const r = await api('/privacy-requests');
    const T = { acesso: 'Acesso aos dados', correcao: 'Correção', exclusao: 'Exclusão', revogar_marketing: 'Revogar marketing', outro: 'Outro' };
    view.innerHTML = `<div class="view-head"><h1>Pedidos LGPD</h1></div>
      <p class="muted">Responda em até 15 dias. Para exclusão, abra o cliente e use "Excluir dados (LGPD)". Confirme a identidade de quem pediu antes de agir.</p>
      <div class="table-wrap"><table class="list stack"><thead><tr><th>Data</th><th>Nome</th><th>Contato</th><th>Pedido</th><th>Mensagem</th><th>Status</th></tr></thead><tbody>
      ${r.requests.map((x) => `<tr><td data-l="Data">${fmtTs(x.created_at)}</td><td data-l="Nome">${esc(x.name)}${x.customer_id ? ` <a href="#/clientes/${x.customer_id}">(abrir)</a>` : ''}</td><td data-l="Contato">${esc(x.contact)}</td><td data-l="Pedido">${T[x.type] || esc(x.type)}</td><td data-l="Mensagem" class="small">${esc(x.message)}</td><td data-l="Status"><select class="input" data-r="${x.id}" aria-label="Status do pedido"><option value="aberta" ${x.status === 'aberta' ? 'selected' : ''}>Aberta</option><option value="concluida" ${x.status === 'concluida' ? 'selected' : ''}>Concluída</option><option value="recusada" ${x.status === 'recusada' ? 'selected' : ''}>Recusada</option></select></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum pedido.</td></tr>'}</tbody></table></div>`;
    view.querySelectorAll('[data-r]').forEach((s) => s.addEventListener('change', async () => { try { await api(`/privacy-requests/${s.dataset.r}`, { method: 'PUT', body: { status: s.value } }); toast('Pedido atualizado.'); } catch (err) { fail(err); } }));
  }

  // ---------- USUÁRIOS ----------
  async function viewUsers(view) {
    const r = await api('/users');
    view.innerHTML = `<div class="view-head"><h1>Usuários do painel</h1><button class="btn btn-primary" id="add">Novo usuário</button></div>
      <p class="muted">Administrador vê tudo. Profissional vê só a própria agenda e os clientes que atende.</p>
      <div class="table-wrap"><table class="list stack"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Último acesso</th><th>Situação</th><th></th></tr></thead><tbody>
      ${r.users.map((u) => `<tr><td data-l="Nome">${esc(u.name)}</td><td data-l="E-mail">${esc(u.email)}</td><td data-l="Perfil">${u.role === 'admin' ? 'Administrador' : `Profissional (${esc((S.pros.find((p) => p.id === u.professional_id) || {}).name || '?')})`}</td><td data-l="Último acesso">${fmtTs(u.last_login_at) || '-'}</td><td data-l="Situação">${u.active ? 'Ativo' : 'Bloqueado'}</td><td><button class="btn btn-sm" data-u="${u.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
    const form = (u) => `<div class="field"><label for="u-n">Nome</label><input class="input" id="u-n" name="name" value="${esc(u ? u.name : '')}"></div>
      ${u ? '' : '<div class="field"><label for="u-e">E-mail</label><input class="input" id="u-e" name="email" type="email" autocomplete="off"></div>'}
      <div class="row row-2"><div class="field"><label for="u-r">Perfil</label><select class="input" id="u-r" name="role"><option value="profissional" ${u && u.role === 'profissional' ? 'selected' : ''}>Profissional</option><option value="admin" ${u && u.role === 'admin' ? 'selected' : ''}>Administrador</option></select></div>
      <div class="field"><label for="u-p">Agenda de</label><select class="input" id="u-p" name="professional_id"><option value="">-</option>${S.pros.map((p) => `<option value="${p.id}" ${u && u.professional_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
      <div class="field"><label for="u-pw">${u ? 'Nova senha (deixe vazio para manter)' : 'Senha inicial'}</label><input class="input" id="u-pw" name="password" type="password" autocomplete="new-password"><span class="hint">Mínimo de 10 caracteres, com letras e números.</span></div>
      ${u ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}><span>Acesso ativo</span></label>` : ''}`;
    view.querySelector('#add').addEventListener('click', () => modal({ title: 'Novo usuário', body: form(null), actions: [{ label: 'Voltar' }, { label: 'Criar', cls: 'btn-primary', run: async (m) => { await api('/users', { method: 'POST', body: formData(m) }); toast('Usuário criado.'); refresh(); } }] }));
    view.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', () => {
      const u = r.users.find((x) => x.id === Number(b.dataset.u));
      modal({ title: `Editar ${u.name}`, body: form(u), actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'btn-primary', run: async (m) => { await api(`/users/${u.id}`, { method: 'PUT', body: formData(m) }); toast('Usuário atualizado.'); refresh(); } }] });
    }));
  }

  // ---------- CONFIGURAÇÕES ----------
  async function viewSettings(view) {
    const [r, bh] = await Promise.all([api('/settings'), api('/business-hours')]);
    const s = r.settings; const i = r.integrations;
    const b = s.business; const bk = s.booking; const n = s.notifications; const p = s.payments;
    const isPh = (x) => /^\[.*\]$/.test(String(x || '').trim());
    const missingBiz = ['street', 'neighborhood', 'city', 'state', 'whatsapp', 'phone', 'instagram', 'mapEmbedUrl', 'description'].filter((k) => !b[k] || isPh(b[k]));
    const state = (ok, text) => `<span class="badge ${ok ? 'n-enviado' : 'n-nao_configurado'}">${ok ? 'OK' : 'Pendente'}</span> ${text}`;
    view.innerHTML = `<div class="view-head"><h1>Configurações</h1></div>
      <div class="grid grid-2">
        <div class="card setting-card"><h2>Dados da barbearia</h2><div class="state">${state(!missingBiz.length, missingBiz.length ? `Faltam ${missingBiz.length} campo(s): endereço, contatos, mapa ou descrição.` : `${esc(b.name)}, ${esc(b.city)}`)}</div><button class="btn btn-sm" data-open="business">Editar dados</button></div>
        <div class="card setting-card"><h2>Horário de funcionamento</h2><div class="state">${bh.hours.map((h) => `${WD[h.weekday].slice(0, 3)} ${h.closed ? 'fechado' : `${hhmm(h.open_min)}-${hhmm(h.close_min)}`}`).join(', ')}</div><button class="btn btn-sm" data-open="hours">Editar horário</button></div>
        <div class="card setting-card"><h2>Regras de agendamento</h2><div class="state">Antecedência mínima de ${bk.minAdvanceMin} min, até ${bk.maxDaysAhead} dias à frente, grade de ${bk.slotStepMin} min. Cancelar até ${bk.cancelMinHours}h antes; remarcar até ${bk.rescheduleMinHours}h antes. ${bk.autoConfirm ? 'Confirmação automática.' : 'Agendamento online entra como pendente.'}</div><button class="btn btn-sm" data-open="booking">Editar regras</button></div>
        <div class="card setting-card"><h2>Notificações</h2><div class="state">E-mail ${n.emailEnabled ? 'ativado' : 'desativado'} (${i.email.ready ? 'Resend conectado' : 'sem credencial'}). WhatsApp ${n.whatsappEnabled ? 'ativado' : 'desativado'} (${i.whatsapp.ready ? 'Meta conectado' : 'sem credencial'}). Lembretes ${n.reminderHoursBefore.map((h) => `${h}h`).join(' e ') || 'desligados'} antes.</div><button class="btn btn-sm" data-open="notifications">Editar notificações</button></div>
        <div class="card setting-card"><h2>Pagamento online</h2><div class="state">${p.mode === 'desligado' ? 'Desligado: o cliente paga na barbearia' : p.mode === 'sinal' ? `Sinal de ${p.depositPercent}% por Pix ou cartão` : 'Pagamento integral online'}. ${i.mercadopago.ready ? 'Mercado Pago conectado.' : 'Mercado Pago sem credencial.'}</div><button class="btn btn-sm" data-open="payments">Editar pagamento</button></div>
        <div class="card setting-card"><h2>Integrações</h2><div class="state">${Object.values(i).map((x) => state(x.ready, `${esc(x.provider)}${x.ready ? '' : `: falta ${x.missing.map(esc).join(', ')}`}`)).join('<br>')}<br><span class="small">Webhook do Mercado Pago: <code>${esc(r.webhookUrl)}</code></span></div><span class="small muted">Credenciais ficam em variáveis de ambiente do servidor, nunca no painel.</span></div>
      </div>`;
    const forms = {
      business: () => ({
        title: 'Dados da barbearia', wide: true,
        body: `<div class="row row-2"><div class="field"><label>Nome<input class="input" name="name" value="${esc(b.name)}"></label></div><div class="field"><label>Frase de apresentação<input class="input" name="tagline" value="${esc(b.tagline)}"></label></div></div>
          <div class="field"><label>Descrição (página Sobre e Google)<textarea class="input" name="description">${esc(b.description)}</textarea></label></div>
          <div class="row row-2"><div class="field"><label>Rua e número<input class="input" name="street" value="${esc(b.street)}"></label></div><div class="field"><label>Bairro<input class="input" name="neighborhood" value="${esc(b.neighborhood)}"></label></div></div>
          <div class="row row-3"><div class="field"><label>Cidade<input class="input" name="city" value="${esc(b.city)}"></label></div><div class="field"><label>UF<input class="input" name="state" maxlength="2" value="${esc(b.state)}"></label></div><div class="field"><label>CEP<input class="input" name="postalCode" value="${esc(b.postalCode)}"></label></div></div>
          <div class="row row-3"><div class="field"><label>WhatsApp<input class="input" name="whatsapp" value="${esc(phone(b.whatsapp))}" placeholder="(11) 91234-5678"></label></div><div class="field"><label>Telefone<input class="input" name="phone" value="${esc(phone(b.phone))}"></label></div><div class="field"><label>Instagram (usuário)<input class="input" name="instagram" value="${esc(b.instagram)}"></label></div></div>
          <div class="row row-2"><div class="field"><label>E-mail<input class="input" name="email" type="email" value="${esc(b.email)}"></label></div><div class="field"><label>Contato de privacidade (LGPD)<input class="input" name="dpoContact" value="${esc(b.dpoContact)}"></label></div></div>
          <div class="field"><label>Link de incorporação do Google Maps<input class="input" name="mapEmbedUrl" value="${esc(b.mapEmbedUrl)}"></label><span class="hint">No Google Maps: Compartilhar > Incorporar um mapa > copie só o endereço que está dentro de src="...".</span></div>
          <div class="row row-3"><div class="field"><label>Link "abrir no mapa"<input class="input" name="mapLinkUrl" value="${esc(b.mapLinkUrl)}"></label></div><div class="field"><label>Latitude<input class="input" name="latitude" value="${esc(b.latitude)}"></label></div><div class="field"><label>Longitude<input class="input" name="longitude" value="${esc(b.longitude)}"></label></div></div>
          <div class="row row-2"><div class="field"><label>Razão social<input class="input" name="legalName" value="${esc(b.legalName)}"></label></div><div class="field"><label>CNPJ<input class="input" name="cnpj" value="${esc(b.cnpj)}"></label></div></div>`,
        save: (d) => api('/settings/business', { method: 'PUT', body: d }),
      }),
      hours: () => ({
        title: 'Horário de funcionamento',
        body: `<div class="hours-edit">${[1, 2, 3, 4, 5, 6, 0].map((d) => { const h = bh.hours.find((x) => x.weekday === d) || { closed: 1, open_min: 540, close_min: 1140 }; return `<div class="h-row" data-wd="${d}"><label class="check"><input type="checkbox" class="h-on" ${h.closed ? '' : 'checked'}><span>${WD[d].slice(0, 3)}</span></label><div class="h-times"><input class="input h-start" type="time" value="${hhmm(h.open_min)}" aria-label="${WD[d]} abre"> às <input class="input h-end" type="time" value="${hhmm(h.close_min)}" aria-label="${WD[d]} fecha"></div></div>`; }).join('')}</div><p class="small muted">Desmarque o dia para fechado.</p>`,
        save: (d, m) => api('/business-hours', { method: 'PUT', body: { hours: [...m.querySelectorAll('.h-row')].map((r) => ({ weekday: Number(r.dataset.wd), closed: !r.querySelector('.h-on').checked, open: r.querySelector('.h-start').value, close: r.querySelector('.h-end').value })) } }),
      }),
      booking: () => ({
        title: 'Regras de agendamento',
        body: `<div class="row row-2"><div class="field"><label>Antecedência mínima (minutos)<input class="input" type="number" name="minAdvanceMin" value="${bk.minAdvanceMin}"></label></div><div class="field"><label>Agendar até quantos dias à frente<input class="input" type="number" name="maxDaysAhead" value="${bk.maxDaysAhead}"></label></div></div>
          <div class="row row-2"><div class="field"><label>Horários a cada<select class="input" name="slotStepMin">${[5, 10, 15, 20, 30, 60].map((x) => `<option value="${x}" ${x === bk.slotStepMin ? 'selected' : ''}>${x} minutos</option>`).join('')}</select></label></div><div class="field"><label>Máximo de serviços por horário<input class="input" type="number" name="maxServicesPerBooking" value="${bk.maxServicesPerBooking}"></label></div></div>
          <div class="row row-3"><div class="field"><label>Cancelar até (horas antes)<input class="input" type="number" name="cancelMinHours" value="${bk.cancelMinHours}"></label></div><div class="field"><label>Remarcar até (horas antes)<input class="input" type="number" name="rescheduleMinHours" value="${bk.rescheduleMinHours}"></label></div><div class="field"><label>Remarcações por agendamento<input class="input" type="number" name="maxReschedules" value="${bk.maxReschedules}"></label></div></div>
          <label class="check"><input type="checkbox" name="autoConfirm" ${bk.autoConfirm ? 'checked' : ''}><span>Confirmar automaticamente agendamentos online</span></label>
          <label class="check"><input type="checkbox" name="allowClientCancel" ${bk.allowClientCancel ? 'checked' : ''}><span>Cliente pode cancelar pelo site</span></label>
          <label class="check"><input type="checkbox" name="allowClientReschedule" ${bk.allowClientReschedule ? 'checked' : ''}><span>Cliente pode remarcar pelo site</span></label>
          <div class="field" style="margin-top:10px"><label>Texto da política de cancelamento<textarea class="input" name="policyText">${esc(bk.policyText)}</textarea></label></div>`,
        save: (d) => api('/settings/booking', { method: 'PUT', body: d }),
      }),
      notifications: () => ({
        title: 'Notificações',
        body: `${integrationAlerts({ email: i.email, whatsapp: i.whatsapp })}
          <label class="check"><input type="checkbox" name="emailEnabled" ${n.emailEnabled ? 'checked' : ''}><span>Enviar e-mails (para clientes que informaram e-mail)</span></label>
          <label class="check"><input type="checkbox" name="whatsappEnabled" ${n.whatsappEnabled ? 'checked' : ''}><span>Enviar WhatsApp (modelos aprovados pela Meta)</span></label>
          <div class="field" style="margin-top:10px"><label>Lembretes: quantas horas antes<input class="input" name="reminderHoursBefore" value="${n.reminderHoursBefore.join(', ')}"></label><span class="hint">Até 3 valores separados por vírgula, ex.: 24, 2. Deixe vazio para não enviar lembretes.</span></div>`,
        save: (d) => api('/settings/notifications', { method: 'PUT', body: d }),
      }),
      payments: () => ({
        title: 'Pagamento online',
        body: `${i.mercadopago.ready ? '' : integrationAlerts({ mercadopago: i.mercadopago })}
          <div class="field"><span class="label">Cobrança</span>
          <label class="check"><input type="radio" name="mode" value="desligado" ${p.mode === 'desligado' ? 'checked' : ''}><span>Desligado (paga na barbearia)</span></label>
          <label class="check"><input type="radio" name="mode" value="sinal" ${p.mode === 'sinal' ? 'checked' : ''} ${i.mercadopago.ready ? '' : 'disabled'}><span>Sinal antecipado</span></label>
          <label class="check"><input type="radio" name="mode" value="integral" ${p.mode === 'integral' ? 'checked' : ''} ${i.mercadopago.ready ? '' : 'disabled'}><span>Pagamento integral antecipado</span></label></div>
          <div class="row row-2"><div class="field"><label>Percentual do sinal<input class="input" type="number" name="depositPercent" value="${p.depositPercent}"></label></div><div class="field"><label>Prazo para pagar (minutos)<input class="input" type="number" name="holdMinutes" value="${p.holdMinutes}"></label><span class="hint">Depois disso o horário é liberado.</span></div></div>`,
        save: (d) => api('/settings/payments', { method: 'PUT', body: d }),
      }),
    };
    view.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => {
      const f = forms[btn.dataset.open]();
      modal({ title: f.title, wide: f.wide, body: f.body, actions: [{ label: 'Voltar' }, { label: 'Salvar', cls: 'btn-primary', run: async (m) => { await f.save(formData(m), m); toast('Configuração salva.'); const me = await api('/me'); S.me = me; refresh(); } }] });
    }));
  }

  // ---------- CONTA ----------
  function viewAccount(view) {
    view.innerHTML = `<div class="view-head"><h1>Minha senha</h1></div>
      <form class="card" id="pw" style="max-width:440px" novalidate>
        <div class="field"><label for="pw-c">Senha atual</label><input class="input" id="pw-c" name="current" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="pw-n">Nova senha</label><input class="input" id="pw-n" name="next" type="password" autocomplete="new-password"><span class="hint">Mínimo de 10 caracteres, com letras e números.</span></div>
        <div class="pw-err" role="alert"></div>
        <button class="btn btn-primary" type="submit">Trocar senha</button></form>`;
    const f = view.querySelector('#pw');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/me/senha', { method: 'POST', body: formData(f) }); f.reset(); f.querySelector('.pw-err').innerHTML = '<div class="alert alert-ok">Senha alterada. Outras sessões foram encerradas.</div>'; } catch (err) { f.querySelector('.pw-err').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
    });
  }

  boot();
})();
