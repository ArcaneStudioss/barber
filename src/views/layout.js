'use strict';
const db = require('../db');
const config = require('../config');
const settings = require('../lib/settings');
const time = require('../lib/time');
const fmt = require('../lib/format');
const { esc } = require('../lib/security');

const ASSET_VERSION = require('../../package.json').version + '-' + Date.now().toString(36);

const icon = {
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm0 18.13c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.36c0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.55-3.7 8.22-8.24 8.22zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
};

function logoSvg() {
  return '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><clipPath id="lp"><rect x="25" y="13" width="14" height="38" rx="7"/></clipPath></defs><circle cx="32" cy="32" r="30" fill="#121110"/><circle cx="32" cy="32" r="28.5" fill="none" stroke="#c9a35e" stroke-width="1.5"/><circle cx="32" cy="32" r="25" fill="none" stroke="#c9a35e" stroke-width=".6" opacity=".6"/><g clip-path="url(#lp)"><rect x="25" y="13" width="14" height="38" fill="#fff"/><g fill="#c9a35e"><path d="M10 30 40 0h6L16 30z"/><path d="M10 48 46 12v6L10 54z"/><path d="M10 66 46 30v6L10 72z"/></g><g fill="#121110"><path d="M10 39 46 3v5L10 44z"/><path d="M10 57 46 21v5L10 62z"/></g></g><rect x="25" y="13" width="14" height="38" rx="7" fill="none" stroke="#c9a35e" stroke-width="1.5"/><rect x="22" y="9" width="20" height="4" rx="2" fill="#c9a35e"/><rect x="22" y="51" width="20" height="4" rx="2" fill="#c9a35e"/></svg>';
}

// Texto real ou marcador visível de campo a preencher
function field(value, placeholderLabel) {
  if (!value || settings.isPlaceholder(value)) {
    return `<span class="placeholder">${esc(value && settings.isPlaceholder(value) ? value : `[${placeholderLabel}]`)}</span>`;
  }
  return esc(value);
}

function photo(img, cls = '') {
  if (img && img.src) {
    return `<img class="photo ${cls}" src="${esc(img.src)}" alt="${esc(img.alt || '')}" loading="lazy" decoding="async" width="${img.width || 1200}" height="${img.height || 1200}">`;
  }
  return `<div class="photo-slot ${cls}" role="img" aria-label="Espaço reservado para foto"><span>${esc((img && img.label) || 'Foto a substituir')}</span></div>`;
}

function businessHours() {
  return db.get().prepare('SELECT * FROM business_hours ORDER BY weekday').all();
}

