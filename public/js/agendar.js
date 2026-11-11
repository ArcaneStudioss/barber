/* Fluxo de agendamento online */
(function () {
  'use strict';
  const BE = window.BE;
  const root = document.getElementById('booking-app');
  if (!root) return;
  const esc = BE.esc;

  const STEPS = ['Serviços', 'Profissional', 'Dia e horário', 'Seus dados', 'Revisão'];
  const state = {
    step: 0, catalog: null, me: null,
    services: [], professional: null, date: null, time: null,
    days: null, slots: null, month: null,
    customer: { name: '', phone: '', email: '', marketingConsent: false, privacyAccepted: false, notes: '' },
    result: null, error: null, busy: false,
  };

  const qs = new URLSearchParams(location.search);

  async function init() {
    try {
      state.catalog = await BE.api('/api/catalog');
      try {
        const me = await BE.api('/api/cliente/me');
        if (me.access === 'completo') state.me = me;
      } catch (e) { /* não logado: segue normal */ }
      const pre = Number(qs.get('servico'));
      if (pre && state.catalog.services.some((s) => s.id === pre)) state.services = [pre];
      const prePro = Number(qs.get('profissional'));
      if (prePro && state.catalog.professionals.some((p) => p.id === prePro)) { state.preferredPro = prePro; state.professional = prePro; }
      const again = qs.get('repetir');
      if (again) {
        const ids = again.split(',').map(Number).filter((id) => state.catalog.services.some((s) => s.id === id));
        if (ids.length) state.services = ids;
      }
      if (state.me) {
        state.customer.name = state.me.customer.name;
        state.customer.email = state.me.customer.email;
        state.customer.phone = state.me.customer.phone;
      }
      render();
    } catch (err) {
      root.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  const svc = (id) => state.catalog.services.find((s) => s.id === id);
  const pro = (id) => state.catalog.professionals.find((p) => p.id === id);
  function totals() {
    const list = state.services.map(svc).filter(Boolean);
    return { list, price: list.reduce((a, s) => a + s.price_cents, 0), duration: list.reduce((a, s) => a + s.duration_min, 0) };
  }
  function eligiblePros() {
    return state.catalog.professionals.filter((p) => state.services.every((id) => p.services.includes(id)));
  }

  function progress() {
    return `<ol class="steps" aria-label="Etapas do agendamento">${STEPS.map((s, i) => `<li class="${i === state.step ? 'current' : i < state.step ? 'done' : ''}"${i === state.step ? ' aria-current="step"' : ''}><span class="n">${i + 1}</span><span class="t">${s}</span></li>`).join('')}</ol>`;
  }

  function summaryBar() {
    const t = totals();
    if (!t.list.length) return '';
    return `<aside class="summary" aria-label="Resumo"><div><strong>${t.list.length} ${t.list.length > 1 ? 'serviços' : 'serviço'}</strong><span>${BE.duration(t.duration)}</span></div><div class="sum-price">${BE.money(t.price)}</div></aside>`;
  }

  function nav({ back = true, nextLabel = 'Continuar', nextDisabled = false, nextId = 'next' } = {}) {
    return `<div class="step-nav">${back ? '<button type="button" class="btn btn-ghost" id="back">Voltar</button>' : '<span></span>'}<button type="button" class="btn btn-dark" id="${nextId}" ${nextDisabled ? 'disabled' : ''}>${nextLabel}</button></div>`;
  }

  function errorBox() { return state.error ? `<div class="alert alert-error" role="alert">${esc(state.error)}</div>` : ''; }

  // ---------- etapas ----------
  function stepServices() {
    const max = state.catalog.rules.maxServices;
    if (!state.catalog.services.length) return '<p>Nenhum serviço disponível para agendamento online no momento.</p>';
    return `<h2 tabindex="-1" class="step-title">Escolha os serviços</h2>
      <p class="muted">Pode marcar mais de um (até ${max}). A duração é somada automaticamente.</p>
      ${errorBox()}
      <fieldset class="choice-list"><legend class="sr-only">Serviços</legend>
      ${state.catalog.services.map((s) => `
        <label class="choice">
          <input type="checkbox" name="svc" value="${s.id}" ${state.services.includes(s.id) ? 'checked' : ''}>
          <span class="choice-body"><span class="price-line"><span class="name">${esc(s.name)}</span><span class="dots" aria-hidden="true"></span><span class="price">${BE.money(s.price_cents)}</span></span>
          <span class="choice-meta">${BE.duration(s.duration_min)}${s.description ? ` · ${esc(s.description)}` : ''}</span></span>
        </label>`).join('')}
      </fieldset>
      ${summaryBar()}
      ${nav({ back: false, nextDisabled: !state.services.length })}`;
  }

  function stepProfessional() {
    const pros = eligiblePros();
    if (!pros.length) {
      return `<h2 tabindex="-1" class="step-title">Profissional</h2><div class="alert">Nenhum profissional faz todos esses serviços juntos. Volte e ajuste a escolha, ou agende em dois horários.</div>${nav({ nextDisabled: true })}`;
    }
    const sel = state.professional;
    return `<h2 tabindex="-1" class="step-title">Com quem você quer cortar?</h2>
      ${errorBox()}
      <fieldset class="pro-list"><legend class="sr-only">Profissional</legend>
        <label class="pro-card"><input type="radio" name="pro" value="any" ${sel === 'any' ? 'checked' : ''}><span class="pro-body"><span class="pro-avatar any" aria-hidden="true">?</span><span><strong>Qualquer profissional disponível</strong><span class="choice-meta">Mostra mais horários</span></span></span></label>
        ${pros.map((p) => `<label class="pro-card"><input type="radio" name="pro" value="${p.id}" ${sel === p.id ? 'checked' : ''}><span class="pro-body">
          ${p.photo ? `<img class="pro-avatar" src="${esc(p.photo)}" alt="" width="56" height="56">` : `<span class="pro-avatar" aria-hidden="true">${esc(p.name.charAt(0))}</span>`}
          <span><strong>${esc(p.name)}</strong><span class="choice-meta">${esc(p.specialties || p.role_title || '')}</span></span></span></label>`).join('')}
      </fieldset>
      ${summaryBar()}
      ${nav({ nextDisabled: !sel })}`;
  }

  function calendar() {
    const r = state.catalog.rules;
    const month = state.month || r.today.slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`;
    const startWd = BE.weekday(first);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const avail = new Set(state.days || []);
    const cells = [];
    for (let i = 0; i < startWd; i++) cells.push('<span class="cal-empty" aria-hidden="true"></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      const ok = avail.has(iso);
      const label = `${BE.dateLong(iso)}${ok ? '' : ', sem horários'}`;
      cells.push(`<button type="button" class="cal-day ${iso === state.date ? 'selected' : ''} ${iso === r.today ? 'today' : ''}" data-date="${iso}" ${ok ? '' : 'disabled'} aria-label="${label}" aria-pressed="${iso === state.date}">${d}</button>`);
    }
    const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    const canPrev = prevMonth >= r.today.slice(0, 7);
    const canNext = nextMonth <= r.lastDate.slice(0, 7);
    return `<div class="cal">
      <div class="cal-head"><button type="button" class="cal-nav" data-month="${prevMonth}" ${canPrev ? '' : 'disabled'} aria-label="Mês anterior">‹</button>
      <strong aria-live="polite">${BE.MONTHS[m - 1].replace(/^./, (c) => c.toUpperCase())} de ${y}</strong>
      <button type="button" class="cal-nav" data-month="${nextMonth}" ${canNext ? '' : 'disabled'} aria-label="Próximo mês">›</button></div>
      <div class="cal-grid" role="group" aria-label="Dias">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => `<span class="cal-wd" aria-hidden="true">${d}</span>`).join('')}${cells.join('')}</div>
    </div>`;
  }

  function slotsBlock() {
    if (!state.date) return '<p class="muted slots-empty">Escolha um dia para ver os horários livres.</p>';
    if (!state.slots) return '<p class="muted slots-empty">Buscando horários...</p>';
    if (!state.slots.length) return '<p class="slots-empty">Não há mais horários livres neste dia. Escolha outro dia.</p>';
    const groups = [['Manhã', (t) => t < '12:00'], ['Tarde', (t) => t >= '12:00' && t < '18:00'], ['Noite', (t) => t >= '18:00']];
    return `<h3 class="slots-title">${esc(BE.dateLong(state.date))}</h3>${groups.map(([name, fn]) => {
      const list = state.slots.filter((s) => fn(s.time));
      if (!list.length) return '';
      return `<div class="slot-group"><span class="slot-label">${name}</span><div class="slots">${list.map((s) => `<button type="button" class="slot ${s.time === state.time ? 'selected' : ''}" data-time="${s.time}" aria-pressed="${s.time === state.time}">${s.time}</button>`).join('')}</div></div>`;
    }).join('')}`;
  }

  function stepDate() {
    return `<h2 tabindex="-1" class="step-title">Escolha o dia e o horário</h2>
      <p class="muted">Só aparecem horários realmente livres para ${state.professional === 'any' ? 'algum profissional' : esc(pro(state.professional).name)}, já considerando a duração de ${BE.duration(totals().duration)}.</p>
      ${errorBox()}
      <div class="date-time">${state.days ? calendar() : '<p class="muted">Carregando dias disponíveis...</p>'}<div class="slot-area" aria-live="polite">${slotsBlock()}</div></div>
      ${state.days && !state.days.length ? '<div class="alert">Não encontramos horários livres no período aberto para agendamento. Tente outro profissional ou fale pelo WhatsApp.</div>' : ''}
      ${summaryBar()}
      ${nav({ nextDisabled: !state.time })}`;
  }

  function stepCustomer() {
    const c = state.customer;
    if (state.me) {
      return `<h2 tabindex="-1" class="step-title">Seus dados</h2>
        <p>Agendando como <strong>${esc(c.name)}</strong> (${esc(c.phone)}). <a class="link" href="/cliente">Alterar dados</a></p>
        <div class="field"><label for="f-notes">Observação para o barbeiro (opcional)</label><textarea class="input" id="f-notes" maxlength="300">${esc(c.notes)}</textarea></div>
        ${nav()}`;
    }
    const fe = (f) => (state.fieldError && state.fieldError.field === f ? `<span class="error-text" id="err-${f}">${esc(state.fieldError.message)}</span>` : '');
    const inv = (f) => (state.fieldError && state.fieldError.field === f ? 'aria-invalid="true" aria-describedby="err-' + f + '"' : '');
    return `<h2 tabindex="-1" class="step-title">Seus dados</h2>
      <p class="muted">Usamos só para confirmar e lembrar do seu horário.</p>
      ${state.error && !state.fieldError ? errorBox() : ''}
      <form id="cust-form" novalidate>
        <div class="field"><label for="f-name">Nome</label><input class="input" id="f-name" name="name" autocomplete="name" required maxlength="80" value="${esc(c.name)}" ${inv('name')}>${fe('name')}</div>
        <div class="field"><label for="f-phone">Celular com DDD</label><input class="input" id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" required placeholder="(11) 91234-5678" value="${esc(c.phone)}" ${inv('phone')}><span class="hint">Para confirmação e lembrete. Se informar um número que já usou aqui, o agendamento entra no mesmo cadastro.</span>${fe('phone')}</div>
        <div class="field"><label for="f-email">E-mail <span class="muted">(opcional)</span></label><input class="input" id="f-email" name="email" type="email" autocomplete="email" maxlength="120" value="${esc(c.email)}" ${inv('email')}><span class="hint">Para receber a confirmação e acessar seus agendamentos depois.</span>${fe('email')}</div>
        <div class="field"><label for="f-notes">Observação para o barbeiro (opcional)</label><textarea class="input" id="f-notes" name="notes" maxlength="300">${esc(c.notes)}</textarea></div>
        <div class="hp" aria-hidden="true"><label>Não preencha <input name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="field"><label class="check"><input type="checkbox" name="privacyAccepted" ${c.privacyAccepted ? 'checked' : ''} ${inv('privacyAccepted')}><span>Li e concordo com a <a class="link" href="/privacidade" target="_blank">Política de Privacidade</a> e os <a class="link" href="/termos" target="_blank">Termos de uso</a>. Meus dados serão usados para este agendamento.</span></label>${fe('privacyAccepted')}</div>
        <div class="field"><label class="check"><input type="checkbox" name="marketingConsent" ${c.marketingConsent ? 'checked' : ''}><span>Quero receber novidades e promoções da barbearia (opcional, dá para cancelar quando quiser).</span></label></div>
      </form>
      ${nav()}`;
  }

  function stepReview() {
    const t = totals();
    const pay = state.catalog.payment;
    const deposit = pay ? (pay.mode === 'integral' ? t.price : Math.max(100, Math.round(t.price * pay.depositPercent / 100))) : 0;
    return `<h2 tabindex="-1" class="step-title">Confira antes de confirmar</h2>
      ${errorBox()}
      <dl class="review">
        <div><dt>Serviços</dt><dd>${t.list.map((s) => `${esc(s.name)} <span class="muted">(${BE.duration(s.duration_min)}, ${BE.money(s.price_cents)})</span>`).join('<br>')}</dd></div>
        <div><dt>Profissional</dt><dd>${state.professional === 'any' ? 'Qualquer profissional disponível' : esc(pro(state.professional).name)}</dd></div>
        <div><dt>Dia e horário</dt><dd>${esc(BE.dateLong(state.date))}, às ${esc(state.time)}</dd></div>
        <div><dt>Duração total</dt><dd>${BE.duration(t.duration)}</dd></div>
        <div><dt>Valor total</dt><dd class="sum-price">${BE.money(t.price)}</dd></div>
        <div><dt>Nome</dt><dd>${esc(state.customer.name)}</dd></div>
        <div><dt>Celular</dt><dd>${esc(state.customer.phone)}</dd></div>
        ${state.customer.email ? `<div><dt>E-mail</dt><dd>${esc(state.customer.email)}</dd></div>` : ''}
      </dl>
      ${pay ? `<div class="alert">Para garantir o horário, é preciso pagar ${pay.mode === 'integral' ? 'o valor total' : `um sinal de ${BE.money(deposit)}`} por Pix ou cartão em até ${pay.holdMinutes} minutos depois de confirmar.</div>` : '<p class="muted">O pagamento é feito na barbearia.</p>'}
      <p class="small muted">${esc(state.catalog.rules.policyText)}</p>
      ${nav({ nextLabel: state.busy ? 'Confirmando...' : 'Confirmar agendamento', nextDisabled: state.busy, nextId: 'confirm' })}`;
  }

  function stepDone() {
    const r = state.result; const a = r.appointment;
    const needsPay = r.paymentRequired && a.status === 'pendente';
    return `<div class="done">
      <h2 tabindex="-1" class="step-title">${needsPay ? 'Falta só o pagamento' : 'Agendamento confirmado'}</h2>
      <p class="code-line">Número do agendamento <strong class="code">${esc(a.code)}</strong></p>
      <dl class="review">
        <div><dt>Quando</dt><dd>${esc(BE.dateLong(a.date))}, das ${esc(a.time)} às ${esc(a.endTime)}</dd></div>
        <div><dt>Com</dt><dd>${esc(a.professional)}</dd></div>
        <div><dt>Serviços</dt><dd>${a.services.map((s) => esc(s.name)).join(', ')}</dd></div>
        <div><dt>Valor</dt><dd>${BE.money(a.total_price_cents)}</dd></div>
      </dl>
      ${needsPay ? `<div class="alert">O horário fica reservado até ${new Date(a.payment_expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}. Depois disso, se o pagamento não for confirmado, ele é liberado.</div>
        <p><button type="button" class="btn btn-primary" id="pay">Pagar ${BE.money(a.payment_required_cents)} por Pix ou cartão</button></p>` : ''}
      <div class="done-actions">
        <a class="btn btn-dark" href="/api/cliente/agendamentos/${a.id}/calendario.ics">Adicionar ao calendário</a>
        <a class="btn btn-ghost" href="${esc(r.googleCalendar)}" target="_blank" rel="noopener">Google Agenda</a>
      </div>
      <div class="manage-box">
        <h3>Guarde este link para cancelar ou remarcar</h3>
        <p class="small">Ele dá acesso a este agendamento sem senha. Não compartilhe.</p>
        <div class="copy-row"><input class="input" id="manage-url" readonly value="${esc(r.manageUrl)}" aria-label="Link do agendamento"><button type="button" class="btn btn-ghost" id="copy">Copiar link</button></div>
        <p class="small" style="margin-top:12px"><a class="link" href="/cliente">Ver meus agendamentos</a></p>
      </div>
    </div>`;
  }

  // ---------- render e eventos ----------
  function render(focus = true) {
    if (state.result) { root.innerHTML = stepDone(); bindDone(); if (focus) root.querySelector('.step-title').focus(); return; }
    const views = [stepServices, stepProfessional, stepDate, stepCustomer, stepReview];
    root.innerHTML = progress() + `<div class="step">${views[state.step]()}</div>`;
    bind();
    if (focus) { const h = root.querySelector('.step-title'); if (h) h.focus({ preventScroll: false }); }
  }

  function go(step) {
    state.error = null; state.fieldError = null;
    state.step = step;
    render();
    if (step === 2 && !state.days) loadDays();
    window.scrollTo({ top: root.getBoundingClientRect().top + window.scrollY - 100, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function proParam() { return state.professional === 'any' ? 'any' : state.professional; }

  async function loadDays() {
    state.days = null; render(false);
    try {
      const r = await BE.api(`/api/availability/days?services=${state.services.join(',')}&professional=${proParam()}`);
      state.days = r.days;
      if (state.date && !r.days.includes(state.date)) { state.date = null; state.time = null; state.slots = null; }
      if (!state.date && r.days.length) state.month = r.days[0].slice(0, 7);
      render(false);
      if (state.date) loadSlots();
    } catch (err) { state.error = err.message; state.days = []; render(false); }
  }

  async function loadSlots() {
    state.slots = null; render(false);
    try {
      const r = await BE.api(`/api/availability?services=${state.services.join(',')}&professional=${proParam()}&date=${state.date}`);
      state.slots = r.slots;
      if (state.time && !r.slots.some((s) => s.time === state.time)) state.time = null;
      render(false);
    } catch (err) { state.error = err.message; state.slots = []; render(false); }
  }

  function readCustomer() {
    const f = document.getElementById('cust-form');
    const notes = document.getElementById('f-notes');
    if (notes) state.customer.notes = notes.value;
    if (!f) return true;
    const d = new FormData(f);
    Object.assign(state.customer, {
      name: d.get('name').trim(), phone: d.get('phone').trim(), email: d.get('email').trim(),
      privacyAccepted: !!d.get('privacyAccepted'), marketingConsent: !!d.get('marketingConsent'), website: d.get('website'),
    });
    const c = state.customer;
    const digits = c.phone.replace(/\D/g, '');
    let fe = null;
    if (c.name.length < 2) fe = { field: 'name', message: 'Informe seu nome.' };
    else if (digits.length < 10 || digits.length > 13) fe = { field: 'phone', message: 'Informe o celular com DDD, ex.: (11) 91234-5678.' };
    else if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) fe = { field: 'email', message: 'E-mail inválido.' };
    else if (!c.privacyAccepted) fe = { field: 'privacyAccepted', message: 'Para agendar, marque que concorda com a Política de Privacidade.' };
    state.fieldError = fe;
    if (fe) { state.error = fe.message; render(false); const el = document.querySelector(`[name="${fe.field}"]`); if (el) el.focus(); return false; }
    return true;
  }

  async function confirm() {
    state.busy = true; state.error = null; render(false);
    try {
      const c = state.customer;
      const body = {
        services: state.services, professional: proParam(), date: state.date, time: state.time,
        name: c.name, phone: c.phone, email: c.email, notes: c.notes,
        privacyAccepted: c.privacyAccepted, marketingConsent: c.marketingConsent, website: c.website || '',
      };
      const r = await BE.api('/api/bookings', { method: 'POST', body });
      const a = r.appointment;
      r.googleCalendar = googleLink(a);
      state.result = r;
      state.busy = false;
      render();
    } catch (err) {
      state.busy = false;
      if (err.status === 409) {
        // horário foi ocupado por outra pessoa: volta para escolher outro
        state.time = null; state.step = 2; state.error = err.message;
        render(); loadSlots(); loadDaysQuiet();
        return;
      }
      if (err.field && ['name', 'phone', 'email', 'privacyAccepted'].includes(err.field)) {
        state.step = 3; state.fieldError = { field: err.field, message: err.message }; state.error = err.message; render(); return;
      }
      state.error = err.message; render(false);
    }
  }
  async function loadDaysQuiet() {
    try { const r = await BE.api(`/api/availability/days?services=${state.services.join(',')}&professional=${proParam()}`); state.days = r.days; render(false); } catch (e) { /* mantém */ }
  }

  function googleLink(a) {
    const toStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const start = a.start_at; const end = start + a.total_duration_min * 60000;
    const p = new URLSearchParams({ action: 'TEMPLATE', text: `Barbearia: ${a.services.map((s) => s.name).join(', ')}`, dates: `${toStamp(start)}/${toStamp(end)}`, details: `Com ${a.professional}. Número ${a.code}` });
    return `https://calendar.google.com/calendar/render?${p}`;
  }

  function bind() {
    const back = document.getElementById('back');
    if (back) back.addEventListener('click', () => { if (state.step === 3) readCustomerSilent(); go(state.step - 1); });
    const next = document.getElementById('next');
    if (next) next.addEventListener('click', () => {
      if (state.step === 3 && !readCustomer()) return;
      if (state.step === 0 && state.professional && state.professional !== 'any' && !eligiblePros().some((p) => p.id === state.professional)) state.professional = null;
      if (state.step === 1) { state.days = null; }
      go(state.step + 1);
    });
    const conf = document.getElementById('confirm');
    if (conf) conf.addEventListener('click', confirm);

    root.querySelectorAll('input[name=svc]').forEach((el) => el.addEventListener('change', () => {
      const id = Number(el.value);
      const max = state.catalog.rules.maxServices;
      if (el.checked) {
        if (state.services.length >= max) { el.checked = false; state.error = `Escolha no máximo ${max} serviços por horário.`; render(false); return; }
        state.services.push(id);
      } else state.services = state.services.filter((x) => x !== id);
      state.error = null;
      state.days = null; state.date = null; state.time = null; state.slots = null;
      if (state.professional && state.professional !== 'any' && !eligiblePros().some((p) => p.id === state.professional)) state.professional = null;
      if (!state.professional && state.preferredPro && eligiblePros().some((p) => p.id === state.preferredPro)) state.professional = state.preferredPro;
      const scroll = window.scrollY;
      render(false); window.scrollTo(0, scroll);
      const again = root.querySelector(`input[name=svc][value="${id}"]`); if (again) again.focus();
    }));
    root.querySelectorAll('input[name=pro]').forEach((el) => el.addEventListener('change', () => {
      state.professional = el.value === 'any' ? 'any' : Number(el.value);
      state.days = null; state.date = null; state.time = null; state.slots = null;
      render(false);
      const again = root.querySelector(`input[name=pro][value="${el.value}"]`); if (again) again.focus();
    }));
    root.querySelectorAll('.cal-nav').forEach((b) => b.addEventListener('click', () => { state.month = b.dataset.month; render(false); const n = root.querySelector(`.cal-nav[data-month]`); if (n) n.focus(); }));
    root.querySelectorAll('.cal-day').forEach((b) => b.addEventListener('click', () => {
      state.date = b.dataset.date; state.time = null; state.error = null;
      loadSlots().then(() => { const s = root.querySelector('.slot'); if (s && window.innerWidth < 860) s.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
    }));
    root.querySelectorAll('.slot').forEach((b) => b.addEventListener('click', () => {
      state.time = b.dataset.time; render(false);
      const n = document.getElementById('next'); if (n) n.focus();
    }));
    const phone = document.getElementById('f-phone');
    if (phone) phone.addEventListener('input', () => { phone.value = BE.phoneMask(phone.value); });
  }
  function readCustomerSilent() {
    const f = document.getElementById('cust-form');
    if (!f) return;
    const d = new FormData(f);
    Object.assign(state.customer, { name: d.get('name'), phone: d.get('phone'), email: d.get('email'), notes: d.get('notes'), privacyAccepted: !!d.get('privacyAccepted'), marketingConsent: !!d.get('marketingConsent') });
  }

  function bindDone() {
    const copy = document.getElementById('copy');
    if (copy) copy.addEventListener('click', async () => {
      const input = document.getElementById('manage-url');
      try { await navigator.clipboard.writeText(input.value); BE.toast('Link copiado.'); } catch (e) { input.select(); BE.toast('Selecione e copie o link.'); }
    });
    const pay = document.getElementById('pay');
    if (pay) pay.addEventListener('click', async () => {
      pay.disabled = true;
      try { const r = await BE.api(`/api/cliente/agendamentos/${state.result.appointment.id}/pagar`, { method: 'POST' }); location.href = r.url; } catch (err) { BE.toast(err.message); pay.disabled = false; }
    });
  }

  init();
})();
