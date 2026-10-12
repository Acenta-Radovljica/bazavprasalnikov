// Popis opravil: javni obrazec /popis/:koda, oddaje, zamenjava povezave,
// kartica na strani podjetja in namig v prodajnem predlogu. Brez AI klicev.
//
// Zagon: node test/reset-testne-baze.mjs && node test/popis-api.test.mjs
// (TEST_BASE in TEST_DB_URL kot pri ostalih naborih, glej README)
import puppeteer from 'puppeteer-core';
import { VPRASANJA, opravilaPodjetja, skupajMinut, besediloUr } from '../public/admin/popis.js';

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
  const r = await fetch(BASE + pot, { ...opt, headers: { Authorization: AUTH, 'content-type': 'application/json', ...(opt.headers || {}) } });
  const besedilo = await r.text();
  let telo = null;
  try { telo = JSON.parse(besedilo); } catch { telo = besedilo; }
  return { status: r.status, telo, glave: r.headers };
}
async function javno(pot, telo) {
  const r = await fetch(BASE + pot, telo === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(telo) });
  const besedilo = await r.text();
  let json = null;
  try { json = JSON.parse(besedilo); } catch { /* html */ }
  return { status: r.status, besedilo, json, glave: r.headers };
}

const pg = (await import('pg')).default;
const pool = new pg.Pool({ connectionString: process.env.TEST_DB_URL || 'postgres://postgres:test@127.0.0.1:5435/vprasalniki' });

const oznaka = String(Date.now() % 1000000);
const IME = `Hotel Smrekov gaj ${oznaka}`;
const PRAZNO = `Penzion Brez Popisa ${oznaka}`;

// ── 1. Priprava ──────────────────────────────────────────────────────────
console.log('\n=== 1. Podjetje in koda ===');
const nov = async (naziv) => (await pool.query(
  `INSERT INTO companies (naziv_prikaz, naziv_normaliziran, status) VALUES ($1, lower($1), 'nov') RETURNING id, popis_koda`, [naziv])).rows[0];
const c = await nov(IME);
const cPrazno = await nov(PRAZNO);
t('novo podjetje dobi kodo (12 hex)', /^[a-f0-9]{12}$/.test(c.popis_koda), c.popis_koda);
t('kodi sta različni', c.popis_koda !== cPrazno.popis_koda);
let r = await api(`/api/companies/${c.id}`);
t('API podjetja vrne kodo', r.telo?.company?.popis_koda === c.popis_koda);
let koda = c.popis_koda;

// ── 2. Javni obrazec ─────────────────────────────────────────────────────
console.log('\n=== 2. Javni obrazec ===');
let j = await javno(`/popis/${koda}`);
t('GET /popis/:koda = 200 HTML', j.status === 200 && /text\/html/.test(j.glave.get('content-type') || ''), j.status);
t('naziv podjetja na strani', j.besedilo.includes(`za podjetje ${IME}`));
t('brez indeksiranja in predpomnilnika', j.glave.get('x-robots-tag') === 'noindex, nofollow' && /no-store/.test(j.glave.get('cache-control') || ''));
t('vprašanja 1 do 7 iz načrta', ['1. Vaše delovno mesto ali oddelek', '2. Opišite opravilo', '3. Kako pogosto ga opravljate?', '4. Koliko časa vam vzame vsakič?', '5. Kako ga opravljate danes?', '6. Kaj bi moral narediti pomočnik', '7. Ime in priimek (neobvezno)'].every(s => j.besedilo.includes(s)));
t('uvod in soglasje', j.besedilo.includes('Izpolnjevanje traja 3 do 4 minute') && j.besedilo.includes('Podatkov ne posredujemo tretjim osebam'));
t('kontakt ai@acenta.si', j.besedilo.includes('mailto:ai@acenta.si'));
j = await javno('/popis/000000000000');
t('neznana koda: 404 z besedilom', j.status === 404 && j.besedilo.includes('Ta povezava ne velja več'));
j = await javno('/popis/ni-koda');
t('napačna oblika kode: 404', j.status === 404);
j = await javno('/f/popis-opravil');
t('/f/popis-opravil je zaprt', j.status === 404 && j.besedilo.includes('Povezava ni popolna'), j.status);
j = await javno('/f/popis-opravil', { gdpr_consent: true, delovno_mesto: 'X' });
t('POST /f/popis-opravil zavrnjen', j.status === 404 && j.json?.error === 'not_found');

