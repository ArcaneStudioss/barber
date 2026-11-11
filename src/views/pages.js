'use strict';
const db = require('../db');
const config = require('../config');
const settings = require('../lib/settings');
const fmt = require('../lib/format');
const content = require('../content');
const { esc } = require('../lib/security');
const { layout, field, photo, hoursTable, address, icon } = require('./layout');

function services({ featuredOnly = false } = {}) {
  return db.get().prepare(`SELECT * FROM services WHERE active = 1 ${featuredOnly ? 'AND featured = 1' : ''} ORDER BY sort, name`).all();
}
function team() {
  const conn = db.get();
  const pros = conn.prepare('SELECT * FROM professionals WHERE active = 1 ORDER BY sort, name').all();
  for (const p of pros) {
    p.serviceNames = conn.prepare('SELECT s.name FROM professional_services ps JOIN services s ON s.id = ps.service_id WHERE ps.professional_id = ? AND s.active = 1 ORDER BY s.sort').all(p.id).map((r) => r.name);
  }
  return pros;
}

function demoNotice(list) {
  return list.some((x) => x.is_demo)
    ? '<p class="notice small" style="margin-bottom:28px">Dados de demonstração: serviços, preços e equipe abaixo são fictícios e devem ser trocados pelos reais no painel.</p>'
    : '';
}

function priceBoard(list, { dark = false, cols = false, withButton = false } = {}) {
  if (!list.length) return '<p class="muted">Os serviços aparecem aqui assim que forem cadastrados no painel.</p>';
  return `<ul class="price-board ${dark ? 'dark' : ''} ${cols ? 'cols' : ''}">${list.map((s) => `
    <li class="price-row">
      <div class="price-line"><span class="name">${esc(s.name)}</span><span class="dots" aria-hidden="true"></span><span class="price">${fmt.money(s.price_cents)}</span></div>
      <div class="price-meta"><span class="dur">${fmt.duration(s.duration_min)}</span>${s.description ? `<p>${esc(s.description)}</p>` : ''}</div>
      ${withButton ? `<a class="btn btn-ghost btn-sm" href="/agendar?servico=${s.id}" aria-label="Agendar ${esc(s.name)}">Agendar</a>` : ''}
    </li>`).join('')}</ul>`;
}

