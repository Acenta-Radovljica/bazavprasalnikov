// Naloge ("Danes") — ruta /api/naloge in prva stran admina.
//
// Zakaj svoj nabor: prva stran je od prenove 27. 8. 2026 seznam DELA, ne
// porocilo. Ce se naloga ne pojavi v pravem vedru ali gumb ne vodi nikamor,
// je stran neuporabna, pa bi bila navidez v redu (vse se izrise).
//
// Zagon: node test/reset-testne-baze.mjs && node test/naloge.test.mjs
import puppeteer from 'puppeteer-core';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3399';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const AUTH = 'Basic ' + Buffer.from('test@acenta.si:testgeslo123').toString('base64');

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}
const pocakaj = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pot, opt = {}) {
  const r = await fetch(BASE + pot, {
    ...opt,
    headers: { Authorization: AUTH, 'content-type': 'application/json', ...(opt.headers || {}) },
  });
  const besedilo = await r.text();
  let telo = null;
  try { telo = JSON.parse(besedilo); } catch { telo = besedilo.slice(0, 200); }
  return { status: r.status, telo };
}

console.log('\n=== 1. Zascita in oblika odziva ===');
const brezAuth = await fetch(BASE + '/api/naloge');
t('brez auth je 401', brezAuth.status === 401, brezAuth.status);

const { predloge } = (await api('/api/procesi/predloge')).telo;
const predloga = predloge.find((p) => p.aktivna);
t('aktivna procesna predloga obstaja', !!predloga);

const prazno = await api('/api/naloge');
t('z auth je 200', prazno.status === 200, prazno.status);
t('vsa tri vedra so v odzivu',
   ['ukrepaj', 'caka', 'zakljuceno'].every((k) => Array.isArray(prazno.telo[k])),
   JSON.stringify(Object.keys(prazno.telo)));
t('skupno so stevila', typeof prazno.telo.skupno?.ukrepaj === 'number', JSON.stringify(prazno.telo.skupno));

console.log('\n=== 2. Seja brez transkripta pride v "Ukrepaj" ===');
const nova = await api('/api/procesi/seje', {
  method: 'POST',
  body: JSON.stringify({
    questionnaire_id: predloga.id,
    stranka_naziv: 'Naloge Test Hotel',
    proces: 'rezervacije',
    datum_sestanka: '2026-08-27',
  }),
});
t('seja ustvarjena', nova.status === 201, nova.status);
const sid = nova.telo.seja.id;

const poNovi = await api('/api/naloge');
const brezT = poNovi.telo.ukrepaj.find((n) => n.session_id === sid);
t('sveza seja je v "Ukrepaj"', !!brezT, JSON.stringify(poNovi.telo.skupno));
t('tip je brez_transkripta', brezT?.tip === 'brez_transkripta', brezT?.tip);
t('naloga nosi ime stranke', brezT?.stranka_naziv === 'Naloge Test Hotel', brezT?.stranka_naziv);
t('naloga nosi napredek', typeof brezT?.napredek?.odstotek === 'number', JSON.stringify(brezT?.napredek));
t('naloge NI v vedru "caka"', !poNovi.telo.caka.some((n) => n.session_id === sid));

console.log('\n=== 3. Transkript prestavi nalogo naprej ===');
await api(`/api/procesi/seje/${sid}/transkript`, {
  method: 'POST',
  body: JSON.stringify({ besedilo: 'Govorec 1: Vse se vodi rocno.' }),
});
const poTranskriptu = await api('/api/naloge');
const zdaj = poTranskriptu.telo.ukrepaj.find((n) => n.session_id === sid);
t('po transkriptu ni vec brez_transkripta', zdaj?.tip !== 'brez_transkripta', zdaj?.tip);
t('seja je zdaj "za_zakljucit"', zdaj?.tip === 'za_zakljucit', zdaj?.tip);