// ── 3. Oddaje ────────────────────────────────────────────────────────────
console.log('\n=== 3. Oddaje ===');
const osnova = { gdpr_consent: true, delovno_mesto: 'Recepcija', o1_opis: 'Prepisovanje rezervacij iz e-pošte v sistem', o1_pogostost: 'Vsak dan', o1_cas: '15 do 60 minut' };
j = await javno(`/popis/${koda}`, { ...osnova, gdpr_consent: false });
t('brez soglasja 400', j.status === 400 && j.json?.error === 'gdpr_consent_required');
j = await javno(`/popis/${koda}`, { ...osnova, delovno_mesto: '' });
t('brez oddelka 400 manjka', j.status === 400 && j.json?.error === 'manjka' && j.json?.polje === 'delovno_mesto');
j = await javno(`/popis/${koda}`, { ...osnova, o1_pogostost: 'Vsako uro' });
t('neveljavna pogostost 400', j.status === 400 && j.json?.error === 'neveljavno');
j = await javno(`/popis/${koda}`, { ...osnova, o2_cas: '1 do 3 ure' });
t('začeto drugo opravilo brez opisa 400', j.status === 400 && j.json?.polje === 'o2_opis');
j = await javno(`/popis/${koda}`, { ...osnova, company_url: 'http://spam' });
t('honeypot: ok, a ni shranjeno', j.status === 200 && j.json?.ok);
j = await javno(`/popis/${koda}`, {
  ...osnova, o1_kako: ['E-pošta', 'Naš informacijski sistem'], o1_pomocnik: 'Naj sam prebere e-pošto.', ime: 'Ana Kos',
  o2_opis: 'Urnik izmen', o2_pogostost: 'Enkrat na teden', o2_cas: '1 do 3 ure', vdor: 'x',
});
t('veljavna oddaja z dvema opraviloma', j.status === 200 && j.json?.ok, JSON.stringify(j.json));
j = await javno(`/popis/${koda}`, { ...osnova });
t('druga oddaja (brez imena)', j.status === 200 && j.json?.ok);
j = await javno(`/popis/${koda}`, { gdpr_consent: true, delovno_mesto: 'Prodaja', o1_opis: 'Priprava ponudb za skupine', o1_pogostost: 'Večkrat na teden', o1_cas: '1 do 3 ure', ime: 'Tina Rozman' });
t('tretja oddaja (prodaja)', j.status === 200 && j.json?.ok);

const shranjeno = (await pool.query(
  `SELECT r.*, q.slug FROM responses r JOIN questionnaires q ON q.id = r.questionnaire_id WHERE r.company_id = $1 ORDER BY r.id`, [c.id])).rows;
t('shranjeni trije odgovori (honeypot ne)', shranjeno.length === 3, shranjeno.length);
t('vprašalnik popis-opravil, soglasje, kopija vprašanj', shranjeno.every(s => s.slug === 'popis-opravil' && s.consent_gdpr && s.questions_snapshot?.length === VPRASANJA.length));
t('samo znana polja', !('vdor' in shranjeno[0].raw_data) && !('gdpr_consent' in shranjeno[0].raw_data) && shranjeno[0].raw_data.o1_kako.length === 2, JSON.stringify(shranjeno[0].raw_data));
t('last_response_at nastavljen', !!(await pool.query('SELECT last_response_at FROM companies WHERE id = $1', [c.id])).rows[0].last_response_at);

// ── 4. Zamenjava povezave ────────────────────────────────────────────────
console.log('\n=== 4. Zamenjaj povezavo ===');
r = await api(`/api/companies/${c.id}/popis-koda`, { method: 'POST' });
t('nova koda', r.status === 200 && /^[a-f0-9]{12}$/.test(r.telo?.popis_koda) && r.telo.popis_koda !== koda, JSON.stringify(r.telo));
const stara = koda;
koda = r.telo.popis_koda;
t('stara povezava ne velja', (await javno(`/popis/${stara}`)).status === 404);
t('oddaja na staro 404', (await javno(`/popis/${stara}`, osnova)).status === 404);
t('nova povezava velja', (await javno(`/popis/${koda}`)).status === 200);
t('odgovori ostanejo', (await pool.query('SELECT count(*)::int n FROM responses WHERE company_id = $1', [c.id])).rows[0].n === 3);
t('zamenjava brez prijave 401', (await fetch(`${BASE}/api/companies/${c.id}/popis-koda`, { method: 'POST' })).status === 401);
t('zamenjava neznanega podjetja 404', (await api('/api/companies/99999999/popis-koda', { method: 'POST' })).status === 404);

