// Faza 1 Codexovih popravkov: izguba podatkov med zivim sestankom.
//
// Trditve:
//  1. Ce shranjevanje pade, klik na "Zakljuci" sestanka NE zakljuci —
//     vidna blokirajoca napaka, status v bazi ostane osnutek.
//  2. Ko shranjevanje spet dela, zakljucevanje uspe in zadnji vpisani
//     odgovor JE v bazi (splakniVse pred zakljuckom).
//  3. Meta polja (kartica sestanka) se pred zakljuckom splaknejo, tudi ce
//     debounce se ni iztekel.
//  4. Iz enega zavihka nikoli ne tece vec kot en PATCH hkrati (veriga).
//  5. Brez Resend kljuca je gumb "Poslji stranki" onemogocen z razlago.
//
// Zagon: node test/reset-testne-baze.mjs && node test/save-guard.test.mjs
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3399';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}
const pocakaj = (ms) => new Promise(r => setTimeout(r, ms));

const AUTH = 'Basic ' + Buffer.from('test@acenta.si:testgeslo123').toString('base64');
async function apiJson(pot, opt = {}) {
  const res = await fetch(BASE + pot, {
    ...opt, headers: { Authorization: AUTH, 'content-type': 'application/json', ...(opt.headers || {}) },
  });
  return res.json();
}

const predloge = await apiJson('/api/procesi/predloge');
const predlogaId = predloge.predloge.find(p => p.aktivna).id;
const ustvarjena = await apiJson('/api/procesi/seje', {
  method: 'POST',
  body: JSON.stringify({
    questionnaire_id: predlogaId,
    stranka_naziv: 'Save Guard Hotel',
    proces: 'preizkus varovalke',
    svetovalec: 'Maks Zager',
  }),
});
const SID = ustvarjena.seja.id;
console.log(`(testna seja #${SID})`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });
page.on('dialog', d => d.accept());

// ── Prestrezanje: simulirana napaka omrezja + stevec socasnih PATCH-ev ──
let simulirajNapako = false;
let zadrzujMs = 0;
let aktivnih = 0, maksSocasnih = 0, skupajPatchev = 0;

await page.setRequestInterception(true);
page.on('request', (req) => {
  const jePatchSeje = req.method() === 'PATCH' && req.url().includes('/api/procesi/seje/');
  if (!jePatchSeje) return req.continue().catch(() => {});

  if (simulirajNapako) {
    return req.respond({
      status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: 'simulirana_napaka_omrezja' }),
    }).catch(() => {});
  }
  skupajPatchev++;
  aktivnih++;
  maksSocasnih = Math.max(maksSocasnih, aktivnih);
  setTimeout(() => req.continue().catch(() => {}), zadrzujMs);
});
const koncan = (req) => {
  if (req.method() === 'PATCH' && req.url().includes('/api/procesi/seje/') && !simulirajNapako) {
    aktivnih = Math.max(0, aktivnih - 1);
  }
};
page.on('requestfinished', koncan);
page.on('requestfailed', koncan);

await page.goto(`${BASE}/admin/proces-seja.html?id=${SID}`, { waitUntil: 'networkidle0' });
await page.waitForSelector('[data-qid="cilj"]', { timeout: 8000 });

async function vpisi(izbirnik, besedilo) {
  await page.click(izbirnik, { clickCount: 3 });
  await page.evaluate((s) => { const e = document.querySelector(s); if (e) e.value = ''; }, izbirnik);
  await page.click(izbirnik);
  await page.type(izbirnik, besedilo);
}

console.log('\n=== 1. Padlo shranjevanje BLOKIRA zakljucevanje ===');
simulirajNapako = true;
await vpisi('[data-qid="cilj"]', 'Odgovor, ki ne sme v nic');
await page.click('#btnZakljuci');
await page.waitForFunction(
  () => !document.getElementById('opozorilo').classList.contains('hidden'),
  { timeout: 8000, polling: 100 });