console.log('\n=== 4. Zakljucena seja caka posiljanje ===');
const zakljucek = await api(`/api/procesi/seje/${sid}/zakljuci`, {
  method: 'POST', body: JSON.stringify({ vsiljeno: true }),
});
t('seja zakljucena', zakljucek.status === 200, zakljucek.status);
const poZakljucku = await api('/api/naloge');
const zaPoslati = poZakljucku.telo.ukrepaj.find((n) => n.session_id === sid);
t('zakljucena seja je "za_poslati"', zaPoslati?.tip === 'za_poslati', zaPoslati?.tip);
t('za_poslati ve, da je transkript tam', zaPoslati?.ima_transkript === true, JSON.stringify(zaPoslati?.ima_transkript));

console.log('\n=== 5. Arhiv ne sme v naloge ===');
await api(`/api/procesi/seje/${sid}`, { method: 'PATCH', body: JSON.stringify({ status: 'arhiv' }) });
const poArhivu = await api('/api/naloge');
t('arhivirana seja izpade iz vseh veder',
   !['ukrepaj', 'caka', 'zakljuceno'].some((k) => poArhivu.telo[k].some((n) => n.session_id === sid)),
   JSON.stringify(poArhivu.telo.skupno));

console.log('\n=== 6. Stran "Danes" ===');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });

const napake = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const url = (m.location && m.location().url) || '';
  if ((url + m.text()).includes('favicon')) return;
  napake.push(m.text());
});
page.on('pageerror', (e) => napake.push('pageerror: ' + e.message));

// Za stran rabimo vsaj eno nalogo, zato seja brez transkripta.
const zaStran = await api('/api/procesi/seje', {
  method: 'POST',
  body: JSON.stringify({ questionnaire_id: predloga.id, stranka_naziv: 'Danes UI Hotel', datum_sestanka: '2026-08-27' }),
});
const uiSid = zaStran.telo.seja.id;

await page.goto(BASE + '/admin/', { waitUntil: 'networkidle0' });
await pocakaj(1200);

t('naslov strani je Danes', (await page.$eval('h1', (e) => e.textContent.trim())) === 'Danes',
   await page.$eval('h1', (e) => e.textContent.trim()));
t('trak s stevilkami je napolnjen',
   (await page.$eval('#s-podjetja', (e) => e.textContent)).trim() !== '—',
   await page.$eval('#s-podjetja', (e) => e.textContent));
// Naslovna vrstica: ena velika stevilka mora ustrezati vedru "Ukrepaj",
// sklon pa slovenski dvojini (2 nalogi, ne "2 nalog").
const hero = await page.evaluate(() => ({
  num: document.getElementById('h-num').textContent.trim(),
  naslov: document.getElementById('h-naslov').textContent.trim(),
  caka: document.getElementById('h-caka').textContent.trim(),
  zakljuceno: document.getElementById('h-zakljuceno').textContent.trim(),
  velikost: parseFloat(getComputedStyle(document.getElementById('h-num')).fontSize),
}));
const stanje = (await api('/api/naloge')).telo;
t('velika stevilka ustreza vedru Ukrepaj', hero.num === String(stanje.skupno.ukrepaj),
   `${hero.num} vs ${stanje.skupno.ukrepaj}`);
t('naslovna stevilka je res velika', hero.velikost >= 36, hero.velikost);
const pricakovanSklon = { 1: 'naloga je', 2: 'nalogi sta', 3: 'naloge so', 4: 'naloge so' }[stanje.skupno.ukrepaj % 100] ?? 'nalog je';
t('sklon ustreza stevilu', stanje.skupno.ukrepaj === 0 ? hero.naslov === 'Nič ni na tebi' : hero.naslov.startsWith(pricakovanSklon),
   `"${hero.naslov}" za ${stanje.skupno.ukrepaj}`);
t('stranska stevca sta izpolnjena',
   hero.caka === String(stanje.skupno.caka) && hero.zakljuceno === String(stanje.skupno.zakljuceno),
   `${hero.caka}/${hero.zakljuceno} vs ${stanje.skupno.caka}/${stanje.skupno.zakljuceno}`);

