// Katalog Acentinih resitev + interne opombe podjetja (migracija 014).
//
// API (vnos, urejanje, brisanje, napacni vnosi), stran Katalog v Chromu
// (vsak gumb in filter, tudi na telefonu), kartica Interne opombe na strani
// podjetja (samodejno shranjevanje, sprememba statusa je ne povozi) in ZIP za
// Claude, ki dobi katalog in opombe.
//
// Zagon: node test/reset-testne-baze.mjs && node test/katalog.test.mjs
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
  const r = await fetch(BASE + pot, { ...opt, headers: { Authorization: AUTH, 'content-type': 'application/json', ...(opt.headers || {}) } });
  const b = await r.text();
  let telo = null;
  try { telo = JSON.parse(b); } catch { telo = b.slice(0, 300); }
  return { status: r.status, telo };
}
const json = (o) => JSON.stringify(o);

// ── 1. API kataloga ──────────────────────────────────────────────────────
console.log('\n=== 1. API kataloga ===');
t('brez prijave 401', (await fetch(`${BASE}/api/katalog`)).status === 401);
let r = await api('/api/katalog');
t('prazen katalog', r.status === 200 && r.telo.resitve.length === 0 && r.telo.ne_priporocamo === '', json(r.telo));
t('seznam statusov', json(r.telo.statusi) === json(['produkcija', 'pilot', 'prototip', 'ponudba', 'ideja', 'ustavljeno']));

t('brez naziva 400', (await api('/api/katalog', { method: 'POST', body: json({ tezava: 'x' }) })).telo.error === 'missing_naziv');
t('prazen naziv 400', (await api('/api/katalog', { method: 'POST', body: json({ naziv: '   ' }) })).telo.error === 'missing_naziv');
t('napacen status 400', (await api('/api/katalog', { method: 'POST', body: json({ naziv: 'X', status: 'zivo' }) })).telo.error === 'invalid_status');
t('smemo_omeniti kot niz 400', (await api('/api/katalog', { method: 'POST', body: json({ naziv: 'X', smemo_omeniti: 'da' }) })).telo.error === 'invalid_smemo_omeniti');
t('stevilka namesto niza 400', (await api('/api/katalog', { method: 'POST', body: json({ naziv: 'X', kje: 5 }) })).telo.error === 'invalid_kje');

r = await api('/api/katalog', { method: 'POST', body: json({ naziv: '  Razpored izmen  ', tezava: 'Ročni razpored.', panoga: 'hoteli' }) });
const a = r.telo.resitev;
t('nova resitev 201, naziv obrezan, privzeti status ideja in brez reference', r.status === 201 && a.naziv === 'Razpored izmen' && a.status === 'ideja' && a.smemo_omeniti === false, json(r.telo));
r = await api('/api/katalog', { method: 'POST', body: json({ naziv: 'Osnutki odgovorov na mnenja', tezava: 'Ni časa.', kaj_naredi: 'AI napiše, človek objavi.', kje: 'Hotel Breza', panoga: 'hoteli', status: 'produkcija', smemo_omeniti: true }) });
const b = r.telo.resitev;
t('druga resitev s polnimi polji', r.status === 201 && b.smemo_omeniti === true && b.kje === 'Hotel Breza');

await pocakaj(20);
r = await api(`/api/katalog/${a.id}`, { method: 'PATCH', body: json({ status: 'pilot' }) });
t('PATCH status', r.status === 200 && r.telo.resitev.status === 'pilot' && r.telo.resitev.tezava === 'Ročni razpored.', json(r.telo));
t('PATCH posodobi datum', new Date(r.telo.resitev.updated_at) > new Date(a.updated_at));
t('PATCH brez polj 400', (await api(`/api/katalog/${a.id}`, { method: 'PATCH', body: json({}) })).telo.error === 'nothing_to_update');
t('PATCH s praznim nazivom 400', (await api(`/api/katalog/${a.id}`, { method: 'PATCH', body: json({ naziv: '' }) })).telo.error === 'missing_naziv');
t('PATCH neobstojece 404', (await api('/api/katalog/999999', { method: 'PATCH', body: json({ status: 'pilot' }) })).status === 404);
t('PATCH napacen id 400', (await api('/api/katalog/abc', { method: 'PATCH', body: json({ status: 'pilot' }) })).status === 400);