const opozorilo1 = await page.$eval('#opozorilo', e => e.textContent);
t('vidna blokirajoca napaka', /ni zaključen/.test(opozorilo1), opozorilo1.slice(0, 120));
const gumbPoNapaki = await page.$eval('#btnZakljuci', e => ({ disabled: e.disabled, besedilo: e.textContent.trim() }));
t('gumb Zakljuci spet omogocen', gumbPoNapaki.disabled === false, JSON.stringify(gumbPoNapaki));
t('gumb spet pise "Zaključi"', gumbPoNapaki.besedilo === 'Zaključi', gumbPoNapaki.besedilo);

let stanje = await apiJson(`/api/procesi/seje/${SID}`);
t('status v bazi ostane osnutek', stanje.seja.status === 'osnutek', stanje.seja.status);
t('kazalnik kaze NI shranjeno', /NI shranjeno/.test(await page.$eval('#shranjeno', e => e.textContent)),
  await page.$eval('#shranjeno', e => e.textContent));

console.log('\n=== 2. Po obnovljeni povezavi zakljucevanje uspe s svezimi odgovori ===');
simulirajNapako = false;
// Meta polje spremenimo TIK pred zakljuckom — debounce (900 ms) se ne stece,
// splakniVse ga mora splakniti sam.
await vpisi('#mProces', 'proces po splakniVse');
await pocakaj(100);
await page.click('#btnZakljuci');

// Seja ima neizpolnjena obvezna polja -> 422 -> gumb "Vseeno zakljuci".
await page.waitForSelector('#vsiliZakljucek', { timeout: 8000 });
await page.click('#vsiliZakljucek');
await page.waitForFunction(
  () => /zaključen/i.test(document.getElementById('opozorilo').textContent),
  { timeout: 8000, polling: 100 });

stanje = await apiJson(`/api/procesi/seje/${SID}`);
t('status v bazi = zakljucen', stanje.seja.status === 'zakljucen', stanje.seja.status);
t('zadnji odgovor JE v bazi', stanje.seja.answers?.cilj === 'Odgovor, ki ne sme v nic',
  JSON.stringify(stanje.seja.answers?.cilj));
t('meta polje (proces) splaknjeno pred zakljuckom', stanje.seja.proces === 'proces po splakniVse',
  stanje.seja.proces);

console.log('\n=== 3. Nikoli dva PATCH-a hkrati (veriga shranjevanja) ===');
// PATCH zadrzimo 1500 ms (> 900 ms debounce): drugi save se sprozi, ko je
// prvi se v teku. Brez verige bi tekla socasno.
skupajPatchev = 0; maksSocasnih = 0; aktivnih = 0;
zadrzujMs = 1500;
await vpisi('[data-qid="cilj"]', 'prvi hitri vnos');
await pocakaj(1000);                      // prvi PATCH je zdaj v teku (zadrzan)
await vpisi('[data-qid="cilj"]', 'drugi hitri vnos');
await pocakaj(3500);                      // oba se izteceta
zadrzujMs = 0;
t('tekla sta vsaj dva PATCH-a', skupajPatchev >= 2, skupajPatchev);
t('nikoli vec kot en PATCH hkrati', maksSocasnih === 1, maksSocasnih);

stanje = await apiJson(`/api/procesi/seje/${SID}`);
t('v bazi je NOVEJSI vnos', stanje.seja.answers?.cilj === 'drugi hitri vnos', stanje.seja.answers?.cilj);

console.log('\n=== 4. Posiljanje brez Resend kljuca: onemogocen gumb z razlago ===');
const poslji = await page.$eval('#pPoslji', e => ({ disabled: e.disabled, besedilo: e.textContent.trim() }));
t('gumb Poslji stranki onemogocen', poslji.disabled === true, JSON.stringify(poslji));
const infoVidna = await page.$eval('#pNiVklopljeno', e => !e.classList.contains('hidden'));
t('razlaga "se ni vklopljeno" vidna', infoVidna === true, infoVidna);
const info = await page.$eval('#pNiVklopljeno', e => e.textContent);
t('razlaga ponudi rocno pot (PDF/predogled)', /Predogled|PDF/.test(info), info.slice(0, 120));

await browser.close();

console.log(`\n${'='.repeat(50)}\nSKUPAJ: ${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
