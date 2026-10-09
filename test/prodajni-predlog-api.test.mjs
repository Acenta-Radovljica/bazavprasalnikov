// Prodajni predlog: API (pripravi, preberi, PDF) in stran podjetja.
//
// Streznik tece BREZ AI kljuca, zato se priprava konca z napako "AI se ni
// odzval"; to je pot napake. Uspesen predlog vpisemo neposredno v bazo (kot
// bi ga zapisal generator), jedro generatorja z laznim AI preverja
// test/prodajni-predlog.test.mjs. Tako test ne porabi nobenega AI klica.
//
// Zagon: node test/reset-testne-baze.mjs && node test/prodajni-predlog-api.test.mjs
// (TEST_BASE in TEST_DB_URL kot pri ostalih naborih, glej README)
import puppeteer from 'puppeteer-core';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3399';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const AUTH = 'Basic ' + Buffer.from('test@acenta.si:testgeslo123').toString('base64');

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}
const pocakaj = (ms) => new Promise(r => setTimeout(r, ms));

async function api(pot, opt = {}) {
  const r = await fetch(BASE + pot, {
    ...opt,
    headers: { Authorization: AUTH, 'content-type': 'application/json', ...(opt.headers || {}) },
  });
  const besedilo = await r.text();
  let telo = null;
  try { telo = JSON.parse(besedilo); } catch { telo = besedilo.slice(0, 300); }
  return { status: r.status, telo, tip: r.headers.get('content-type') || '', disp: r.headers.get('content-disposition') || '' };
}
const oddaj = (slug, telo) => fetch(`${BASE}/f/${slug}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(telo),
}).then(r => r.json().catch(() => ({})));

const pg = (await import('pg')).default;
const pool = new pg.Pool({ connectionString: process.env.TEST_DB_URL || 'postgres://postgres:test@127.0.0.1:5435/vprasalniki' });

const oznaka = String(Date.now() % 1000000);
const PODJETJE = `Hotel Predlog Test ${oznaka}`;
const PRAZNO = `Podjetje Brez Predloga ${oznaka}`;

// ── 1. Priprava ──────────────────────────────────────────────────────────
console.log('\n=== 1. Priprava podatkov ===');
let r = await api('/api/questionnaires', {
  method: 'POST',
  body: JSON.stringify({
    slug: `test-predlog-${oznaka}`, naziv_prikaz: 'Test predloga', namen: 'shramba', aktivna: true,
    questions: [
      { id: 'podjetje', label: 'Naziv podjetja', tip: 'text', obvezno: true },
      { id: 'ime', label: 'Ime in priimek', tip: 'text' },
      { id: 'bolecina', label: 'Katero opravilo vam vzame največ časa?', tip: 'textarea' },
    ],
  }),
});
const qid = r.telo?.questionnaire?.id ?? r.telo?.id;
t('vprasalnik ustvarjen', Number.isInteger(qid), JSON.stringify(r.telo));

await oddaj(`test-predlog-${oznaka}`, { gdpr_consent: true, podjetje: PODJETJE, ime: 'Petra Novak', bolecina: 'Ročno prepisujemo rezervacije iz e-pošte.' });
await oddaj(`test-predlog-${oznaka}`, { gdpr_consent: true, podjetje: PRAZNO, ime: 'Janez Kos', bolecina: 'Pisanje objav.' });
await pocakaj(1500);
const podjetja = (await api('/api/companies')).telo.companies;
const cid = podjetja.find(c => c.naziv_prikaz === PODJETJE)?.id;
const cidPrazno = podjetja.find(c => c.naziv_prikaz === PRAZNO)?.id;
t('obe podjetji obstajata', Number.isInteger(cid) && Number.isInteger(cidPrazno));

// ── 2. API: preverjanje vhoda ────────────────────────────────────────────
console.log('\n=== 2. API: vhod ===');
const datoteka = (ime, vsebina) => ({ ime: `koren/${ime}`, vsebina });
const paket = [
  datoteka('00-NAVODILA-ZA-CLAUDE.md', '# Navodila'),
  datoteka('01-podjetje.md', `# ${PODJETJE}`),
  datoteka('odgovori/01-x.md', '# Odgovor'),
];