// ── 5. Brskalnik: obrazec na telefonu ────────────────────────────────────
console.log('\n=== 5. Obrazec v brskalniku (390 px) ===');
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const ctx = b.defaultBrowserContext();
await ctx.overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
let p = await b.newPage();
const napake = [];
p.on('pageerror', e => napake.push(e.message));
await p.setViewport({ width: 390, height: 844 });
await p.goto(`${BASE}/popis/${koda}`, { waitUntil: 'networkidle0' });
const preliv = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
t('brez vodoravnega drsenja', await preliv() <= 0, await preliv());
t('vidno samo prvo opravilo', await p.evaluate(() => !document.getElementById('sklop-1').hidden && document.getElementById('sklop-2').hidden && document.getElementById('sklop-3').hidden));

await p.click('#poslji');
await pocakaj(200);
t('prazna oddaja: napaka in fokus na oddelku', await p.evaluate(() => document.getElementById('err').classList.contains('is-on') && document.activeElement?.id === 'delovno_mesto'));

await p.type('#delovno_mesto', 'Kuhinja');
await p.type('#o1_opis', 'Naročanje živil pri dobaviteljih');
await p.click('input[name="o1_pogostost"][value="Večkrat na teden"]');
await p.click('input[name="o1_cas"][value="15 do 60 minut"]');
await p.click('input[name="o1_kako"][value="E-pošta"]');
await p.click('input[name="o1_kako"][value="Papir"]');
t('izbrana možnost je poudarjena', await p.evaluate(() => getComputedStyle(document.querySelector('input[name="o1_pogostost"]:checked').closest('.opt')).backgroundColor !== getComputedStyle(document.querySelector('input[name="o1_pogostost"]:not(:checked)').closest('.opt')).backgroundColor));
await p.click('#dodaj-2');
t('drugo opravilo se odpre, gumb za tretje se pokaže', await p.evaluate(() => !document.getElementById('sklop-2').hidden && document.getElementById('dodaj-2').hidden && !document.getElementById('dodaj-3').hidden));
await p.type('#o2_opis', 'Popis zaloge');
await p.click('#poslji');
await pocakaj(200);
t('drugo opravilo brez pogostosti: napaka pred oddajo', await p.evaluate(() => document.getElementById('err').classList.contains('is-on')));
await p.click('input[name="o2_pogostost"][value="Enkrat na mesec"]');
await p.click('input[name="o2_cas"][value="Več kot 3 ure"]');
await p.click('#poslji');
await pocakaj(200);
t('brez soglasja: napaka', await p.evaluate(() => /soglasje/.test(document.getElementById('err').textContent)));
await p.click('#gdpr');
await p.click('#poslji');
await p.waitForSelector('#hvala:not([hidden])', { timeout: 5000 }).catch(() => {});
t('zahvala po oddaji', await p.evaluate(() => !document.getElementById('hvala').hidden && document.getElementById('popis').hidden));
t('besedilo zahvale', await p.evaluate(() => document.getElementById('hvala').innerText.includes('Hvala, vaš odgovor je shranjen.') && document.getElementById('hvala').innerText.includes('Opiši še eno opravilo')));
await p.click('#znova');
await pocakaj(150);
t('nov odgovor: oddelek ostane, opravila prazna, drugo skrito', await p.evaluate(() =>
  document.getElementById('delovno_mesto').value === 'Kuhinja' && document.getElementById('o1_opis').value === ''
  && !document.querySelector('input[name="o1_pogostost"]:checked') && document.getElementById('sklop-2').hidden
  && !document.getElementById('dodaj-2').hidden && document.getElementById('gdpr').checked));
