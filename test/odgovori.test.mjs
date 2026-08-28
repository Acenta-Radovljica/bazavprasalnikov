// Kopija vprasalnika ob oddaji odgovora (migracija 010).
//
// Zakaj svoj nabor: to je edina stvar v aplikaciji, ki jo je NEMOGOCE popraviti
// za nazaj. Ce se odgovor shrani brez kopije vprasanj in nekdo cez mesec uredi
// vprasalnik, prava vprasanja iz tistega dne ne obstajajo vec nikjer. Test zato
// ne preverja samo, da se stolpec napolni, ampak da se prikaz po urejanju
// vprasalnika NE spremeni.
//
// Zagon: node test/reset-testne-baze.mjs && node test/odgovori.test.mjs
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
  try { telo = JSON.parse(besedilo); } catch { telo = besedilo.slice(0, 300); }
  return { status: r.status, telo };
}

// ── 1. Priprava: lasten vprasalnik, da ga smemo urejati ──────────────────
console.log('\n=== 1. Priprava ===');
const slug = 'test-snapshot-' + Math.floor(Date.now() / 1000) % 100000;
let r = await api('/api/questionnaires', {
  method: 'POST',
  body: JSON.stringify({
    slug,
    naziv_prikaz: 'Test snapshota',
    namen: 'shramba',
    aktivna: true,
    questions: [
      { id: 'podjetje', label: 'Naziv podjetja', tip: 'text', obvezno: true },
      { id: 'bolecina', label: 'Kaj vas najbolj muči?', tip: 'textarea' },
      { id: 'izbrisano', label: 'To vprašanje bo izbrisano', tip: 'text' },
    ],
  }),
});
t('vprasalnik ustvarjen', r.status === 201 || r.status === 200, `${r.status} ${JSON.stringify(r.telo)}`);
const qId = r.telo?.questionnaire?.id ?? r.telo?.id;
t('vprasalnik ima id', Number.isInteger(qId), JSON.stringify(r.telo));