r = await api(`/api/companies/${cid}/prodajni-predlog`);
t('GET brez predloga: predlog in tek null, gradivo presteto',
  r.status === 200 && r.telo.predlog === null && r.telo.tek === null && r.telo.gradivo?.odgovori === 1 && r.telo.gradivo?.seje === 0,
  JSON.stringify(r.telo));
t('POST brez datotek: 400', (await api(`/api/companies/${cid}/prodajni-predlog`, { method: 'POST', body: '{}' })).status === 400);
t('POST z neveljavno datoteko: 400', (await api(`/api/companies/${cid}/prodajni-predlog`, {
  method: 'POST', body: JSON.stringify({ datoteke: [{ ime: 'x' }] }) })).status === 400);
r = await api(`/api/companies/${cid}/prodajni-predlog`, {
  method: 'POST', body: JSON.stringify({ datoteke: [datoteka('00-NAVODILA-ZA-CLAUDE.md', '#')] }) });
t('POST brez odgovorov in sej: 400 ni_gradiva', r.status === 400 && r.telo.error === 'ni_gradiva', JSON.stringify(r.telo));
t('POST za neobstojece podjetje: 404', (await api('/api/companies/99999999/prodajni-predlog', {
  method: 'POST', body: JSON.stringify({ datoteke: paket }) })).status === 404);
t('neveljaven id: 400', (await api('/api/companies/abc/prodajni-predlog')).status === 400);

const brezGesla = await fetch(`${BASE}/api/companies/${cid}/prodajni-predlog`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ datoteke: paket }) });
t('brez gesla: 401', brezGesla.status === 401, String(brezGesla.status));
const velik = 'x'.repeat(2_000_000);
const brezGeslaVelik = await fetch(`${BASE}/api/companies/${cid}/prodajni-predlog`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ datoteke: [datoteka('odgovori/1.md', velik)] }) });
t('brez gesla z velikim telesom: 401, ne bere telesa', brezGeslaVelik.status === 401, String(brezGeslaVelik.status));
r = await api(`/api/companies/${cid}/prodajni-predlog`, {
  method: 'POST', body: JSON.stringify({ datoteke: [datoteka('odgovori/1.md', 'x'.repeat(700_000))] }) });
t('paket nad mejo znakov (1,4 MB telo): 413 prevelik_paket, ne 413 parserja',
  r.status === 413 && r.telo.error === 'prevelik_paket', JSON.stringify(r.telo).slice(0, 200));

// ── 3. API: priprava brez AI konca z napako ──────────────────────────────
console.log('\n=== 3. API: priprava brez AI ===');
r = await api(`/api/companies/${cid}/prodajni-predlog`, { method: 'POST', body: JSON.stringify({ datoteke: paket }) });
t('POST: 202 z vrstico v pripravi', r.status === 202 && r.telo.tek?.status === 'pripravlja', JSON.stringify(r.telo));
t('vhod presteje odgovore', r.telo.tek?.vhod?.odgovori === 1 && r.telo.tek?.vhod?.seje === 0, JSON.stringify(r.telo.tek?.vhod));
// Brez kljuca AI vrne null takoj, priprava se konca v trenutku. Drugi POST
// takoj za prvim je zato lahko 202 ali 409; zaklep preverimo spodaj z bazo.
let tek = null;
for (let i = 0; i < 20; i++) {
  tek = (await api(`/api/companies/${cid}/prodajni-predlog`)).telo.tek;
  if (tek?.status !== 'pripravlja') break;
  await pocakaj(300);
}
t('brez AI: tek je napaka z razlogom', tek?.status === 'napaka' && /AI se ni odzval/.test(tek.napaka || ''), JSON.stringify(tek));

