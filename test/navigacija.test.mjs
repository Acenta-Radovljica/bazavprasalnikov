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
const POSTAVKE = ['Danes', 'Procesi', 'Podjetja', 'Vprašalniki', 'Primerjava', 'Iskanje', 'Cross-client'];
const KLJUCI   = ['pregled', 'procesi', 'podjetja', 'questionnaires', 'analiza', 'search', 'insights'];

const STRANI = [
  ['Danes',        '/admin/index.html',          'pregled'],
  ['Podjetja',     '/admin/podjetja.html',       'podjetja'],
  ['Kanban',       '/admin/kanban.html',         'podjetja'],
  ['Procesi',      '/admin/procesi.html',        'procesi'],
  ['Vprašalniki',  '/admin/questionnaires.html', 'questionnaires'],
  ['Primerjava',   '/admin/analiza.html',        'analiza'],
  ['Iskanje',      '/admin/search.html',         'search'],
  ['Cross-client', '/admin/insights.html',       'insights'],
];

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
    const postavke = aside ? [...aside.querySelectorAll('nav a.sidebar-item')].map(imePostavke) : [];
    const aktivne = aside ? [...aside.querySelectorAll('nav a.active')].map(imePostavke) : [];
    return {
      imaSidebar: !!aside,
      postavke,
      aktivne,
      staraVrhnjaVrstica: !!document.getElementById('nav'),
      preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      imaCss: !!document.querySelector('link[href="/admin/admin.css"]'),
    };
  });

  t('stranska vrstica je izrisana', izvid.imaSidebar);
  t('vseh 7 postavk', izvid.postavke.length === 7, JSON.stringify(izvid.postavke));
  t('postavke so prave', JSON.stringify(izvid.postavke) === JSON.stringify(POSTAVKE),
     JSON.stringify(izvid.postavke));
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