r = await api('/api/katalog');
t('vrstni red po statusu: produkcija pred pilotom', json(r.telo.resitve.map(x => x.status)) === json(['produkcija', 'pilot']), json(r.telo.resitve.map(x => x.status)));

t('ne-priporocamo napacen tip 400', (await api('/api/katalog/ne-priporocamo', { method: 'PUT', body: json({ besedilo: 5 }) })).status === 400);
r = await api('/api/katalog/ne-priporocamo', { method: 'PUT', body: json({ besedilo: '  Copilot, naročnine ChatGPT.  ' }) });
t('ne-priporocamo shranjeno in obrezano', r.status === 200 && r.telo.ne_priporocamo === 'Copilot, naročnine ChatGPT.');
r = await api('/api/katalog/ne-priporocamo', { method: 'PUT', body: json({ besedilo: 'Copilot, naročnine ChatGPT, DeepL.' }) });
t('ne-priporocamo drugic prepise', (await api('/api/katalog')).telo.ne_priporocamo === 'Copilot, naročnine ChatGPT, DeepL.');

r = await api('/api/katalog', { method: 'POST', body: json({ naziv: 'Za brisanje' }) });
const c = r.telo.resitev;
t('DELETE', (await api(`/api/katalog/${c.id}`, { method: 'DELETE' })).telo.deleted === c.id);
t('DELETE drugic 404', (await api(`/api/katalog/${c.id}`, { method: 'DELETE' })).status === 404);

// ── 2. Interne opombe prek API-ja ────────────────────────────────────────
console.log('\n=== 2. Interne opombe (API) ===');
const oznaka = String(Date.now() % 1000000);
r = await api('/api/questionnaires', { method: 'POST', body: json({ slug: `test-katalog-${oznaka}`, naziv_prikaz: 'Test kataloga', namen: 'shramba', aktivna: true,
  questions: [{ id: 'podjetje', label: 'Naziv podjetja', tip: 'text' }, { id: 'ime', label: 'Ime in priimek', tip: 'text' }] }) });
const qid = r.telo?.questionnaire?.id ?? r.telo?.id;
const oddaja = await fetch(`${BASE}/f/test-katalog-${oznaka}`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: json({ gdpr_consent: true, podjetje: `Hotel Opombe ${oznaka}`, ime: 'Ana Breza' }) }).then(x => x.json());
const cid = oddaja.companyId;
t('podjetje za test', Number.isInteger(cid), json(oddaja));

t('opombe kot stevilka 400', (await api(`/api/companies/${cid}`, { method: 'PATCH', body: json({ interne_opombe: 5 }) })).telo.error === 'invalid_interne_opombe');
r = await api(`/api/companies/${cid}`, { method: 'PATCH', body: json({ interne_opombe: '  Račun za Claude že imajo.  ' }) });
t('opombe shranjene, obrezane, z datumom', r.status === 200 && r.telo.company.interne_opombe === 'Račun za Claude že imajo.' && !!r.telo.company.interne_opombe_updated_at, json(r.telo));
t('GET podjetja vrne opombe', (await api(`/api/companies/${cid}`)).telo.company.interne_opombe === 'Račun za Claude že imajo.');
r = await api(`/api/companies/${cid}`, { method: 'PATCH', body: json({ status: 'sestanek' }) });
t('sprememba statusa opomb ne pobrise', r.telo.company.interne_opombe === 'Račun za Claude že imajo.' && r.telo.company.status === 'sestanek');
r = await api(`/api/companies/${cid}`, { method: 'PATCH', body: json({ interne_opombe: '   ' }) });
t('prazne opombe = izbrisano (null)', r.status === 200 && r.telo.company.interne_opombe === null);

r = await api(`/api/companies/${cid}/izvoz`);
t('izvoz vsebuje katalog', r.telo.katalog?.resitve?.length === 2 && r.telo.katalog.ne_priporocamo.includes('DeepL'), json(r.telo.katalog));
t('izvoz vsebuje polje opomb', 'interne_opombe' in (r.telo.company || {}));

// ── 3. Stran Katalog ─────────────────────────────────────────────────────
console.log('\n=== 3. Stran Katalog ===');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });
const napake = [];
page.on('pageerror', (e) => napake.push(e.message));
page.on('dialog', (d) => d.accept());
await page.setViewport({ width: 1366, height: 900 });
await page.goto(`${BASE}/admin/katalog.html`, { waitUntil: 'networkidle0' });