// ── 2. Oddaja prek javne poti ────────────────────────────────────────────
console.log('\n=== 2. Oddaja shrani kopijo vprasalnika ===');
const oddaja = await fetch(`${BASE}/f/${slug}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    gdpr_consent: true,
    podjetje: 'Testno podjetje d.o.o.',
    bolecina: 'Preveč ročnega prepisovanja.',
    izbrisano: 'Ta odgovor mora preživeti brisanje vprašanja.',
  }),
});
const oddajaTelo = await oddaja.json();
t('POST /f/<slug> = 200', oddaja.status === 200, oddaja.status);
const responseId = oddajaTelo?.responseId;
t('vrne responseId', Number.isInteger(responseId), JSON.stringify(oddajaTelo));

r = await api(`/api/responses/${responseId}`);
t('GET odgovora = 200', r.status === 200, r.status);
let odg = r.telo?.response;
t('kopija vprasanj je shranjena', Array.isArray(odg?.questions_snapshot) && odg.questions_snapshot.length === 3,
  JSON.stringify(odg?.questions_snapshot?.length));
t('ima_snapshot je true', odg?.ima_snapshot === true, String(odg?.ima_snapshot));
t('vprasanja_za_prikaz pridejo iz kopije',
  odg?.vprasanja_za_prikaz?.[1]?.label === 'Kaj vas najbolj muči?',
  JSON.stringify(odg?.vprasanja_za_prikaz?.[1]));
t('obrazec brez custom_html nima kopije HTML', odg?.custom_html_snapshot == null,
  typeof odg?.custom_html_snapshot);

// ── 3. Nosilni test: urejanje vprasalnika NE spremeni starega odgovora ───
console.log('\n=== 3. Urejanje vprasalnika ne spremeni zgodovine ===');
r = await api(`/api/questionnaires/${qId}`, {
  method: 'PATCH',
  body: JSON.stringify({
    questions: [
      { id: 'podjetje', label: 'Naziv podjetja', tip: 'text', obvezno: true },
      { id: 'bolecina', label: 'PREIMENOVANO: kje izgubljate čas?', tip: 'textarea' },
      { id: 'novo', label: 'Novo vprašanje, ki ga stranka ni videla', tip: 'text' },
    ],
  }),
});
t('vprasalnik urejen', r.status === 200, `${r.status} ${JSON.stringify(r.telo).slice(0, 120)}`);

r = await api(`/api/responses/${responseId}`);
odg = r.telo?.response;
t('star odgovor NE dobi novega besedila vprasanja',
  odg?.vprasanja_za_prikaz?.[1]?.label === 'Kaj vas najbolj muči?',
  JSON.stringify(odg?.vprasanja_za_prikaz?.[1]?.label));
t('izbrisano vprasanje ostane v kopiji',
  odg?.vprasanja_za_prikaz?.some((q) => q.id === 'izbrisano'),
  JSON.stringify(odg?.vprasanja_za_prikaz?.map((q) => q.id)));
t('novega vprasanja v starem odgovoru ni',
  !odg?.vprasanja_za_prikaz?.some((q) => q.id === 'novo'),
  JSON.stringify(odg?.vprasanja_za_prikaz?.map((q) => q.id)));
t('danasnja vprasanja so se vedno na voljo loceno',
  odg?.q_questions?.some((q) => q.id === 'novo'),
  JSON.stringify(odg?.q_questions?.map((q) => q.id)));
t('odgovori se niso spremenili',
  odg?.raw_data?.bolecina === 'Preveč ročnega prepisovanja.');

// ── 4. custom_html obrazec: shrani se cel HTML ───────────────────────────
console.log('\n=== 4. custom_html obrazec ===');
const HTML = `<!DOCTYPE html><html lang="sl"><head><meta charset="UTF-8"><title>Custom</title></head>
<body><form method="post" action="/f/${slug}-html">
<label>Ime objekta<input name="objekt"></label>
<label>Koliko sob<input name="sobe"></label>
<input type="hidden" name="gdpr_consent" value="on">
<button>Pošlji</button></form></body></html>`;
r = await api('/api/questionnaires', {
  method: 'POST',
  body: JSON.stringify({
    slug: `${slug}-html`, naziv_prikaz: 'Test custom HTML', namen: 'shramba',
    aktivna: true, questions: [], custom_html: HTML,
  }),
});
const qHtmlId = r.telo?.questionnaire?.id ?? r.telo?.id;
t('custom_html vprasalnik ustvarjen', Number.isInteger(qHtmlId), `${r.status}`);

const oddaja2 = await fetch(`${BASE}/f/${slug}-html`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ gdpr_consent: true, podjetje: 'Hotel Testni', objekt: 'Vila Test', sobe: '24' }),
});
const telo2 = await oddaja2.json();
t('oddaja na custom_html = 200', oddaja2.status === 200, oddaja2.status);

r = await api(`/api/responses/${telo2.responseId}`);
const odg2 = r.telo?.response;
t('cel HTML obrazca je shranjen',
  typeof odg2?.custom_html_snapshot === 'string' && odg2.custom_html_snapshot.includes('Ime objekta'),
  String(odg2?.custom_html_snapshot?.length));
t('shranjeni HTML je enak oddanemu', odg2?.custom_html_snapshot === HTML);
t('ima_snapshot je true tudi brez questions', odg2?.ima_snapshot === true, String(odg2?.ima_snapshot));

// Urejanje HTML obrazca ne sme spremeniti ze oddanega odgovora.
await api(`/api/questionnaires/${qHtmlId}`, {
  method: 'PATCH', body: JSON.stringify({ custom_html: HTML.replace('Ime objekta', 'SPREMENJENO') }),
});
r = await api(`/api/responses/${telo2.responseId}`);
t('urejanje HTML ne spremeni ze oddanega odgovora',
  r.telo?.response?.custom_html_snapshot.includes('Ime objekta')
  && !r.telo?.response?.custom_html_snapshot.includes('SPREMENJENO'));

// ── 5. Odziv pove, od kod so vprasanja ──────────────────────────────────
console.log('\n=== 5. Izvor vprasanj je razviden ===');
const zZastavicami = await api(`/api/responses/${responseId}`);
t('odziv nosi obe zastavici o izvoru vprasanj',
  'ima_snapshot' in (zZastavicami.telo?.response || {})
  && 'vprasalnik_urejen_po_oddaji' in (zZastavicami.telo?.response || {}));
t('zaznano je, da je bil vprasalnik urejen po oddaji',
  zZastavicami.telo?.response?.vprasalnik_urejen_po_oddaji === true,
  String(zZastavicami.telo?.response?.vprasalnik_urejen_po_oddaji));
t('kljub urejanju ostane prikaz iz kopije (opozorila ni treba)',
  zZastavicami.telo?.response?.ima_snapshot === true);

// ── 6. Stran odgovora ────────────────────────────────────────────────────
console.log('\n=== 6. Stran /admin/response.html ===');
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });
const napake = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (((m.location?.()?.url || '') + m.text()).includes('favicon')) return;
  napake.push(m.text());
});
page.on('pageerror', (e) => napake.push('pageerror: ' + e.message));

await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/admin/response.html?id=${responseId}`, { waitUntil: 'networkidle0' });
await pocakaj(600);
const besedilo = await page.$eval('#content', (e) => e.textContent);
t('stran pokaze staro besedilo vprasanja', besedilo.includes('Kaj vas najbolj muči?'), '');
t('stran NE pokaze preimenovanega besedila', !besedilo.includes('PREIMENOVANO'), '');
t('odgovor na izbrisano vprasanje je se vedno viden',
  besedilo.includes('Ta odgovor mora preživeti brisanje vprašanja.'));