await pool.query(`INSERT INTO prodajni_predlogi (company_id, status) VALUES ($1, 'pripravlja')`, [cid]);
r = await api(`/api/companies/${cid}/prodajni-predlog`, { method: 'POST', body: JSON.stringify({ datoteke: paket }) });
t('ze tece priprava: 409 ze_pripravlja', r.status === 409 && r.telo.error === 'ze_pripravlja', JSON.stringify(r.telo));
const obticana = (await pool.query(
  `UPDATE prodajni_predlogi SET created_at = NOW() - INTERVAL '25 minutes'
    WHERE company_id = $1 AND status = 'pripravlja' RETURNING id`, [cid])).rows[0].id;
await api(`/api/companies/${cid}/prodajni-predlog`);
const poGet = (await pool.query('SELECT status, napaka FROM prodajni_predlogi WHERE id = $1', [obticana])).rows[0];
t('obticana priprava (25 min) se ob branju oznaci kot napaka', poGet.status === 'napaka' && /predolgo/.test(poGet.napaka || ''), JSON.stringify(poGet));
t('PDF brez uspesnega predloga: 400 ni_predloga', (await api(`/api/companies/${cid}/prodajni-predlog/pdf`)).telo?.error === 'ni_predloga');

// ── 4. Uspesen predlog (kot ga zapise generator) ─────────────────────────
console.log('\n=== 4. Uspesen predlog ===');
const D1 = `# Seznam procesov za direktorja

Pri anketah je sodeloval 1 zaposleni.

### 1. Rezervacije iz e-pošte (recepcija)

- **Kaj pravijo vaši ljudje**: »Ročno prepisujemo rezervacije iz e-pošte.«
- **Zahtevnost uvedbe**: srednja.

| proces | kdo si ga želi | korist | zahtevnost | naše priporočilo |
|---|---|---|---|---|
| Rezervacije iz e-pošte v rezervacijski sistem brez ročnega prepisovanja | vodja recepcije in dve receptorki | manj ročnega dela | srednja | za začetek |

Predlagamo, da izberete enega ali dva procesa za začetek.`;
const D2 = `# Prodajna priporočila za Matjaža

- **S čim odpreti pogovor**: rezervacije. Petra Novak je zagovornica.
- **Česa ne vemo**: koliko ur na teden.`;
await pool.query(
  `INSERT INTO prodajni_predlogi (company_id, status, za_direktorja, za_matjaza, opozorila, vhod, model, created_at, koncano_at)
   VALUES ($1, 'ok', $2, $3, $4::jsonb, '{"odgovori": 1, "seje": 0}'::jsonb, 'claude-opus-5-5', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')`,
  [cid, D1, D2, JSON.stringify(['Dokument za direktorja navaja številke, ki jih v gradivu ni: »15 ur«.'])],
);
r = await api(`/api/companies/${cid}/prodajni-predlog`);
t('GET: predlog je zadnji uspesni, tek je novejsa napaka',
  r.telo.predlog?.status === 'ok' && r.telo.predlog.za_direktorja === D1 && r.telo.tek?.status === 'napaka',
  JSON.stringify({ p: r.telo.predlog?.status, t: r.telo.tek?.status }));
const pdf = await api(`/api/companies/${cid}/prodajni-predlog/pdf`);
t('PDF za direktorja: application/pdf, ime datoteke', pdf.status === 200 && pdf.tip.includes('application/pdf')
  && /hotel-predlog-test-\d+-predlog-ai-procesov-\d{4}-\d{2}-\d{2}\.pdf/.test(pdf.disp), `${pdf.status} ${pdf.tip} ${pdf.disp}`);