const vrstice = () => page.$$eval('.kat-tabela tbody tr', els => els.map(e => e.querySelector('.kat-ime').textContent));
t('aktivna postavka v meniju je Katalog', await page.$$eval('nav a.sidebar-item.active', els => els.length === 1 && els[0].textContent.includes('Katalog')).catch(() => false));
t('tabela kaze obe resitvi', json(await vrstice()) === json(['Osnutki odgovorov na mnenja', 'Razpored izmen']), json(await vrstice()));
t('vrstica pove datum posodobitve in referenco', (await page.$eval('.kat-tabela tbody tr .kat-pod', e => e.textContent)).includes('posodobljeno') && (await page.$eval('.kat-tabela tbody tr .kat-pod', e => e.textContent)).includes('smemo omeniti'));
t('namizje: Status in Uredi sta vidna, tabela ne uide cez rob', await page.evaluate(() => {
  const ovoj = document.querySelector('.kat-tabela').getBoundingClientRect();
  const gumb = document.querySelector('.kat-tabela tbody tr button').getBoundingClientRect();
  const tabela = document.querySelector('.kat-tabela table');
  return gumb.right <= ovoj.right + 1 && tabela.scrollWidth <= document.querySelector('.kat-tabela').clientWidth + 1;
}));
t('cesa ne priporocamo je nalozeno', (await page.$eval('#ne-priporocamo', e => e.value)).includes('DeepL'));
t('obrazec je skrit, dokler ga ne odpres', await page.$eval('#urejanje', e => e.hidden));

// Dodaj
await page.click('#btn-dodaj');
t('Dodaj odpre prazen obrazec brez gumba Izbrisi', await page.$eval('#urejanje', e => !e.hidden) && await page.$eval('#btn-izbrisi', e => e.hidden) && (await page.$eval('#f-naziv', e => e.value)) === '');
await page.click('#btn-shrani');
t('Shrani brez imena pokaze napako', await page.$eval('#napaka', e => !e.hidden && e.textContent.includes('ime')));
await page.type('#f-naziv', 'Tedenski jedilnik z alergeni');
await page.type('#f-tezava', 'Jedilnik in alergeni vzamejo čas.');
await page.type('#f-kje', 'Hotel Lipa');
await page.type('#f-panoga', 'hoteli');
await page.select('#f-status', 'prototip');
await page.click('#btn-shrani');
await page.waitForFunction(() => document.getElementById('urejanje').hidden, { timeout: 5000 }).catch(() => {});
t('nova resitev je v tabeli in obrazec zaprt', (await vrstice()).includes('Tedenski jedilnik z alergeni') && await page.$eval('#urejanje', e => e.hidden));
t('tudi v bazi', (await api('/api/katalog')).telo.resitve.some(x => x.naziv === 'Tedenski jedilnik z alergeni' && x.status === 'prototip' && x.kje === 'Hotel Lipa'));

// Prekliči
await page.click('#btn-dodaj');
await page.type('#f-naziv', 'Ne shrani me');
await page.click('#btn-preklici');
t('Preklici zapre brez shranjevanja', await page.$eval('#urejanje', e => e.hidden) && !(await vrstice()).includes('Ne shrani me'));

// Filtri
const filtri = await page.$$eval('#filterStatus button', els => els.map(e => e.textContent.trim()));
t('filtri kazejo samo uporabljene statuse s stevci', json(filtri) === json(['Vse 3', 'V produkciji 1', 'V pilotu 1', 'Prototip 1']), json(filtri));
await page.click('#filterStatus button[data-status="pilot"]');
t('filter V pilotu', json(await vrstice()) === json(['Razpored izmen']) && (await page.$eval('#foot-count', e => e.textContent)) === '1 od 3');
await page.click('#filterStatus button[data-status=""]');
t('filter Vse', (await vrstice()).length === 3);
const panoge = await page.$$eval('#filterPanoga option', els => els.map(e => e.value));
t('panoge iz podatkov', json(panoge) === json(['', 'hoteli']), json(panoge));
await page.select('#filterPanoga', 'hoteli');
t('filter panoge', (await vrstice()).length === 3);
await page.select('#filterPanoga', '');