function teamGrid(pros, { short = false } = {}) {
  if (!pros.length) return '<p class="muted">A equipe aparece aqui assim que for cadastrada no painel.</p>';
  return `<div class="team">${pros.map((p) => `
    <article class="member">
      ${photo(p.photo ? { src: p.photo, alt: `Foto de ${p.name}`, width: 900, height: 1200 } : { label: `Foto de ${p.name} (vertical, 900×1200)` })}
      <div>
        <h3>${esc(p.name)}</h3>
        ${p.role_title ? `<div class="role">${esc(p.role_title)}</div>` : ''}
        ${!short && p.bio ? `<p style="margin-top:10px">${esc(p.bio)}</p>` : ''}
        ${p.specialties ? `<ul class="specialties" aria-label="Especialidades">${p.specialties.split(',').map((x) => x.trim()).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${!short && p.online_booking ? `<p style="margin-top:16px"><a class="link" href="/agendar?profissional=${p.id}">Agendar com ${esc(p.name.split(' ')[0])}</a></p>` : ''}
      </div>
    </article>`).join('')}</div>`;
}

function galleryGrid(items) {
  return `<div class="gallery">${items.map((g) => `<figure>${photo(g)}${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`;
}

function mapBlock(biz) {
  if (biz.mapEmbedUrl) {
    return `<iframe class="map-frame" src="${esc(biz.mapEmbedUrl)}" title="Mapa com a localização da ${esc(biz.name)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
  }
  return '<div class="photo-slot map-frame" role="img" aria-label="Espaço reservado para o mapa"><span>Mapa: cole o link de incorporação do Google Maps em Painel > Configurações > Dados da barbearia</span></div>';
}

function contactList(biz) {
  const wa = biz.whatsapp ? fmt.waLink(biz.whatsapp, `Olá! Vim pelo site da ${biz.name}.`) : '';
  return `<ul class="contact-list">
    <li><span class="label">WhatsApp</span>${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">${esc(fmt.phoneDisplay(biz.whatsapp))}</a>` : '<span class="placeholder">[WHATSAPP]</span>'}</li>
    <li><span class="label">Telefone</span>${biz.phone ? `<a href="tel:+${esc(biz.phone)}">${esc(fmt.phoneDisplay(biz.phone))}</a>` : '<span class="placeholder">[TELEFONE]</span>'}</li>
    <li><span class="label">Instagram</span>${biz.instagram ? `<a href="https://www.instagram.com/${esc(biz.instagram)}/" target="_blank" rel="noopener">@${esc(biz.instagram)}</a>` : '<span class="placeholder">[INSTAGRAM]</span>'}</li>
    ${biz.email ? `<li><span class="label">E-mail</span><a href="mailto:${esc(biz.email)}">${esc(biz.email)}</a></li>` : ''}
    <li><span class="label">Endereço</span>${address(biz)}${biz.mapLinkUrl ? `<br><a class="link" href="${esc(biz.mapLinkUrl)}" target="_blank" rel="noopener">Abrir no mapa</a>` : ''}</li>
  </ul>`;
}

function cityName(biz) { return settings.isPlaceholder(biz.city) ? '' : biz.city; }

// ---------------- páginas ----------------

function home(nonce) {
  const biz = settings.section('business');
  const featured = services({ featuredOnly: true });
  const list = featured.length ? featured : services().slice(0, 6);
  const pros = team();
  const city = cityName(biz);
  const nb = settings.isPlaceholder(biz.neighborhood) ? '' : biz.neighborhood;
  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <span class="kicker">Barbearia${nb ? ` no ${esc(nb)}` : ''}${city ? `, ${esc(city)}` : ''}</span>
      <h1>${(() => { const w = biz.name.split(' '); const a = w.length > 1 ? w.slice(0, Math.ceil(w.length / 2)).join(' ') : w[0]; const b = w.length > 1 ? w.slice(Math.ceil(w.length / 2)).join(' ') : ''; return `<span class="line">${esc(a)}</span>${b ? `<span class="line line-2">${esc(b)}</span>` : ''}`; })()}</h1>
      <p class="lead">${esc(biz.tagline)}</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="/agendar">Agendar horário</a>
        <a class="btn btn-ghost" href="/servicos">Ver serviços e preços</a>
      </div>
      <ul class="hero-facts">
        <li>${icon.calendar}<span>Agende online e veja só os horários livres</span></li>
        <li>${icon.pin}<span>${address(biz)}</span></li>
      </ul>
    </div>
    <figure class="hero-figure">
      ${photo(content.hero.image)}
      <div class="pole" aria-hidden="true"></div>
    </figure>
  </div>
</section>

<section class="section light" aria-labelledby="t-servicos">
  <div class="wrap">
    <div class="section-head">
      <h2 id="t-servicos">Os mais pedidos</h2>
      <p>Preço e tempo de cadeira de cada serviço. Dá para combinar mais de um no mesmo horário.</p>
    </div>
    ${demoNotice(list)}
    ${priceBoard(list, { cols: true })}
    <p style="margin-top:32px"><a class="btn btn-dark" href="/servicos">Tabela completa</a></p>
  </div>
</section>

<section class="section" aria-labelledby="t-equipe">
  <div class="wrap">
    <div class="section-head">
      <h2 id="t-equipe">Quem vai te atender</h2>
      <p>Escolha seu barbeiro na hora de agendar ou deixe o sistema achar o primeiro horário livre.</p>
    </div>
    ${demoNotice(pros)}
    ${teamGrid(pros, { short: true })}
  </div>
</section>

<section class="section light chalk" aria-labelledby="t-galeria">
  <div class="wrap">
    <div class="section-head">
      <h2 id="t-galeria">Cortes e ambiente</h2>
      <p><a class="link" href="/galeria">Ver a galeria completa</a></p>
    </div>
    ${galleryGrid(content.gallery.slice(0, 5))}
  </div>
</section>

${content.testimonials.length ? `
<section class="section" aria-labelledby="t-dep">
  <div class="wrap">
    <div class="section-head"><h2 id="t-dep">Quem já sentou na cadeira</h2></div>
    <div class="quotes">${content.testimonials.map((t) => `<figure class="quote"><blockquote>${esc(t.text)}</blockquote><figcaption>${esc(t.author)}${t.source ? `, via ${esc(t.source)}` : ''}</figcaption></figure>`).join('')}</div>
  </div>
</section>` : ''}

<section class="section light" aria-labelledby="t-visita">
  <div class="wrap">
    <div class="section-head"><h2 id="t-visita">Como chegar</h2><p>Horário de funcionamento e contatos.</p></div>
    <div class="visit">
      <div><h3>Horário</h3>${hoursTable()}</div>
      <div><h3>Contato</h3>${contactList(biz)}</div>
      <div>${mapBlock(biz)}</div>
    </div>
  </div>
</section>

<section class="cta-band">
  <div class="wrap">
    <h2>Seu próximo corte já tem horário.</h2>
    <a class="btn btn-primary" href="/agendar">Agendar horário</a>
  </div>
</section>`;
  const desc = `${biz.name}: corte de cabelo, barba e acabamento${city ? ` em ${city}` : ''}. Veja preços, conheça a equipe e agende online.`;
  return layout({ title: 'Início', description: desc, path: '/', body, nonce });
}

function servicesPage(nonce) {
  const biz = settings.section('business');
  const list = services();
  const body = `
<section class="page-head"><div class="wrap"><h1>Serviços e preços</h1><p class="lead">Valores em reais. A duração ajuda a montar o seu horário: se escolher mais de um serviço, o sistema soma o tempo.</p></div></section>
<section class="section light"><div class="wrap">${demoNotice(list)}${priceBoard(list, { withButton: true, cols: true })}</div></section>
<section class="cta-band"><div class="wrap"><h2>Escolheu? Marque seu horário.</h2><a class="btn btn-primary" href="/agendar">Agendar horário</a></div></section>`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'OfferCatalog', name: `Serviços da ${biz.name}`,
    itemListElement: list.map((s) => ({ '@type': 'Offer', price: (s.price_cents / 100).toFixed(2), priceCurrency: 'BRL', itemOffered: { '@type': 'Service', name: s.name, description: s.description || undefined } })),
  }).replace(/</g, '\\u003c');
  return layout({ title: 'Serviços e preços', description: `Tabela de serviços e preços da ${biz.name}: cortes, barba e combos, com duração de cada atendimento.`, path: '/servicos', body, nonce, jsonLd });
}

function teamPage(nonce) {
  const biz = settings.section('business');
  const pros = team();
  const body = `
<section class="page-head"><div class="wrap"><h1>Equipe</h1><p class="lead">Conheça os profissionais e as especialidades de cada um.</p></div></section>
<section class="section"><div class="wrap">${demoNotice(pros)}${teamGrid(pros)}</div></section>`;
  return layout({ title: 'Equipe', description: `Conheça os barbeiros da ${biz.name} e agende com quem você preferir.`, path: '/equipe', body, nonce });
}

function aboutPage(nonce) {
  const biz = settings.section('business');
  const body = `
<section class="page-head"><div class="wrap"><h1>Sobre a ${esc(biz.name)}</h1><p class="lead">${field(biz.description, 'DESCRIÇÃO DA BARBEARIA')}</p></div></section>
<section class="section light"><div class="wrap visit" style="align-items:start">
  <div class="prose" style="grid-column: span 2">${content.about.paragraphs.map((p) => `<p>${field(p, 'TEXTO')}</p>`).join('')}</div>
  <div>${photo(content.about.image)}</div>
</div></section>
<section class="section"><div class="wrap">
  <div class="section-head"><h2>Como funciona aqui</h2></div>
  <div class="quotes">${content.about.values.map((x) => `<div class="quote"><h3>${esc(x.title)}</h3><p class="muted" style="margin:0">${esc(x.text)}</p></div>`).join('')}</div>
</div></section>
<section class="cta-band"><div class="wrap"><h2>Venha conhecer.</h2><a class="btn btn-primary" href="/agendar">Agendar horário</a></div></section>`;
  return layout({ title: 'Sobre', description: `A história e o jeito de trabalhar da ${biz.name}.`, path: '/sobre', body, nonce });
}

function galleryPage(nonce) {
  const biz = settings.section('business');
  const body = `
<section class="page-head"><div class="wrap"><h1>Galeria</h1><p class="lead">Cortes, barbas e o ambiente da barbearia.</p></div></section>
<section class="section"><div class="wrap">${galleryGrid(content.gallery)}</div></section>`;
  return layout({ title: 'Galeria', description: `Fotos de cortes, barbas e do ambiente da ${biz.name}.`, path: '/galeria', body, nonce });
}

function contactPage(nonce) {
  const biz = settings.section('business');
  const body = `
<section class="page-head"><div class="wrap"><h1>Contato</h1><p class="lead">Para marcar, o jeito mais rápido é pelo agendamento online. Para outras dúvidas, chame no WhatsApp.</p></div></section>
<section class="section light"><div class="wrap visit">
  <div><h2 class="sr-only">Contatos</h2>${contactList(biz)}<p style="margin-top:28px"><a class="btn btn-dark" href="/agendar">Agendar horário</a></p></div>
  <div><h3>Horário</h3>${hoursTable()}</div>
  <div>${mapBlock(biz)}</div>
</div></section>`;
  return layout({ title: 'Contato', description: `Endereço, telefone, WhatsApp, Instagram e mapa da ${biz.name}.`, path: '/contato', body, nonce });
}

function bookingPage(nonce) {
  const biz = settings.section('business');
  const body = `
<section class="page-head"><div class="wrap"><h1>Agendar horário</h1><p class="lead">Leva menos de um minuto. Não precisa criar senha.</p></div></section>
<section class="section light booking-section"><div class="wrap">
  <div id="booking-app" class="booking" aria-live="polite">
    <noscript><div class="alert">O agendamento online precisa de JavaScript ativado. Você também pode agendar pelo WhatsApp${biz.whatsapp ? `: <a href="${esc(fmt.waLink(biz.whatsapp, 'Olá! Quero agendar um horário.'))}">${esc(fmt.phoneDisplay(biz.whatsapp))}</a>` : ''}.</div></noscript>
    <p class="muted js-loading">Carregando serviços...</p>
  </div>
</div></section>`;
  return layout({
    title: 'Agendar horário', description: `Agende online seu horário na ${biz.name}: escolha serviços, profissional, dia e hora.`,
    path: '/agendar', body, nonce, hideBookBar: true,
    extraHead: '<link rel="stylesheet" href="/css/agenda.css?v=' + require('./layout').ASSET_VERSION + '">',
    scripts: ['/js/agendar.js'],
  });
}

function clientPage(nonce) {
  const body = `
<section class="page-head"><div class="wrap"><h1>Meus agendamentos</h1><p class="lead">Veja seus horários, cancele ou remarque dentro do prazo e atualize seus dados.</p></div></section>
<section class="section light"><div class="wrap"><div id="client-app" class="client" aria-live="polite">
  <noscript><div class="alert">Esta área precisa de JavaScript ativado.</div></noscript>
  <p class="muted js-loading">Carregando...</p>
</div></div></section>`;
  return layout({
    title: 'Meus agendamentos', description: 'Área do cliente: consulte, cancele ou remarque seus agendamentos.', path: '/cliente', body, nonce, noindex: true, hideBookBar: true,
    extraHead: '<link rel="stylesheet" href="/css/agenda.css?v=' + require('./layout').ASSET_VERSION + '">',
    scripts: ['/js/cliente.js'],
  });
}

function paymentReturnPage(nonce) {
  const body = `
<section class="page-head"><div class="wrap"><h1>Pagamento</h1></div></section>
<section class="section light"><div class="wrap prose">
  <p class="lead" style="color:inherit">Recebemos o seu retorno do Mercado Pago.</p>
  <p>A confirmação do pagamento chega para a barbearia automaticamente em alguns instantes. Quando for aprovada, o agendamento passa para <strong>Confirmado</strong>.</p>
  <p><a class="btn btn-dark" href="/cliente">Ver meus agendamentos</a></p>
</div></section>`;
  return layout({ title: 'Pagamento', description: 'Retorno do pagamento', path: '/agendar/retorno-pagamento', body, nonce, noindex: true });
}

function privacyPage(nonce) {
  const biz = settings.section('business');
  const contact = biz.dpoContact || biz.email;
  const body = `
<section class="page-head"><div class="wrap"><h1>Política de privacidade</h1><p class="lead">Como a ${esc(biz.name)} usa os seus dados, de acordo com a Lei Geral de Proteção de Dados (Lei 13.709/2018).</p></div></section>
<section class="section light"><div class="wrap prose">
  <p class="notice small">Modelo inicial. Revise com o responsável pela barbearia (e, se possível, com um advogado) antes de publicar. Campos destacados precisam ser preenchidos.</p>
  <h2>Quem cuida dos seus dados</h2>
  <p>${field(biz.legalName || '', 'RAZÃO SOCIAL')}${biz.cnpj ? `, CNPJ ${esc(biz.cnpj)}` : ', CNPJ <span class="placeholder">[CNPJ]</span>'}, com endereço em ${address(biz)}. Contato para assuntos de privacidade: ${contact ? `<a class="link" href="mailto:${esc(contact)}">${esc(contact)}</a>` : '<span class="placeholder">[E-MAIL DE CONTATO]</span>'}.</p>
  <h2>Quais dados coletamos e para quê</h2>
  <ul>
    <li><strong>Nome e telefone</strong>: obrigatórios para identificar você, confirmar e lembrar do seu horário e falar com você se houver imprevisto.</li>
    <li><strong>E-mail</strong> (opcional): para enviar confirmação, lembrete e códigos de acesso à área do cliente.</li>
    <li><strong>Histórico de agendamentos</strong>: serviços, datas, profissional, valores e status, para o atendimento, a organização da agenda e obrigações fiscais.</li>
    <li><strong>Dados técnicos</strong> (endereço IP e registros de acesso): para segurança e prevenção de abuso.</li>
  </ul>
  <p>Não coletamos CPF, data de nascimento nem dados de cartão. Quando o pagamento online estiver ativado, ele é feito na página do Mercado Pago, que trata os dados de pagamento conforme a política dele; este site recebe apenas a confirmação e o valor pago.</p>
  <h2>Bases legais</h2>
  <p>Usamos seus dados para executar o serviço que você pediu (o agendamento), cumprir obrigações legais e, no caso de mensagens promocionais, somente com o seu consentimento, que é separado e opcional.</p>
  <h2>Mensagens</h2>
  <p>Mensagens sobre o seu agendamento (confirmação, lembrete, cancelamento) fazem parte do serviço. Novidades e promoções só são enviadas se você marcar essa opção, e você pode desmarcar quando quiser na área do cliente.</p>
  <h2>Com quem compartilhamos</h2>
  <p>Somente com fornecedores necessários para o funcionamento: hospedagem do site, envio de e-mail (Resend), envio de WhatsApp (Meta) e pagamento (Mercado Pago), quando ativados. Não vendemos dados.</p>
  <h2>Por quanto tempo guardamos</h2>
  <p>Enquanto você for cliente e pelo prazo exigido por lei para registros financeiros. Você pode pedir a exclusão a qualquer momento; mantemos apenas o que a lei obriga, sem identificação.</p>
  <h2>Cookies</h2>
  <p>Usamos somente cookies essenciais para manter você conectado à área do cliente e ao painel. Não usamos cookies de publicidade ou rastreamento.</p>
  <h2 id="seus-direitos">Seus direitos</h2>
  <p>Você pode pedir confirmação, acesso, correção, exclusão, portabilidade e revogação de consentimento. Use o formulário abaixo ou fale pelo contato de privacidade. Respondemos em até 15 dias.</p>
  <form id="privacy-form" class="privacy-form" novalidate>
    <div class="field"><label for="pf-name">Seu nome</label><input class="input" id="pf-name" name="name" autocomplete="name" required maxlength="80"></div>
    <div class="field"><label for="pf-contact">Telefone ou e-mail usado no agendamento</label><input class="input" id="pf-contact" name="contact" required maxlength="120"></div>
    <div class="field"><label for="pf-type">O que você precisa</label>
      <select class="input" id="pf-type" name="type"><option value="acesso">Ver quais dados vocês têm</option><option value="correcao">Corrigir meus dados</option><option value="exclusao">Excluir meus dados</option><option value="revogar_marketing">Não receber mais promoções</option><option value="outro">Outro assunto</option></select></div>
    <div class="field"><label for="pf-msg">Detalhes (opcional)</label><textarea class="input" id="pf-msg" name="message" maxlength="1000"></textarea></div>
    <div class="hp" aria-hidden="true"><label>Não preencha <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <div class="form-status" role="status"></div>
    <button class="btn btn-dark" type="submit">Enviar pedido</button>
  </form>
</div></section>`;
  return layout({ title: 'Política de privacidade', description: `Como a ${biz.name} trata seus dados pessoais (LGPD).`, path: '/privacidade', body, nonce });
}

function termsPage(nonce) {
  const biz = settings.section('business');
  const b = settings.section('booking');
  const body = `
<section class="page-head"><div class="wrap"><h1>Termos de uso</h1><p class="lead">Regras do agendamento online da ${esc(biz.name)}.</p></div></section>
<section class="section light"><div class="wrap prose">
  <p class="notice small">Modelo inicial. Revise com o responsável pela barbearia antes de publicar.</p>
  <h2>Agendamento</h2>
  <p>O horário fica reservado assim que você recebe o número do agendamento${settings.section('payments').mode !== 'desligado' ? ' e, quando houver cobrança antecipada, após a confirmação do pagamento' : ''}. Online, é possível agendar com pelo menos ${Math.round(b.minAdvanceMin / 60 * 10) / 10} hora(s) de antecedência e até ${b.maxDaysAhead} dias à frente.</p>
  <h2>Cancelamento e reagendamento</h2>
  <p>${esc(b.policyText)}</p>
  <h2>Atrasos e faltas</h2>
  <p><span class="placeholder">[REGRA DE ATRASO: por exemplo, tolerância de X minutos. Definir com a barbearia.]</span></p>
  <h2>Pagamentos</h2>
  <p>Os preços exibidos estão em reais e podem mudar sem aviso; vale o preço mostrado no momento do agendamento. <span class="placeholder">[REGRA DE REEMBOLSO DO SINAL, se a cobrança online for ativada.]</span></p>
  <h2>Uso do site</h2>
  <p>Não é permitido usar o site para fazer reservas falsas ou automatizadas. Podemos cancelar agendamentos feitos de forma abusiva.</p>
  <h2>Contato</h2>
  <p>Dúvidas: ${contactList(biz)}</p>
</div></section>`;
  return layout({ title: 'Termos de uso', description: `Termos do agendamento online da ${biz.name}.`, path: '/termos', body, nonce });
}

function notFound(nonce) {
  const body = `<section class="page-head"><div class="wrap"><h1>Página não encontrada</h1><p class="lead">O endereço pode ter mudado.</p><p style="margin-top:24px"><a class="btn btn-primary" href="/">Voltar ao início</a></p></div></section>`;
  return layout({ title: 'Página não encontrada', description: 'Página não encontrada', path: '/404', body, nonce, noindex: true });
}

function adminShell(nonce) {
  const { ASSET_VERSION } = require('./layout');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel | ${esc(settings.section('business').name)}</title><meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/admin.css?v=${ASSET_VERSION}">
</head><body><div id="admin-app"><noscript>O painel precisa de JavaScript ativado.</noscript></div>
<script nonce="${nonce}">window.__TZ__=${JSON.stringify(config.timezone)}</script>
<script src="/js/admin.js?v=${ASSET_VERSION}" defer></script></body></html>`;
}

function sitemap() {
  const pages = ['/', '/servicos', '/equipe', '/sobre', '/galeria', '/contato', '/agendar', '/privacidade', '/termos'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${config.baseUrl}${p}</loc><changefreq>${p === '/agendar' ? 'daily' : 'monthly'}</changefreq><priority>${p === '/' ? '1.0' : p === '/agendar' || p === '/servicos' ? '0.9' : '0.6'}</priority></url>`).join('\n')}
</urlset>`;
}

module.exports = { home, servicesPage, teamPage, aboutPage, galleryPage, contactPage, bookingPage, clientPage, paymentReturnPage, privacyPage, termsPage, notFound, adminShell, sitemap };