// ── 5. Stran podjetja ────────────────────────────────────────────────────
console.log('\n=== 5. Stran podjetja ===');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const context = browser.defaultBrowserContext();
await context.overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
const page = await browser.newPage();
await page.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });
const napake = [];
page.on('pageerror', e => napake.push(e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (/favicon/.test((m.location()?.url || '') + m.text())) return;   // obstojeca lastnost vseh strani
  napake.push(m.text());
});
page.on('dialog', d => d.accept());
await page.setViewport({ width: 1400, height: 1000 });
await page.goto(`${BASE}/admin/company.html?id=${cid}`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#prodajni-predlog .pp-dok', { timeout: 8000 }).catch(() => {});

let s = await page.evaluate(() => {
  const p = document.getElementById('prodajni-predlog');
  const tab = (d) => p.querySelector(`[data-dok="${d}"]`);
  const box = (el) => el?.getBoundingClientRect();
  return {
    glava: [...document.querySelectorAll('#header .e-actions > *')].map(e => `${e.className}:${e.textContent.trim()}`),
    oznaka: p.querySelector('.lbl')?.textContent,
    pod: p.querySelector('.e-feature-sub')?.textContent.trim(),
    zavihki: [tab('direktor')?.textContent, tab('matjaz')?.textContent],
    aktiven: p.querySelector('[data-dok].active')?.dataset.dok,
    dok: p.querySelector('.pp-dok')?.textContent || '',
    opozorila: p.querySelector('#pp-opozorila')?.textContent || '',
    napaka: p.querySelector('#pp-napaka')?.textContent || '',
    pdf: p.querySelector('#pp-pdf')?.getAttribute('href'),
    gumbi: [...p.querySelectorAll('.e-feature-actions button, .e-feature-actions a')].filter(b => !b.hidden).map(b => b.textContent.trim()),
    delavnica: document.querySelector('#delavnica h2')?.textContent,
    delavnicaPod: document.querySelector('#delavnica .desc')?.textContent || '',
    predlogY: box(p).top, delavnicaY: box(document.getElementById('delavnica')).top,
    stranX: box(document.querySelector('.pp-stran')).left, predlogX: box(p).left,
    opombe: !!document.querySelector('.pp-stran #opombe'),
  };
});
t('glava: Prodajni predlog (glavni), ZIP (mehki), nazaj',
  JSON.stringify(s.glava) === JSON.stringify(['e-btn:Prodajni predlog', 'e-btn-soft:Izvoz za Claude (ZIP)', 'e-btn-soft:← Vsa podjetja']), JSON.stringify(s.glava));
t('kartica Prodajni predlog s podnaslovom iz cesa je nastal',
  s.oznaka === 'Prodajni predlog' && /^Pripravljeno \d+\. \d+\. \d{4} iz 1 odgovora in 0 zapisov sestankov$/.test(s.pod), s.pod);
t('zavihka Za direktorja / Za Matjaža, aktiven direktor', s.zavihki.join('|') === 'Za direktorja|Za Matjaža' && s.aktiven === 'direktor');
t('dokument za direktorja izrisan', s.dok.includes('Rezervacije iz e-pošte') && !s.dok.includes('Petra Novak'));
t('opozorila nad dokumentom za direktorja', s.opozorila.includes('Preverite pred pošiljanjem') && s.opozorila.includes('15 ur'), s.opozorila);
t('novejsa neuspela priprava je vidna', s.napaka.includes('Zadnja priprava ni uspela'), s.napaka);
t('PDF povezava', s.pdf === `/api/companies/${cid}/prodajni-predlog/pdf`);
t('akcije: Pripravi znova, PDF, Kopiraj', ['Pripravi znova', 'Natisni / PDF za direktorja', 'Kopiraj'].every(g => s.gumbi.includes(g)), JSON.stringify(s.gumbi));
t('priprava na delavnico pod predlogom', s.delavnica === 'Priprava na delavnico' && s.delavnicaY > s.predlogY && s.delavnicaPod.includes('AI priporočila · Test predloga'), JSON.stringify([s.delavnica, s.delavnicaPod]));
t('stranski stolpec desno z opombami', s.stranX > s.predlogX && s.opombe);

await page.click('#prodajni-predlog [data-dok="matjaz"]');
s = await page.evaluate(() => ({
  aktiven: document.querySelector('#prodajni-predlog [data-dok].active')?.dataset.dok,
  dok: document.querySelector('#prodajni-predlog .pp-dok')?.textContent || '',
  opozorila: !!document.getElementById('pp-opozorila'),
}));
t('zavihek Za Matjaža: interni list, brez opozoril za direktorja', s.aktiven === 'matjaz' && s.dok.includes('Petra Novak je zagovornica') && !s.opozorila, JSON.stringify(s));

await page.click('#pp-kopiraj');
await pocakaj(300);
const kopirano = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
const gumbKop = await page.$eval('#pp-kopiraj', b => b.textContent);
// Windowsovo odlozisce vrne vrstice s CRLF.
t('Kopiraj: Markdown aktivnega dokumenta v odlozisce', String(kopirano).replace(/\r\n/g, '\n') === D2 && gumbKop === 'Kopirano', `${gumbKop} | ${String(kopirano).slice(0, 60)}`);

const preliv = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
t('namizje: brez vodoravnega prelivanja', preliv <= 1, `${preliv}px`);

// Pripravi znova: potrdi, POST, pasica "Pripravljam", nato brez AI napaka.
// Prejsnji tek je ze napaka "AI se ni odzval", zato cakamo na NOVO vrstico.
await page.click('#prodajni-predlog [data-dok="direktor"]');
const predKlikom = (await pool.query('SELECT max(id)::int AS id FROM prodajni_predlogi WHERE company_id = $1', [cid])).rows[0].id;
await page.click('#pp-pripravi');
let nova = null;
for (let i = 0; i < 40 && !nova; i++) {
  await pocakaj(250);
  nova = (await pool.query('SELECT id, status FROM prodajni_predlogi WHERE company_id = $1 AND id > $2', [cid, predKlikom])).rows[0] || null;
}
t('Pripravi znova (po potrditvi) ustvari novo pripravo', !!nova, String(predKlikom));
const sliPasica = await page.waitForSelector('#pp-tece', { timeout: 3000 }).then(() => true).catch(() => false);
t('med pripravo pasica "Pripravljam novo različico"', sliPasica || nova?.status === 'napaka');
await page.waitForFunction(() => !document.getElementById('pp-tece') && document.getElementById('pp-napaka'), { timeout: 15000 }).catch(() => {});
s = await page.evaluate(() => ({
  napaka: document.getElementById('pp-napaka')?.textContent || '',
  dok: !!document.querySelector('#prodajni-predlog .pp-dok'),
  tece: !!document.getElementById('pp-tece'),
  gumb: document.getElementById('pp-pripravi')?.disabled,
}));
t('po koncu priprave stran sama pokaze napako, prejsnji predlog ostane, gumb spet dela',
  s.napaka.includes('AI se ni odzval') && s.dok && !s.tece && s.gumb === false, JSON.stringify(s));

// Prazno stanje
await page.goto(`${BASE}/admin/company.html?id=${cidPrazno}`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#pp-pripravi', { timeout: 8000 }).catch(() => {});
s = await page.evaluate(() => {
  const p = document.getElementById('prodajni-predlog');
  return {
    naslov: p.querySelector('.e-reco-prazno b')?.textContent,
    besedilo: p.querySelector('.e-reco-prazno p')?.textContent || '',
    gumb: p.querySelector('#pp-pripravi')?.textContent,
    zavihki: p.querySelectorAll('[data-dok]').length,
    akcije: !!p.querySelector('.e-feature-actions'),
  };
});
t('prazno stanje: naslov, stevci, gumb', s.naslov === 'Prodajni predlog še ni pripravljen'
  && s.besedilo.includes('vse odgovore tega podjetja (1), zapise sestankov (0)') && s.gumb === 'Pripravi prodajni predlog'
  && s.zavihki === 0 && !s.akcije, JSON.stringify(s));

// Telefon
await page.goto(`${BASE}/admin/company.html?id=${cid}`, { waitUntil: 'networkidle0' });
await page.setViewport({ width: 390, height: 844 });
await pocakaj(600);
s = await page.evaluate(() => {
  const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
  const zav = [...document.querySelectorAll('#prodajni-predlog [data-dok]')].map(b => b.getBoundingClientRect().width);
  const sw = document.querySelector('#prodajni-predlog .e-switch')?.getBoundingClientRect().width || 0;
  const p = document.getElementById('prodajni-predlog').getBoundingClientRect();
  return {
    preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    predlog: y('#prodajni-predlog'), opombe: y('.pp-stran'), delavnica: y('#delavnica'),
    zavihkiSirina: zav.reduce((a, b) => a + b, 0), sw, pw: p.width,
  };
});
t('telefon: brez vodoravnega prelivanja', s.preliv <= 1, `${s.preliv}px`);
t('telefon: predlog, nato opombe, nato delavnica', s.predlog < s.opombe && s.opombe < s.delavnica, JSON.stringify(s));
t('telefon: zavihka cez vso sirino kartice', s.sw > s.pw * 0.8, `${s.sw} od ${s.pw}`);

t('brez JS napak na strani', napake.length === 0, JSON.stringify(napake.slice(0, 3)));

// ── 6. Zapis sestanka: povezava s podjetjem ──────────────────────────────
console.log('\n=== 6. Zapis sestanka: izbira podjetja ===');
const predloge = (await api('/api/procesi/predloge')).telo.predloge;
r = await api('/api/procesi/seje', {
  method: 'POST',
  body: JSON.stringify({ questionnaire_id: predloge[0].id, stranka_naziv: PODJETJE, proces: 'Rezervacije' }),
});
const sejaId = r.telo?.seja?.id;
t('seja ustvarjena brez podjetja', Number.isInteger(sejaId), JSON.stringify(r.telo));

await page.setViewport({ width: 1400, height: 1000 });
await page.goto(`${BASE}/admin/proces-seja.html?id=${sejaId}`, { waitUntil: 'networkidle0' });
await pocakaj(500);
s = await page.evaluate(() => ({
  moznosti: [...document.querySelectorAll('#mPodjetje option')].map(o => o.textContent),
  vrednost: document.getElementById('mPodjetje').value,
  namig: document.getElementById('mPodjetjeNamig').textContent,
}));
t('izbira podjetja: "Ni izbrano" in podjetja iz baze', s.moznosti[0] === 'Ni izbrano' && s.moznosti.includes(PODJETJE) && s.vrednost === '', JSON.stringify(s.moznosti.slice(0, 4)));
t('opozorilo, ko podjetje ni izbrano', s.namig.includes('prodajni predlog ne vidi'), s.namig);

await page.select('#mPodjetje', String(cid));
await pocakaj(1800);
const seja = (await api(`/api/procesi/seje/${sejaId}`)).telo.seja;
const namig = await page.$eval('#mPodjetjeNamig', n => n.textContent);
t('izbira se shrani v sejo (company_id)', seja?.company_id === cid, JSON.stringify(seja?.company_id));
t('namig po izbiri: povezava na podjetje', namig.includes('Odpri podjetje'), namig);
r = await api(`/api/companies/${cid}/prodajni-predlog`);
t('podjetje zdaj steje zapis sestanka', r.telo.gradivo?.seje === 1, JSON.stringify(r.telo.gradivo));

await page.goto(`${BASE}/admin/proces-seja.html?id=${sejaId}`, { waitUntil: 'networkidle0' });
await pocakaj(500);
t('po ponovnem nalaganju je podjetje izbrano', await page.$eval('#mPodjetje', e => e.value) === String(cid));

await browser.close();
await pool.end();

console.log(`\n${'─'.repeat(46)}\nOK: ${ok}   FAIL: ${fail}`);
if (padli.length) console.log('Padli:\n  - ' + padli.join('\n  - '));
process.exit(fail ? 1 : 0);