// Uredi prek klika na vrstico
await page.click('.kat-tabela tbody tr:nth-child(2)');
t('klik na vrstico odpre izpolnjen obrazec z gumbom Izbrisi', (await page.$eval('#f-naziv', e => e.value)) === 'Razpored izmen' && await page.$eval('#btn-izbrisi', e => !e.hidden) && (await page.$eval('#f-status', e => e.value)) === 'pilot');
await page.click('#f-omeniti');
await page.select('#f-status', 'produkcija');
await page.click('#btn-shrani');
await page.waitForFunction(() => document.getElementById('urejanje').hidden, { timeout: 5000 }).catch(() => {});
const razpored = (await api('/api/katalog')).telo.resitve.find(x => x.naziv === 'Razpored izmen');
t('urejanje shrani status in referenco', razpored?.status === 'produkcija' && razpored.smemo_omeniti === true, json(razpored));

// Uredi prek gumba Uredi
await page.click(`.kat-tabela button[data-id="${razpored.id}"]`);
t('gumb Uredi odpre isto resitev', (await page.$eval('#f-naziv', e => e.value)) === 'Razpored izmen');
await page.click('#btn-izbrisi');
await page.waitForFunction(() => document.getElementById('urejanje').hidden, { timeout: 5000 }).catch(() => {});
t('Izbrisi odstrani resitev', !(await vrstice()).includes('Razpored izmen') && !(await api('/api/katalog')).telo.resitve.some(x => x.naziv === 'Razpored izmen'));

// Česa ne priporočamo
await page.click('#ne-priporocamo', { clickCount: 3 });
await page.$eval('#ne-priporocamo', e => { e.value = ''; });
await page.type('#ne-priporocamo', 'Copilot in brezplačni paketi.');
await page.click('#btn-shrani-ne');
t('ob kliku »Shranjujem«', (await page.$eval('#ne-shranjeno', e => e.textContent)).startsWith('Shranjujem') || (await page.$eval('#ne-shranjeno', e => e.textContent)).startsWith('Shranjeno'));
await page.waitForFunction(() => document.getElementById('ne-shranjeno').textContent.startsWith('Shranjeno'), { timeout: 5000 }).catch(() => {});
t('Shrani cesa ne priporocamo', (await api('/api/katalog')).telo.ne_priporocamo === 'Copilot in brezplačni paketi.');

// Telefon
await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.reload({ waitUntil: 'networkidle0' });
t('telefon: kartice namesto tabele', await page.$eval('.kat-kartice', e => getComputedStyle(e).display !== 'none') && await page.$eval('.kat-tabela', e => getComputedStyle(e).display === 'none'));
t('telefon: brez vodoravnega prelivanja', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.click('.kat-kartica');
t('telefon: klik na kartico odpre urejanje', await page.$eval('#urejanje', e => !e.hidden));
await page.setViewport({ width: 1366, height: 900 });

// Prazen katalog: prazno stanje
for (const x of (await api('/api/katalog')).telo.resitve) await api(`/api/katalog/${x.id}`, { method: 'DELETE' });
await page.reload({ waitUntil: 'networkidle0' });
t('prazno stanje pove, zakaj katalog rabimo', (await page.$eval('#seznam', e => e.textContent)).includes('Katalog je prazen'));
// Vrni dve resitvi za preizkus izvoza spodaj.
await api('/api/katalog', { method: 'POST', body: json({ naziv: 'Osnutki odgovorov na mnenja', status: 'produkcija', kje: 'Hotel Breza', smemo_omeniti: true }) });

// ── 4. Interne opombe na strani podjetja ─────────────────────────────────
console.log('\n=== 4. Interne opombe na strani podjetja ===');
await page.evaluateOnNewDocument(() => {
  const klik = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__prenos = { ime: this.download, href: this.href };
    return klik.call(this);
  };
  URL.revokeObjectURL = () => {};
});
await page.goto(`${BASE}/admin/company.html?id=${cid}`, { waitUntil: 'networkidle0' });
t('kartica Interne opombe je prva v stranskem stolpcu', await page.$eval('.e-side', e => e.firstElementChild.textContent.includes('Interne opombe')));
// Opombe so bile v delu 2 izbrisane: polje je prazno, stanje pove, da je izbris shranjen.
t('izbrisane opombe: prazno polje, stanje »Shranjeno«', (await page.$eval('#opombe', e => e.value)) === '' && (await page.$eval('#opombe-stanje', e => e.textContent)).startsWith('Shranjeno'));
await page.type('#opombe', 'Račun za Claude že imajo.');
t('med tipkanjem: »Neshranjeno«', (await page.$eval('#opombe-stanje', e => e.textContent)).startsWith('Neshranjeno'));
await page.waitForFunction(() => document.getElementById('opombe-stanje').textContent.startsWith('Shranjeno'), { timeout: 5000 }).catch(() => {});
t('po premoru shranjeno', (await api(`/api/companies/${cid}`)).telo.company.interne_opombe === 'Račun za Claude že imajo.');