t('brez JS napak na obrazcu', napake.length === 0, napake.join(' | '));
const kuhinja = (await pool.query(`SELECT raw_data FROM responses WHERE company_id = $1 AND raw_data->>'delovno_mesto' = 'Kuhinja'`, [c.id])).rows[0]?.raw_data;
t('oddaja iz brskalnika shranjena z dvema opraviloma', kuhinja?.o2_opis === 'Popis zaloge' && kuhinja?.o1_kako?.join() === 'E-pošta,Papir', JSON.stringify(kuhinja));
await p.goto(`${BASE}/popis/000000000000`, { waitUntil: 'networkidle0' });
t('neveljavna povezava brez prelivanja', (await preliv()) <= 0 && (await p.evaluate(() => document.body.innerText.includes('Prosite vodstvo za novo povezavo'))));
await p.close();

// ── 6. Stran podjetja: kartica ───────────────────────────────────────────
console.log('\n=== 6. Kartica Popis opravil ===');
const vsi = (await pool.query(
  `SELECT r.id, r.submitted_at, r.raw_data FROM responses r WHERE r.company_id = $1`, [c.id])).rows;
const opravila = opravilaPodjetja(vsi);
const skupajPricakovano = `Skupaj ${besediloUr(skupajMinut(opravila))}`;

p = await b.newPage();
const napakeP = [];
p.on('pageerror', e => napakeP.push(e.message));
await p.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });
await p.setViewport({ width: 1440, height: 1000 });
await p.goto(`${BASE}/admin/company.html?id=${c.id}`, { waitUntil: 'networkidle0' });
await p.waitForSelector('#popis-tabela', { timeout: 5000 }).catch(() => {});
const kartica = await p.evaluate(() => {
  const el = document.getElementById('popis-opravil');
  const doc = document.getElementById('prodajni-predlog').getBoundingClientRect();
  const k = el.getBoundingClientRect();
  return {
    naslov: el.querySelector('h2')?.textContent,
    meta: el.querySelector('.popis__title p')?.textContent,
    skupaj: el.querySelector('#popis-skupaj')?.textContent,
    povezava: el.querySelector('#popis-povezava')?.textContent,
    glave: [...el.querySelectorAll('thead th')].map(x => x.textContent.trim()),
    vrstice: [...el.querySelectorAll('tbody tr')].map(tr => ({ opis: tr.querySelector('.popis__opis')?.textContent, ure: tr.querySelector('.popis__ure')?.textContent, sub: tr.querySelector('.table__sub.hide-m')?.textContent })),
    gumbi: [...el.querySelectorAll('.popis__acts button')].map(x => x.textContent.trim()),
    podPredlogom: k.top > doc.bottom && Math.abs(k.left - doc.left) < 2,
    sirina: Math.round(k.width),
  };
});
t('kartica pod prodajnim predlogom v levem stolpcu', kartica.podPredlogom && kartica.sirina < 1000, JSON.stringify({ s: kartica.sirina }));
t('naslov in meta', kartica.naslov === 'Popis opravil' && /^4 odgovori · 6 opravil · zadnji \d+\. \d+\.$/.test(kartica.meta || ''), kartica.meta);
t('skupne ure kot v pravilu', kartica.skupaj === skupajPricakovano, `${kartica.skupaj} vs ${skupajPricakovano}`);
t('povezava z novo kodo', kartica.povezava?.endsWith(`/popis/${koda}`), kartica.povezava);
t('štirje stolpci', kartica.glave.join('|') === 'Opravilo|Kako pogosto|Čas vsakič|Ur na mesec', kartica.glave.join('|'));
t('šest vrstic, razvrščeno po urah', kartica.vrstice.length === 6 && kartica.vrstice.every((v, i, a) => !i || Number(a[i - 1].ure) >= Number(v.ure)), JSON.stringify(kartica.vrstice.map(v => v.ure)));
t('prva vrstica: ponudbe 20 ur, Prodaja · Tina Rozman', kartica.vrstice[0]?.opis === 'Priprava ponudb za skupine' && kartica.vrstice[0]?.ure === '20' && kartica.vrstice[0]?.sub === 'Prodaja · Tina Rozman', JSON.stringify(kartica.vrstice[0]));
t('brez imena označeno', kartica.vrstice.some(v => v.sub === 'Recepcija · brez imena'));
t('gumba Kopiraj in Zamenjaj', kartica.gumbi.join('|') === 'Kopiraj povezavo za zaposlene|Zamenjaj povezavo', kartica.gumbi.join('|'));

