/* Área do cliente */
(function () {
  'use strict';
  const BE = window.BE;
  const root = document.getElementById('client-app');
  if (!root) return;
  const esc = BE.esc;
  let data = null; let catalog = null;
  const params = new URLSearchParams(location.search);

  async function load() {
    try {
      data = await BE.api('/api/cliente/me');
      renderArea();
    } catch (err) {
      if (err.status === 401) return renderLogin();
      root.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    }
  }

  // ---------- acesso ----------
  function renderLogin(stage = 'id', identifier = '', msg = '') {
    const invalidLink = params.get('link') === 'invalido';
    root.innerHTML = `
      ${invalidLink && stage === 'id' ? '<div class="alert alert-error">Este link de agendamento é inválido ou expirou. Entre com o código de verificação abaixo.</div>' : ''}
      <h2 class="step-title" tabindex="-1">Acessar meus agendamentos</h2>
      <p>Use o link que aparece ao agendar, ou receba um código de 6 dígitos no e-mail ou WhatsApp cadastrado.</p>
      ${msg}
      ${stage === 'id' ? `
      <form id="id-form" novalidate>
        <div class="field"><label for="c-id">Celular com DDD ou e-mail</label><input class="input" id="c-id" name="identifier" autocomplete="username" required value="${esc(identifier)}"></div>
        <div class="form-err" role="alert"></div>
        <button class="btn btn-dark" type="submit">Receber código</button>
      </form>` : `
      <form id="code-form" novalidate>
        <div class="field"><label for="c-code">Código de 6 dígitos</label><input class="input" id="c-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required><span class="hint">Enviado para o contato cadastrado de ${esc(identifier)}. Vale por 10 minutos.</span></div>
        <div class="form-err" role="alert"></div>
        <div class="appt-actions"><button class="btn btn-dark" type="submit">Entrar</button><button class="btn btn-ghost" type="button" id="restart">Usar outro contato</button></div>
      </form>`}
      <p class="small muted" style="margin-top:28px">Ainda não agendou? <a class="link" href="/agendar">Agende seu horário</a>.</p>`;
    root.querySelector('.step-title').focus();
    const idf = document.getElementById('id-form');
    if (idf) idf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = idf.identifier.value.trim();
      const err = idf.querySelector('.form-err');
      if (!id) { err.innerHTML = '<span class="error-text">Informe seu celular ou e-mail.</span>'; return; }
      idf.querySelector('button').disabled = true;
      try {
        const r = await BE.api('/api/cliente/codigo', { method: 'POST', body: { identifier: id } });
        if (r.warning) { err.innerHTML = `<div class="alert">${esc(r.warning)}</div>`; idf.querySelector('button').disabled = false; return; }
        renderLogin('code', id, `<div class="alert alert-ok">${esc(r.message)}</div>`);
      } catch (ex) { err.innerHTML = `<span class="error-text">${esc(ex.message)}</span>`; idf.querySelector('button').disabled = false; }
    });
    const cf = document.getElementById('code-form');
    if (cf) {
      document.getElementById('restart').addEventListener('click', () => renderLogin('id', identifier));
      cf.code.focus();
      cf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = cf.querySelector('.form-err');
        cf.querySelector('button').disabled = true;
        try {
          await BE.api('/api/cliente/verificar', { method: 'POST', body: { identifier, code: cf.code.value } });
          history.replaceState(null, '', '/cliente');
          load();
        } catch (ex) { err.innerHTML = `<span class="error-text">${esc(ex.message)}</span>`; cf.querySelector('button').disabled = false; cf.code.setAttribute('aria-invalid', 'true'); }
      });
    }
  }

  // ---------- área ----------
  function card(a) {
    return `<article class="appt-card" data-id="${a.id}">
      <header><div><h3>${esc(BE.dateLong(a.date))}, ${esc(a.time)}</h3><p class="muted" style="margin:4px 0 0">${a.services.map((s) => esc(s.name)).join(', ')} com ${esc(a.professional)}</p></div><span class="badge ${a.status}">${esc(a.statusLabel)}</span></header>
      <p class="small" style="margin:10px 0 0">Número ${esc(a.code)} · ${BE.duration(a.total_duration_min)} · ${BE.money(a.total_price_cents)}</p>
      ${a.awaitingPayment ? `<div class="alert" style="margin-top:12px">Aguardando pagamento de ${BE.money(a.payment_required_cents - a.paid_cents)} para confirmar.</div>` : ''}
      <div class="appt-actions">
        ${a.awaitingPayment ? '<button class="btn btn-primary btn-sm" data-act="pay">Pagar agora</button>' : ''}
        ${a.canReschedule ? '<button class="btn btn-dark btn-sm" data-act="reschedule">Remarcar</button>' : ''}
        ${a.canCancel ? '<button class="btn btn-ghost btn-sm" data-act="cancel">Cancelar</button>' : ''}
        <a class="btn btn-ghost btn-sm" href="/api/cliente/agendamentos/${a.id}/calendario.ics">Adicionar ao calendário</a>
      </div>
      ${!a.canCancel && a.cancelBlockedReason ? `<p class="small muted" style="margin:10px 0 0">${esc(a.cancelBlockedReason)}</p>` : ''}
    </article>`;
  }

  function renderArea() {
    const full = data.access === 'completo';
    const c = data.customer;
    root.innerHTML = `
      <h2 class="step-title" tabindex="-1">Olá, ${esc(c.name.split(' ')[0])}</h2>
      ${!full ? `<div class="alert">Você entrou pelo link de um agendamento e está vendo só ele. Para ver o histórico e alterar seus dados, <button type="button" class="link" id="go-full" style="background:none;border:0;padding:0;font:inherit;cursor:pointer;text-decoration:underline">confirme com um código</button>.</div>` : ''}
      <section aria-labelledby="t-next"><h2 id="t-next" class="sr-only">Próximos</h2>
        ${data.upcoming.length ? data.upcoming.map(card).join('') : '<p>Você não tem horários marcados. <a class="link" href="/agendar">Agendar agora</a></p>'}
      </section>
      <p class="small muted">${esc(data.policy)}</p>
      ${data.history.length ? `<section class="client-section" aria-labelledby="t-hist"><h2 id="t-hist">Histórico</h2><ul class="history-list">${data.history.map((a) => `<li><span>${esc(BE.dateBR(a.date))} · ${a.services.map((s) => esc(s.name)).join(', ')} <span class="badge ${a.status}">${esc(a.statusLabel)}</span></span>${a.services.every((s) => s.id) ? `<a class="link" href="/agendar?repetir=${a.services.map((s) => s.id).join(',')}">Agendar de novo</a>` : ''}</li>`).join('')}</ul></section>` : ''}
      ${full ? `<section class="client-section" aria-labelledby="t-dados"><h2 id="t-dados">Meus dados</h2>
        <form id="profile" novalidate>
          <div class="field"><label for="p-name">Nome</label><input class="input" id="p-name" name="name" autocomplete="name" required maxlength="80" value="${esc(c.name)}"></div>
          <div class="field"><span class="label">Celular</span><span>${esc(c.phone)}</span><span class="hint">Para trocar o número, fale com a barbearia.</span></div>
          <div class="field"><label for="p-email">E-mail</label><input class="input" id="p-email" name="email" type="email" autocomplete="email" maxlength="120" value="${esc(c.email)}"></div>
          <div class="field"><label class="check"><input type="checkbox" name="marketingConsent" ${c.marketingConsent ? 'checked' : ''}><span>Quero receber novidades e promoções (opcional). As mensagens sobre meus agendamentos continuam chegando normalmente.</span></label></div>
          <div class="form-err" role="status"></div>
          <button class="btn btn-dark" type="submit">Salvar dados</button>
        </form>
        <p style="margin-top:28px"><button type="button" class="btn btn-ghost btn-sm" id="delete-req">Pedir exclusão dos meus dados</button></p>
      </section>` : ''}
      <p class="client-section"><button type="button" class="btn btn-ghost btn-sm" id="logout">Sair</button></p>`;
    root.querySelector('.step-title').focus();
    bindArea();
  }

  function bindArea() {
    const goFull = document.getElementById('go-full');
    if (goFull) goFull.addEventListener('click', () => renderLogin('id', ''));
    document.getElementById('logout').addEventListener('click', async () => { await BE.api('/api/cliente/sair', { method: 'POST' }); location.href = '/cliente'; });
    root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = data.upcoming.find((x) => x.id === Number(b.closest('[data-id]').dataset.id));
      if (b.dataset.act === 'cancel') cancel(a);
      if (b.dataset.act === 'reschedule') reschedule(a);
      if (b.dataset.act === 'pay') pay(a, b);
    }));
    const prof = document.getElementById('profile');
    if (prof) prof.addEventListener('submit', async (e) => {
      e.preventDefault();
      const st = prof.querySelector('.form-err');
      try {
        await BE.api('/api/cliente/me', { method: 'PATCH', body: { name: prof.name.value, email: prof.email.value, marketingConsent: prof.marketingConsent.checked } });
        st.innerHTML = '<div class="alert alert-ok">Dados salvos.</div>';
      } catch (err) { st.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
    });
    const del = document.getElementById('delete-req');
    if (del) del.addEventListener('click', async () => {
      const ok = await BE.modal({ title: 'Pedir exclusão dos dados', html: '<p>A barbearia vai excluir seus dados pessoais e cancelar horários futuros. Registros financeiros obrigatórios ficam sem identificação. Você recebe a resposta em até 15 dias.</p><div class="field"><label for="del-msg">Comentário (opcional)</label><textarea class="input" id="del-msg" maxlength="1000"></textarea></div>', confirmText: 'Enviar pedido', danger: true });
      if (!ok) return;
      const msg = ok.querySelector ? (ok.querySelector('#del-msg') || {}).value : '';
      try { await BE.api('/api/cliente/exclusao', { method: 'POST', body: { message: msg || '' } }); BE.toast('Pedido de exclusão enviado.'); } catch (err) { BE.toast(err.message); }
    });
  }

  async function cancel(a) {
    const ok = await BE.modal({
      title: 'Cancelar agendamento?',
      html: `<p>${esc(BE.dateLong(a.date))}, às ${esc(a.time)}, com ${esc(a.professional)}. O horário fica livre para outra pessoa.</p><div class="field"><label for="c-reason">Motivo (opcional)</label><input class="input" id="c-reason" maxlength="200"></div>`,
      confirmText: 'Cancelar agendamento', cancelText: 'Manter horário', danger: true,
    });
    if (!ok) return;
    const reason = ok.querySelector ? (ok.querySelector('#c-reason') || {}).value : '';
    try { await BE.api(`/api/cliente/agendamentos/${a.id}/cancelar`, { method: 'POST', body: { reason } }); BE.toast('Agendamento cancelado.'); load(); } catch (err) { BE.toast(err.message); }
  }

  async function reschedule(a) {
    if (!catalog) { try { catalog = await BE.api('/api/catalog'); } catch (e) { BE.toast(e.message); return; } }
    const days = [];
    for (let d = catalog.rules.today; d <= catalog.rules.lastDate; d = BE.addDays(d, 1)) days.push(d);
    const pros = catalog.professionals.filter((p) => a.services.every((s) => p.services.includes(s.id)));
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="rs-t" style="max-width:560px">
      <h2 id="rs-t">Remarcar horário</h2>
      <p class="small muted">Atual: ${esc(BE.dateLong(a.date))}, às ${esc(a.time)}.</p>
      <div class="field"><label for="rs-pro">Profissional</label><select class="input" id="rs-pro"><option value="${a.professionalId}">${esc(a.professional)}</option>${pros.filter((p) => p.id !== a.professionalId).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}<option value="any">Qualquer profissional disponível</option></select></div>
      <div class="field"><label for="rs-day">Dia</label><select class="input" id="rs-day">${days.map((d) => `<option value="${d}">${esc(BE.dateLong(d))}</option>`).join('')}</select></div>
      <div id="rs-slots" aria-live="polite"><p class="muted">Escolha o dia.</p></div>
      <div class="form-err" role="alert"></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-x>Voltar</button><button type="button" class="btn btn-dark" id="rs-ok" disabled>Confirmar novo horário</button></div>
    </div>`;
    document.body.appendChild(box);
    const prev = document.activeElement;
    let chosen = null;
    const close = () => { box.remove(); if (prev) prev.focus(); };
    box.addEventListener('click', (e) => { if (e.target === box || e.target.hasAttribute('data-x')) close(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    const daySel = box.querySelector('#rs-day'); const proSel = box.querySelector('#rs-pro'); const slotsEl = box.querySelector('#rs-slots'); const okBtn = box.querySelector('#rs-ok');
    if (days.includes(a.date)) daySel.value = a.date;
    async function loadSlots() {
      chosen = null; okBtn.disabled = true;
      slotsEl.innerHTML = '<p class="muted">Buscando horários...</p>';
      try {
        const r = await BE.api(`/api/cliente/agendamentos/${a.id}/horarios?date=${daySel.value}&professional=${proSel.value}`);
        if (!r.slots.length) { slotsEl.innerHTML = '<p>Sem horários livres neste dia.</p>'; return; }
        slotsEl.innerHTML = `<div class="slots">${r.slots.map((s) => `<button type="button" class="slot" data-time="${s.time}" aria-pressed="false">${s.time}</button>`).join('')}</div>`;
        slotsEl.querySelectorAll('.slot').forEach((b) => b.addEventListener('click', () => {
          slotsEl.querySelectorAll('.slot').forEach((x) => { x.classList.remove('selected'); x.setAttribute('aria-pressed', 'false'); });
          b.classList.add('selected'); b.setAttribute('aria-pressed', 'true'); chosen = b.dataset.time; okBtn.disabled = false;
        }));
      } catch (err) { slotsEl.innerHTML = `<p class="error-text">${esc(err.message)}</p>`; }
    }
    daySel.addEventListener('change', loadSlots); proSel.addEventListener('change', loadSlots);
    okBtn.addEventListener('click', async () => {
      okBtn.disabled = true;
      try {
        await BE.api(`/api/cliente/agendamentos/${a.id}/reagendar`, { method: 'POST', body: { date: daySel.value, time: chosen, professional: proSel.value } });
        close(); BE.toast('Horário remarcado.'); load();
      } catch (err) { box.querySelector('.form-err').innerHTML = `<p class="error-text">${esc(err.message)}</p>`; if (err.status === 409) loadSlots(); else okBtn.disabled = false; }
    });
    proSel.focus();
    loadSlots();
  }

  async function pay(a, btn) {
    btn.disabled = true;
    try { const r = await BE.api(`/api/cliente/agendamentos/${a.id}/pagar`, { method: 'POST' }); location.href = r.url; } catch (err) { BE.toast(err.message); btn.disabled = false; }
  }

  load();
})();