// Dopiši in takoj spremeni status: blur sproži shranjevanje, status ga ne sme povoziti.
await page.type('#opombe', ' Direktorica odloča sama.');
await page.select('.e-sidecard select.e-select', 'ponudba');
await pocakaj(1500);
const poStatusu = (await api(`/api/companies/${cid}`)).telo.company;
t('status in opombe oboje shranjeno', poStatusu.status === 'ponudba' && poStatusu.interne_opombe === 'Račun za Claude že imajo. Direktorica odloča sama.', json({ s: poStatusu.status, o: poStatusu.interne_opombe }));
t('besedilo v polju po ponovnem izrisu ostane', (await page.$eval('#opombe', e => e.value)) === 'Račun za Claude že imajo. Direktorica odloča sama.');
await page.reload({ waitUntil: 'networkidle0' });
t('po osvezitvi strani opombe ostanejo', (await page.$eval('#opombe', e => e.value)) === 'Račun za Claude že imajo. Direktorica odloča sama.' && (await page.$eval('#opombe-stanje', e => e.textContent)).startsWith('Shranjeno'));

// ZIP s katalogom in opombami
await page.click('#btn-izvoz');
await page.waitForFunction(() => window.__prenos, { timeout: 15000 }).catch(() => {});
const zipBesedila = await page.evaluate(async () => {
  if (!window.__prenos) return null;
  const b = new Uint8Array(await (await fetch(window.__prenos.href)).arrayBuffer());
  const v = new DataView(b.buffer), dec = new TextDecoder(), out = {};
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const vel = v.getUint32(p + 18, true), dIme = v.getUint16(p + 26, true), dEx = v.getUint16(p + 28, true);
    out[dec.decode(b.subarray(p + 30, p + 30 + dIme)).split('/').slice(1).join('/')] = dec.decode(b.subarray(p + 30 + dIme + dEx, p + 30 + dIme + dEx + vel));
    p += 30 + dIme + dEx + vel;
  }
  return out;
});
t('ZIP ima katalog', !!zipBesedila?.['02-acenta-resitve.md']?.includes('Osnutki odgovorov na mnenja'), json(Object.keys(zipBesedila || {})));
t('ZIP ima prepovedi', zipBesedila?.['02-acenta-resitve.md']?.includes('Copilot in brezplačni paketi.'));
t('ZIP ima interne opombe', zipBesedila?.['01-podjetje.md']?.includes('Direktorica odloča sama.'));
t('ZIP navodila uporabijo katalog', zipBesedila?.['00-NAVODILA-ZA-CLAUDE.md']?.includes('Vsak proces povežite z rešitvijo iz kataloga'));
t('brez JS napak', napake.length === 0, napake.join(' | '));
await browser.close();

// ── 5. Pospravi ──────────────────────────────────────────────────────────
await api(`/api/companies/${cid}`, { method: 'DELETE' });
for (const x of (await api('/api/katalog')).telo.resitve) await api(`/api/katalog/${x.id}`, { method: 'DELETE' });
await api('/api/katalog/ne-priporocamo', { method: 'PUT', body: json({ besedilo: '' }) });
const pg = (await import('pg')).default;
const pool = new pg.Pool({ connectionString: process.env.TEST_DB_URL || 'postgres://postgres:test@127.0.0.1:5435/vprasalniki' });
await pool.query('DELETE FROM questionnaires WHERE id = $1', [qid]);
await pool.end();

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:\n  ' + padli.join('\n  ')); process.exit(1); }