function hoursTable(dark = false) {
  const rows = businessHours();
  const today = time.weekdayOf(time.todayLocal());
  const order = [1, 2, 3, 4, 5, 6, 0];
  return `<table class="hours ${dark ? 'dark-table' : ''}"><caption class="sr-only">Horário de funcionamento</caption><tbody>${order.map((d) => {
    const r = rows.find((x) => x.weekday === d);
    const val = !r || r.closed ? 'Fechado' : `${time.minutesToHHMM(r.open_min)} às ${time.minutesToHHMM(r.close_min)}`;
    return `<tr class="${d === today ? 'today' : ''}"><th scope="row">${time.WEEKDAY_NAMES[d]}</th><td>${val}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function address(biz) {
  return `${field(biz.street, 'RUA E NÚMERO')}, ${field(biz.neighborhood, 'BAIRRO')}<br>${field(biz.city, 'CIDADE')} - ${field(biz.state, 'UF')}, ${field(biz.postalCode, 'CEP')}`;
}

function structuredData(biz) {
  const real = (v) => v && !settings.isPlaceholder(v);
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const data = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    '@id': `${config.baseUrl}/#barbearia`,
    name: biz.name,
    url: `${config.baseUrl}/`,
    image: `${config.baseUrl}/img/icon-512.png`,
    logo: `${config.baseUrl}/img/icon-512.png`,
    priceRange: biz.priceRange || '$$',
    currenciesAccepted: 'BRL',
    openingHoursSpecification: businessHours().filter((h) => !h.closed).map((h) => ({
      '@type': 'OpeningHoursSpecification', dayOfWeek: DAYS[h.weekday], opens: time.minutesToHHMM(h.open_min), closes: time.minutesToHHMM(h.close_min),
    })),
  };
  if (real(biz.description)) data.description = biz.description;
  if (biz.phone) data.telephone = `+${biz.phone}`;
  if (biz.email) data.email = biz.email;
  if ([biz.street, biz.city].every(real)) {
    data.address = { '@type': 'PostalAddress', streetAddress: biz.street, addressLocality: biz.city, addressCountry: 'BR' };
    if (real(biz.state)) data.address.addressRegion = biz.state;
    if (real(biz.postalCode)) data.address.postalCode = biz.postalCode;
  }
  if (biz.latitude && biz.longitude) data.geo = { '@type': 'GeoCoordinates', latitude: Number(biz.latitude), longitude: Number(biz.longitude) };
  const same = [];
  if (biz.instagram) same.push(`https://www.instagram.com/${biz.instagram}/`);
  if (same.length) data.sameAs = same;
  data.potentialAction = { '@type': 'ReserveAction', target: { '@type': 'EntryPoint', urlTemplate: `${config.baseUrl}/agendar` }, result: { '@type': 'Reservation', name: 'Agendar horário' } };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const NAV = [
  ['/', 'Início'], ['/servicos', 'Serviços'], ['/equipe', 'Equipe'], ['/sobre', 'Sobre'], ['/galeria', 'Galeria'], ['/contato', 'Contato'], ['/cliente', 'Meus agendamentos'],
];

function layout({ title, description, path = '/', body, nonce, noindex = false, extraHead = '', scripts = [], hideBookBar = false, jsonLd = '' }) {
  const biz = settings.section('business');
  const fullTitle = path === '/' ? `${biz.name} | Barbearia em ${settings.isPlaceholder(biz.city) ? 'sua cidade' : biz.city}` : `${title} | ${biz.name}`;
  const canonical = `${config.baseUrl}${path}`;
  const wa = biz.whatsapp ? fmt.waLink(biz.whatsapp, `Olá! Vim pelo site da ${biz.name}.`) : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
<meta name="theme-color" content="#121110">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="${esc(biz.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(config.baseUrl)}/img/icon-512.png">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="preload" href="/fonts/bodoni-moda-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/archivo-latin-wdth-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css?v=${ASSET_VERSION}">
${extraHead}
<script nonce="${nonce}">document.documentElement.classList.add('js')</script>
${path === '/' ? `<script type="application/ld+json" nonce="${nonce}">${structuredData(biz)}</script>` : ''}
${jsonLd ? `<script type="application/ld+json" nonce="${nonce}">${jsonLd}</script>` : ''}
</head>
<body>
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/" aria-label="${esc(biz.name)}, página inicial">${logoSvg()}<span class="brand-name">${esc(biz.name)}<small>${settings.isPlaceholder(biz.neighborhood) ? 'Barbearia' : esc(biz.neighborhood)}</small></span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="menu"><span class="bars" aria-hidden="true"></span>Menu</button>
    <nav class="site-nav" id="menu" aria-label="Principal">
      <ul>
        ${NAV.map(([href, label]) => `<li><a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')}
        <li class="nav-cta"><a class="btn btn-primary" href="/agendar">Agendar horário</a></li>
      </ul>
    </nav>
  </div>
</header>
<main id="conteudo">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <a class="brand" href="/">${logoSvg()}<span class="brand-name">${esc(biz.name)}</span></a>
        <p style="margin-top:16px">${esc(settings.isPlaceholder(biz.tagline) ? '' : biz.tagline)}</p>
      </div>
      <div>
        <h2>Visite</h2>
        <p>${address(biz)}</p>
      </div>
      <div>
        <h2>Fale com a gente</h2>
        <ul>
          ${biz.whatsapp ? `<li><a href="${esc(wa)}" rel="noopener" target="_blank">WhatsApp ${esc(fmt.phoneDisplay(biz.whatsapp))}</a></li>` : '<li><span class="placeholder">[WHATSAPP]</span></li>'}
          ${biz.phone ? `<li><a href="tel:+${esc(biz.phone)}">Telefone ${esc(fmt.phoneDisplay(biz.phone))}</a></li>` : ''}
          ${biz.instagram ? `<li><a href="https://www.instagram.com/${esc(biz.instagram)}/" rel="noopener" target="_blank">Instagram @${esc(biz.instagram)}</a></li>` : '<li><span class="placeholder">[INSTAGRAM]</span></li>'}
          ${biz.email ? `<li><a href="mailto:${esc(biz.email)}">${esc(biz.email)}</a></li>` : ''}
        </ul>
      </div>
      <div>
        <h2>Agenda</h2>
        <ul>
          <li><a href="/agendar">Agendar horário</a></li>
          <li><a href="/cliente">Meus agendamentos</a></li>
          <li><a href="/privacidade">Política de privacidade</a></li>
          <li><a href="/termos">Termos de uso</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-base">
      <span>© ${new Date().getFullYear()} ${esc(biz.legalName || biz.name)}${biz.cnpj ? `, CNPJ ${esc(biz.cnpj)}` : ''}</span>
      <a href="/privacidade#seus-direitos">Pedir acesso ou exclusão dos meus dados</a>
    </div>
  </div>
</footer>
${hideBookBar ? '' : '<div class="book-bar"><a class="btn btn-primary" href="/agendar">Agendar horário</a></div>'}
${wa ? `<a class="wa-float" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Conversar pelo WhatsApp">${icon.whatsapp}<span class="wa-text">WhatsApp</span></a>` : ''}
<script src="/js/site.js?v=${ASSET_VERSION}" defer></script>
${scripts.map((s) => `<script src="${s}?v=${ASSET_VERSION}" defer></script>`).join('\n')}
</body>
</html>`;
}

module.exports = { layout, field, photo, hoursTable, address, icon, logoSvg, ASSET_VERSION, businessHours };