// Stran s custom_html kopijo mora ponuditi ogled obrazca in ga res odpreti.
await page.goto(`${BASE}/admin/response.html?id=${telo2.responseId}`, { waitUntil: 'networkidle0' });
await pocakaj(600);
t('gumb za ogled obrazca obstaja', !!(await page.$('#btn-obrazec')));
t('okvir je privzeto skrit',
  await page.$eval('#obrazec-ovoj', (e) => e.className.includes('hidden')));
await page.click('#btn-obrazec');
await pocakaj(400);
t('klik odpre obrazec',
  !(await page.$eval('#obrazec-ovoj', (e) => e.className.includes('hidden'))));
t('okvir dobi shranjeni HTML',
  (await page.$eval('#obrazec', (e) => e.getAttribute('srcdoc') || '')).includes('Ime objekta'));
t('okvir je v peskovniku',
  (await page.$eval('#obrazec', (e) => e.getAttribute('sandbox'))) === '');
await page.click('#btn-obrazec');
await pocakaj(300);
t('drugi klik zapre obrazec',
  await page.$eval('#obrazec-ovoj', (e) => e.className.includes('hidden')));
t('brez JS napak', napake.length === 0, JSON.stringify(napake.slice(0, 2)));

await browser.close();

// Pospravi za sabo. Brisanje prek API-ja je mehko (aktivna = false), vrstica
// pa ostane in podre stetje vprasalnikov v procesi-api.test.mjs — zato trdo,
// neposredno v testni bazi. Isto pocne tudi reset-testne-baze.mjs, ce bi kdaj
// ta nabor padel prej in do sem ne prisel.
const pg = (await import('pg')).default;
const pool = new pg.Pool({ connectionString: 'postgres://postgres:test@127.0.0.1:5435/vprasalniki' });
await pool.query(`DELETE FROM responses WHERE questionnaire_id IN
  (SELECT id FROM questionnaires WHERE slug LIKE 'test-snapshot-%')`);
const { rowCount } = await pool.query(`DELETE FROM questionnaires WHERE slug LIKE 'test-snapshot-%'`);
await pool.end();
t('testni vprasalniki pospravljeni', rowCount === 2, String(rowCount));

console.log('\n──────────────────────────────────────────────');
console.log(`OK: ${ok}   FAIL: ${fail}`);
if (padli.length) { console.log('Padli:'); padli.forEach((p) => console.log('  - ' + p)); }
process.exit(fail ? 1 : 0);
