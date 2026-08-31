// Preveri, da ima VSAKA admin stran enotno navigacijo in da se nalozi brez
// napak. Nastalo, ker sta v aplikaciji obstajala dva navigacijska sistema
// (stranska vrstica na Pregledu, temna vrhnja vrstica na ostalih) z razlicnima
// seznamoma postavk — Procesov v stranski vrstici sploh ni bilo.
import puppeteer from 'puppeteer-core';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3399';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

// Pricakovane postavke — ista resnica kot NAV_POSTAVKE v public/admin/app.js.
// Prenova 27. 8. 2026: "Pregled" se imenuje "Danes" (prva stran je seznam
// dela, ne porocilo) in Procesi so pred Podjetji, ker so glavno delo.
// Isti dan dodana "Primerjava" (cross-analiza procesnih vprasalnikov, FAZA 1)
// kot prva postavka skupine Analiza.
// 31. 8. 2026: tehnicni strani (Vprasalniki, Vpogledi — prej "Cross-client")
// preseljeni v zlozeno skupino "Napredno" na dnu; komercialist vidi samo 5
// postavk, ki jih zares uporablja.
const GLAVNE   = ['Danes', 'Procesi', 'Podjetja', 'Primerjava', 'Iskanje'];
const NAPREDNE = ['Vprašalniki', 'Vpogledi'];
const POSTAVKE = [...GLAVNE, ...NAPREDNE];
const KLJUCI   = ['pregled', 'procesi', 'podjetja', 'analiza', 'search', 'questionnaires', 'insights'];
const V_NAPREDNEM = new Set(['questionnaires', 'insights']);

const STRANI = [
  ['Danes',        '/admin/index.html',          'pregled'],
  ['Podjetja',     '/admin/podjetja.html',       'podjetja'],
  ['Kanban',       '/admin/kanban.html',         'podjetja'],
  ['Procesi',      '/admin/procesi.html',        'procesi'],
  ['Urejanje predloge', '/admin/predloga.html?id=1', 'procesi'],
  ['Vprašalniki',  '/admin/questionnaires.html', 'questionnaires'],
  ['Primerjava',   '/admin/analiza.html',        'analiza'],
  ['Iskanje',      '/admin/search.html',         'search'],
  ['Vpogledi',     '/admin/insights.html',       'insights'],
];

// Prava predloga za stran "Urejanje predloge" (id po resetu ni nujno 1).
const AUTH = 'Basic ' + Buffer.from('test@acenta.si:testgeslo123').toString('base64');
const predlogeRes = await fetch(BASE + '/api/procesi/predloge', { headers: { Authorization: AUTH } });
const predlogaId = (await predlogeRes.json()).predloge?.[0]?.id;
STRANI.find(s => s[0] === 'Urejanje predloge')[1] = `/admin/predloga.html?id=${predlogaId}`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox'],
});

for (const [ime, pot, aktivenKljuc] of STRANI) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });

  const napake = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const url = (m.location && m.location().url) || '';
    if ((url + m.text()).includes('favicon')) return;   // obstojeca lastnost vseh strani
    napake.push(m.text());
  });
  page.on('pageerror', e => napake.push('pageerror: ' + e.message));

  console.log(`\n=== ${ime} (${pot}) ===`);
  await page.goto(BASE + pot, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1100));

  const izvid = await page.evaluate(() => {
    const aside = document.getElementById('sidebar');
    // Samo glavne postavke (.sidebar-item). Podseznam podjetij pod "Podjetja"
    // so tudi povezave v <nav>, zato je "nav a" prestevalo se stranke; in
    // oznaka postavke je prvi <span>, ker anchor vsebuje tudi stevec nalog.
    const imePostavke = (a) => (a.querySelector('span')?.textContent ?? a.textContent).trim();
    const vse = aside ? [...aside.querySelectorAll('nav a.sidebar-item')] : [];
    const glavne = vse.filter(a => !a.closest('#naprednoSeznam')).map(imePostavke);
    const napredne = vse.filter(a => a.closest('#naprednoSeznam')).map(imePostavke);
    const postavke = [...glavne, ...napredne];
    const seznamNapredno = document.getElementById('naprednoSeznam');
    const aktivne = aside ? [...aside.querySelectorAll('nav a.active')].map(imePostavke) : [];
    return {
      imaSidebar: !!aside,
      postavke,
      glavne,
      napredne,
      aktivne,
      imaNaprednoToggle: !!document.getElementById('naprednoToggle'),
      naprednoOdprto: !!seznamNapredno && !seznamNapredno.hidden,
      staraVrhnjaVrstica: !!document.getElementById('nav'),
      preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      imaCss: !!document.querySelector('link[href="/admin/admin.css"]'),
    };
  });

  t('stranska vrstica je izrisana', izvid.imaSidebar);
  t('5 glavnih postavk', JSON.stringify(izvid.glavne) === JSON.stringify(GLAVNE),
     JSON.stringify(izvid.glavne));
  t('Napredno preklop obstaja', izvid.imaNaprednoToggle);
  t('napredni postavki sta pravi', JSON.stringify(izvid.napredne) === JSON.stringify(NAPREDNE),
     JSON.stringify(izvid.napredne));
  // Skupina je privzeto zaprta; odprta je SAMO, kadar je aktivna stran v njej
  // (aktivna postavka ne sme biti skrita). Svez brskalnik = brez localStorage.
  t('Napredno odprto natanko takrat, ko je aktivna stran v njem',
     izvid.naprednoOdprto === V_NAPREDNEM.has(aktivenKljuc),
     `odprto=${izvid.naprednoOdprto}`);
  t('Procesi so v navigaciji', izvid.postavke.includes('Procesi'));
  t('natanko ena aktivna postavka', izvid.aktivne.length === 1, JSON.stringify(izvid.aktivne));
  t('aktivna je prava stran',
     izvid.aktivne[0] === POSTAVKE[KLJUCI.indexOf(aktivenKljuc)],
     `aktivna="${izvid.aktivne[0]}" pricakovano za "${aktivenKljuc}"`);
  t('stara vrhnja vrstica odstranjena', !izvid.staraVrhnjaVrstica);
  t('skupni stili nalozeni', izvid.imaCss);
  t('brez vodoravnega prelivanja', izvid.preliv <= 1, `${izvid.preliv}px`);
  t('brez JS napak', napake.length === 0, JSON.stringify(napake.slice(0, 2)));

  // Ozek zaslon: stranska vrstica se skrije, nadomesti jo drsna vrstica.
  await page.setViewport({ width: 390, height: 844 });
  await new Promise(r => setTimeout(r, 500));
  const mob = await page.evaluate(() => ({
    preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dostopnaNavigacija: [...document.querySelectorAll('a')]
      .some(a => a.offsetParent !== null && a.textContent.trim() === 'Procesi'),
  }));
  t('mobilno brez prelivanja strani', mob.preliv <= 1, `${mob.preliv}px`);
  t('mobilno: navigacija dosegljiva', mob.dostopnaNavigacija);

  await page.close();
}

await browser.close();
console.log(`\n${'─'.repeat(46)}\nOK: ${ok}   FAIL: ${fail}`);
if (padli.length) console.log('Padli:\n  - ' + [...new Set(padli)].join('\n  - '));
console.log('');
process.exit(fail ? 1 : 0);