const vrsticUkrepaj = await page.$$eval('#v-ukrepaj .naloga', (e) => e.length);
t('vedro "Ukrepaj" ima naloge', vrsticUkrepaj >= 1, vrsticUkrepaj);
t('naloga za novo sejo je vidna',
   (await page.$eval('#v-ukrepaj', (e) => e.textContent)).includes('Danes UI Hotel'));
t('stevec v glavi vedra ni pomisljaj',
   (await page.$eval('#c-ukrepaj', (e) => e.textContent)).trim() !== '—',
   await page.$eval('#c-ukrepaj', (e) => e.textContent));
t('znacka v navigaciji pokaze stevilo',
   await page.$eval('#nav-ukrepaj', (e) => !e.hidden && e.textContent.trim().length > 0),
   await page.$eval('#nav-ukrepaj', (e) => `hidden=${e.hidden} "${e.textContent}"`));

// Nobena povezava v vedrih ne sme biti mrtva: vsak href mora kazati na
// obstojeco admin stran (200), ne na "#" ali prazno.
const povezave = await page.$$eval('#v-ukrepaj a, #v-caka a, #v-zakljuceno a', (as) => as.map((a) => a.getAttribute('href')));
t('vsaka naloga ima pravo povezavo',
   povezave.length > 0 && povezave.every((h) => h && h !== '#' && h.startsWith('/admin/')),
   JSON.stringify(povezave));
const preverjene = [];
for (const h of [...new Set(povezave)]) {
  const cista = h.split('#')[0];
  const r = await fetch(BASE + cista, { headers: { Authorization: AUTH } });
  preverjene.push(`${cista}=${r.status}`);
}
t('vse ciljne strani obstajajo', preverjene.every((p) => p.endsWith('=200')), JSON.stringify(preverjene));

// Statistika: gumb mora dejansko odpreti panel in narisati graf.
t('statistika je privzeto skrita', await page.$eval('#statistika', (e) => e.className.includes('hidden')));
await page.click('#btn-statistika');
await pocakaj(700);
t('gumb odpre statistiko', !(await page.$eval('#statistika', (e) => e.className.includes('hidden'))));
t('graf je narisan', !!(await page.$('#timeline-chart svg')));
t('gumb se preimenuje', (await page.$eval('#btn-statistika', (e) => e.textContent)).includes('Skrij'),
   await page.$eval('#btn-statistika', (e) => e.textContent));
await page.click('#btn-statistika');
await pocakaj(300);
t('drugi klik zapre statistiko', await page.$eval('#statistika', (e) => e.className.includes('hidden')));

// "+ Nov sestanek" na Danes mora na Procesih odpreti obrazec, ne samo skociti.
await page.goto(BASE + '/admin/procesi.html#nov', { waitUntil: 'networkidle0' });
await pocakaj(900);
t('#nov odpre obrazec za nov sestanek',
   !(await page.$eval('#novaSeja', (e) => e.className.includes('hidden'))));

// Shranjeni pogledi na Procesih so pravi filtri, ne okras.
const stVseh = await page.$$eval('#seje tbody tr[data-odpri]', (r) => r.length);
await page.click('#pogledi [data-pogled="transkript"]');
await pocakaj(400);
const stBrezT = await page.$$eval('#seje tbody tr[data-odpri]', (r) => r.length);
t('pogled "Brez transkripta" zozi seznam', stBrezT <= stVseh && stBrezT >= 1, `${stBrezT} od ${stVseh}`);
t('pogled nastavi filter transkripta', (await page.$eval('#fTranskript', (e) => e.value)) === 'ne');
t('aktiven zavihek je oznacen', !!(await page.$('#pogledi .tab.active[data-pogled="transkript"]')));

t('brez JS napak', napake.length === 0, JSON.stringify(napake.slice(0, 2)));

// Pospravi testni seji.
await api(`/api/procesi/seje/${uiSid}`, { method: 'PATCH', body: JSON.stringify({ status: 'arhiv' }) });

await browser.close();
console.log('\n──────────────────────────────────────────────');
console.log(`OK: ${ok}   FAIL: ${fail}`);
if (padli.length) { console.log('Padli:'); padli.forEach((p) => console.log('  - ' + p)); }
process.exit(fail ? 1 : 0);