await p.click('#popis-kopiraj');
await pocakaj(150);
const odlozisce = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
t('kopiraj: povezava v odložišču', odlozisce.endsWith(`/popis/${koda}`), odlozisce);
t('kopiraj: oznaka gumba', await p.evaluate(() => document.querySelector('#popis-kopiraj span').textContent === 'Povezava kopirana'));

p.once('dialog', d => d.accept());
await p.click('#popis-zamenjaj');
await pocakaj(600);
const novaKoda = (await pool.query('SELECT popis_koda FROM companies WHERE id = $1', [c.id])).rows[0].popis_koda;
t('zamenjaj: nova koda v bazi in na kartici', novaKoda !== koda && (await p.evaluate(() => document.getElementById('popis-povezava').textContent)).endsWith(`/popis/${novaKoda}`));
p.once('dialog', d => d.dismiss());
await p.click('#popis-zamenjaj');
await pocakaj(400);
t('zamenjaj preklicano: koda ostane', (await pool.query('SELECT popis_koda FROM companies WHERE id = $1', [c.id])).rows[0].popis_koda === novaKoda);
koda = novaKoda;

await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), p.click('#popis-tabela tbody tr td.popis__c-pog')]);
t('klik na vrstico odpre odgovor', /\/admin\/response\.html\?id=\d+$/.test(p.url()), p.url());
t('stran odgovora pokaže vprašanja popisa', await p.evaluate(() => document.body.innerText.includes('Kako pogosto ga opravljate?') && document.body.innerText.includes('Opravilo 1')));
t('brez JS napak (podjetje, odgovor)', napakeP.length === 0, napakeP.join(' | '));

// Prazno stanje
await p.goto(`${BASE}/admin/company.html?id=${cPrazno.id}`, { waitUntil: 'networkidle0' });
await pocakaj(300);
const prazna = await p.evaluate(() => {
  const el = document.getElementById('popis-opravil');
  return { besedilo: el.innerText, tabela: !!el.querySelector('table'), gumbi: [...el.querySelectorAll('button')].map(x => x.textContent.trim()), povezavaSkrita: el.querySelector('#popis-povezava')?.hidden };
});
t('prazno stanje: besedilo', prazna.besedilo.includes('Še noben zaposleni ni izpolnil popisa'));
t('prazno stanje: samo Kopiraj, brez tabele', !prazna.tabela && prazna.gumbi.join('|') === 'Kopiraj povezavo za zaposlene' && prazna.povezavaSkrita, JSON.stringify(prazna));

// Telefon
await p.setViewport({ width: 390, height: 844 });
await p.goto(`${BASE}/admin/company.html?id=${c.id}`, { waitUntil: 'networkidle0' });
await p.waitForSelector('#popis-tabela', { timeout: 5000 }).catch(() => {});
const tel = await p.evaluate(() => {
  const el = document.getElementById('popis-opravil');
  const tr = el.querySelector('tbody tr');
  const gumbi = [...el.querySelectorAll('.popis__acts button')].map(x => Math.round(x.getBoundingClientRect().width));
  return {
    preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    glavaSkrita: getComputedStyle(el.querySelector('thead')).display === 'none',
    vrstica: getComputedStyle(tr).display,
    sub: tr.querySelector('.table__sub.only-m')?.textContent,
    subNamizje: getComputedStyle(tr.querySelector('.table__sub.hide-m')).display,
    enota: getComputedStyle(tr.querySelector('.popis__enota')).display,
    gumbi, sirina: Math.round(el.getBoundingClientRect().width),
    poPredlogu: el.getBoundingClientRect().top > document.getElementById('prodajni-predlog').getBoundingClientRect().bottom
      && el.getBoundingClientRect().bottom < document.querySelector('.a-props').getBoundingClientRect().top,
  };
});
t('telefon: brez prelivanja', tel.preliv <= 0, tel.preliv);
t('telefon: vrstice kot kartice', tel.glavaSkrita && tel.vrstica === 'grid' && tel.enota === 'block' && tel.subNamizje === 'none', JSON.stringify(tel));
t('telefon: pod opravilom oddelek · pogostost · čas', tel.sub === 'Prodaja · Večkrat na teden · 1 do 3 ure', tel.sub);
t('telefon: gumba čez celo širino', tel.gumbi.length === 2 && tel.gumbi.every(w => w > tel.sirina - 60), JSON.stringify(tel.gumbi));
t('telefon: kartica takoj pod predlogom, pred lastnostmi', tel.poPredlogu);

// ── 7. Namig v prodajnem predlogu ────────────────────────────────────────
console.log('\n=== 7. Namig o novih odgovorih ===');
await pool.query(
  `INSERT INTO prodajni_predlogi (company_id, status, za_direktorja, za_matjaza, opozorila, vhod, created_at, koncano_at)
   VALUES ($1, 'ok', '### 1. Test (recepcija)\n- »citat iz gradiva«', '- odpri', '[]', '{"odgovori":2,"seje":0}', $2, $2)`,
  [c.id, new Date(Date.now() - 3600000).toISOString()],
);
// Dva odgovora mlajsa od predloga: ostala dva postarimo.
await pool.query(`UPDATE responses SET submitted_at = NOW() - INTERVAL '2 hours' WHERE id IN (SELECT id FROM responses WHERE company_id = $1 ORDER BY id LIMIT 2)`, [c.id]);
await p.setViewport({ width: 1440, height: 1000 });
await p.goto(`${BASE}/admin/company.html?id=${c.id}`, { waitUntil: 'networkidle0' });
await p.waitForSelector('#pp-novi-popisi', { timeout: 5000 }).catch(() => {});
const namig = await p.evaluate(() => document.getElementById('pp-novi-popisi')?.innerText || '');
t('namig: dvojina', namig.includes('Od zadnje priprave sta prišla 2 nova odgovora na Popis opravil.'), namig);
t('namig: Pripravi znova', namig.includes('Pripravi znova'));
p.once('dialog', d => d.dismiss());
await p.click('#pp-pripravi-novi');
await pocakaj(300);
t('Pripravi znova vpraša za potrditev (preklicano: nič se ne zgodi)', (await pool.query(`SELECT count(*)::int n FROM prodajni_predlogi WHERE company_id = $1`, [c.id])).rows[0].n === 1);
await pool.query(`UPDATE prodajni_predlogi SET created_at = NOW() + INTERVAL '1 minute' WHERE company_id = $1`, [c.id]);
await p.reload({ waitUntil: 'networkidle0' });
await pocakaj(300);
t('brez novih odgovorov ni namiga', !(await p.$('#pp-novi-popisi')));

// ── 8. Izvoz ─────────────────────────────────────────────────────────────
console.log('\n=== 8. Izvoz ===');
r = await api(`/api/companies/${c.id}/izvoz`);
t('izvoz vrne odgovore popisa', r.telo?.responses?.filter(x => x.q_slug === 'popis-opravil').length === 4);
const datoteke = await p.evaluate(async (cid) => {
  const data = await apiFetch(`/api/companies/${cid}/izvoz`);
  const { sestaviDatoteke } = await import('/admin/izvoz.js');
  return sestaviDatoteke(data, { vprasanjaZa: vprasanjaZaPrikaz, izpolnjevalec }).map(d => ({ ime: d.ime, vsebina: d.vsebina }));
}, c.id);
const d03 = datoteke.find(d => d.ime.endsWith('/03-popis-opravil.md'));
t('paket v brskalniku ima 03-popis-opravil.md', !!d03 && d03.vsebina.includes('### O1 · '));
t('odgovori popisa imajo ime in oddelek', datoteke.some(d => /odgovori\/\d\d-.*popis-opravil-ana-kos\.md$/.test(d.ime)), datoteke.map(d => d.ime).join(' '));

await b.close();
await pool.query('DELETE FROM prodajni_predlogi WHERE company_id = ANY($1)', [[c.id, cPrazno.id]]);
await pool.query('DELETE FROM responses WHERE company_id = ANY($1)', [[c.id, cPrazno.id]]);
await pool.query('DELETE FROM companies WHERE id = ANY($1)', [[c.id, cPrazno.id]]);
await pool.end();

console.log(`\n${'─'.repeat(46)}\nOK: ${ok}   FAIL: ${fail}`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
