// Izvoz podjetja za Claude: GET /api/companies/:id/izvoz + gumb na strani podjetja.
//
// Podatki gredo skozi prave poti (javni obrazec, procesna seja, transkript),
// samo AI Business Score in AI priporocila se vpiseta neposredno v bazo, ker
// ju sicer naredi AI. Nosilna trditev: odgovor na custom_html obrazcu pride v
// ZIP pod besedilom vprasanja iz obrazca, ne pod imenom polja.
//
// Zagon: node test/reset-testne-baze.mjs && node test/izvoz-api.test.mjs
// (TEST_BASE in TEST_DB_URL kot pri ostalih naborih, glej README)
import puppeteer from 'puppeteer-core';
import { izracunajScore } from '../src/score/izracunaj.js';
import { VPRASANJA as V1, VELIKOST } from '../src/score/vprasanja-v1.js';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3399';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const AUTH = 'Basic ' + Buffer.from('test@acenta.si:testgeslo123').toString('base64');

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

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
const oddaj = (slug, telo) => fetch(`${BASE}/f/${slug}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(telo),
}).then(r => r.json().catch(() => ({})));

const pg = (await import('pg')).default;
const pool = new pg.Pool({ connectionString: process.env.TEST_DB_URL || 'postgres://postgres:test@127.0.0.1:5435/vprasalniki' });

const oznaka = String(Date.now() % 1000000);
const PODJETJE = `Hotel Izvozni Test ${oznaka}`;

// ── 1. Priprava ──────────────────────────────────────────────────────────
console.log('\n=== 1. Priprava podatkov ===');
let r = await api('/api/questionnaires', {
  method: 'POST',
  body: JSON.stringify({
    slug: `test-izvoz-a-${oznaka}`, naziv_prikaz: 'Test izvoza A', namen: 'shramba', aktivna: true,
    questions: [
      { id: 'podjetje', label: 'Naziv podjetja', tip: 'text', obvezno: true },
      { id: 'ime', label: 'Ime in priimek', tip: 'text' },
      { id: 'bolecina', label: 'Katero opravilo vam vzame največ časa?', tip: 'textarea' },
      { id: 'pogostost', label: 'Kako pogosto?', tip: 'radio', options: ['Dnevno', 'Tedensko'] },
    ],
  }),
});
const qA = r.telo?.questionnaire?.id ?? r.telo?.id;
t('vprasalnik A ustvarjen', Number.isInteger(qA), JSON.stringify(r.telo));

const HTML = `<!doctype html><html lang="sl"><body><form>
  <div class="q"><label for="p">Ime vašega podjetja</label><input id="p" name="podjetje"></div>
  <div class="q"><label for="k">Kontaktna oseba</label><input id="k" name="kontakt"></div>
  <h2>Dostopi</h2>
  <div class="platform-row">
    <div class="pname">Google Business Profile</div>
    <div class="opts">
      <label class="radio-row"><input type="radio" name="dostop_google" value="imamo"> Imamo dostop</label>
      <label class="radio-row"><input type="radio" name="dostop_google" value="nimamo"> Nimamo / ne vemo</label>
    </div>
  </div>
  <div class="q"><label class="qlabel" for="z">Kaj bi najraje avtomatizirali?</label><textarea id="z" name="zelja"></textarea></div>
  <input name="company_url" aria-hidden="true">
</form></body></html>`;
r = await api('/api/questionnaires', {
  method: 'POST',
  body: JSON.stringify({ slug: `test-izvoz-b-${oznaka}`, naziv_prikaz: 'Test izvoza B', namen: 'shramba', aktivna: true, questions: [], custom_html: HTML }),
});
const qB = r.telo?.questionnaire?.id ?? r.telo?.id;
t('vprasalnik B (custom_html) ustvarjen', Number.isInteger(qB), JSON.stringify(r.telo));

const o1 = await oddaj(`test-izvoz-a-${oznaka}`, { gdpr_consent: true, podjetje: PODJETJE, ime: 'Ana Breza', bolecina: 'Ročno prepisovanje rezervacij.\nVsak dan.', pogostost: 'Dnevno' });
const o2 = await oddaj(`test-izvoz-a-${oznaka}`, { gdpr_consent: true, podjetje: PODJETJE, ime: 'Cene Dren', bolecina: 'Odgovori gostom po e-pošti.' });
const o3 = await oddaj(`test-izvoz-b-${oznaka}`, { gdpr_consent: true, podjetje: PODJETJE, kontakt: 'Eva Hrast', dostop_google: 'nimamo', zelja: 'Mesečno poročilo za vodstvo.' });
t('tri oddaje shranjene', o1.ok && o2.ok && o3.ok, JSON.stringify([o1, o2, o3]));
const cid = o1.companyId;
t('vse tri v istem podjetju', cid && o2.companyId === cid && o3.companyId === cid, JSON.stringify([o1.companyId, o2.companyId, o3.companyId]));

// AI Business Score: pravi izracun nad prvimi moznostmi, vpis kot ga naredi shrani.js.
const odgovori = Object.fromEntries(V1.map(q => [q.id, q.tip === 'vec' ? [q.moznosti[0].id] : q.moznosti[0].id]));
const rezultat = izracunajScore({ ...odgovori, velikost: VELIKOST[1].id }, 'v1');
const scoreQ = (await pool.query(`SELECT id FROM questionnaires WHERE slug = 'ai-business-score'`)).rows[0]?.id;
const scoreResp = (await pool.query(
  `INSERT INTO responses (company_id, questionnaire_id, raw_data, consent_gdpr, questions_snapshot, submitted_at)
   VALUES ($1, $2, $3, TRUE, '[]', NOW() + interval '1 minute') RETURNING id`,
  [cid, scoreQ, JSON.stringify({ ime: 'Bor', priimek: 'Lipa', email: 'bor@primer.si', telefon: '041000000', podjetje: PODJETJE, velikost: VELIKOST[1].id, odgovori, gdpr_consent: true })],
)).rows[0].id;
await pool.query(`INSERT INTO score_results (response_id, token, score_version, rezultat) VALUES ($1, $2, 'v1', $3)`,
  [scoreResp, `tok-${oznaka}`, JSON.stringify(rezultat)]);
await pool.query(`INSERT INTO company_priporocila (company_id, questionnaire_id, vsebina) VALUES ($1, $2, '## Stara priporočila\nUvedite Copilot.')`, [cid, qA]);
t('score in priporocila vpisana', Number.isInteger(scoreResp));

// Procesna seja z odgovori in transkriptom.
const predloga = (await api('/api/procesi/predloge')).telo?.predloge?.[0];
const vprPredloge = (await api(`/api/procesi/predloge/${predloga?.id}`)).telo?.predloga?.questions || [];
const besedilna = vprPredloge.filter(q => q.tip === 'text' || q.tip === 'textarea').slice(0, 2);
r = await api('/api/procesi/seje', { method: 'POST', body: JSON.stringify({ questionnaire_id: predloga?.id, stranka_naziv: PODJETJE, company_id: cid, proces: 'Rezervacije', oddelek: 'Recepcija', svetovalec: 'Maja' }) });
const sid = r.telo?.seja?.id ?? r.telo?.id;
t('seja ustvarjena', Number.isInteger(sid), JSON.stringify(r.telo).slice(0, 200));
r = await api(`/api/procesi/seje/${sid}`, { method: 'PATCH', body: JSON.stringify({ datum_sestanka: '2026-09-30', answers: Object.fromEntries(besedilna.map((q, i) => [q.id, `Odgovor seje ${i + 1}`])) }) });
t('odgovori seje shranjeni', r.status === 200 && besedilna.length === 2, `${r.status} ${besedilna.length}`);
r = await api(`/api/procesi/seje/${sid}/transkript`, { method: 'POST', body: JSON.stringify({ besedilo: 'Svetovalec: Kako danes vodite rezervacije?\nRecepcija: Ročno, v Excelu.' }) });
t('transkript shranjen', r.status === 201, `${r.status}`);

// ── 2. API ───────────────────────────────────────────────────────────────
console.log('\n=== 2. GET /api/companies/:id/izvoz ===');
const brez = await fetch(`${BASE}/api/companies/${cid}/izvoz`);
t('brez prijave 401', brez.status === 401, String(brez.status));
t('neveljaven id 400', (await api('/api/companies/abc/izvoz')).status === 400);
t('neobstojece podjetje 404', (await api('/api/companies/99999999/izvoz')).status === 404);

r = await api(`/api/companies/${cid}/izvoz`);
const d = r.telo;
t('200 s podjetjem', r.status === 200 && d?.company?.naziv_prikaz === PODJETJE, `${r.status} ${d?.company?.naziv_prikaz}`);
t('stirje odgovori po casu oddaje', d?.responses?.length === 4 && d.responses.at(-1).id === scoreResp, JSON.stringify(d?.responses?.map(x => x.id)));
t('kopija vprasanj kot vprasanja_za_prikaz, brez surove kopije', d?.responses?.[0]?.vprasanja_za_prikaz?.length === 4 && !('questions_snapshot' in d.responses[0]));
const rB = d?.responses?.find(x => x.questionnaire_id === qB);
t('custom_html: kopija ob oddaji, danasnji HTML ni poslan dvakrat', rB?.custom_html_snapshot?.includes('Imamo dostop') && rB.q_custom_html === null);
const rS = d?.responses?.find(x => x.id === scoreResp);
const vrsticeS = rS?.score?.vrstice || [];
t('score: kontakt z velikostjo kot besedilo', vrsticeS.some(([q, a]) => q === 'Število zaposlenih' && a === VELIKOST[1].text), JSON.stringify(vrsticeS.slice(0, 6)));
t('score: odgovori z besedilom vprasanja in moznosti', vrsticeS.some(([q, a]) => q === V1[0].text && a === V1[0].moznosti[0].text));
t('score: rezultat priložen', rS?.score?.rezultat?.skupno === rezultat.skupno);
t('ne-score odgovori nimajo score', d?.responses?.filter(x => x.score).length === 1);
t('priporocila', d?.priporocila?.length === 1 && d.priporocila[0].vsebina.includes('Copilot'));
const s = d?.seje?.[0];
t('seja z besedilom odgovorov', d?.seje?.length === 1 && s.besedilo.includes('Odgovor seje 1') && s.besedilo.includes('## '), s?.besedilo?.slice(0, 200));
t('seja brez surovih answers/snapshot', s && !('answers' in s) && !('questions_snapshot' in s));
t('seja s transkriptom', s?.transkripti?.length === 1 && s.transkripti[0].raw_text.includes('v Excelu') && !('session_id' in s.transkripti[0]));
t('datum seje kot niz (brez zamika dneva)', s?.datum_sestanka === '2026-09-30', s?.datum_sestanka);

// ── 3. Gumb na strani podjetja ───────────────────────────────────────────
console.log('\n=== 3. Gumb "Izvoz za Claude" ===');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });
const napake = [];
page.on('pageerror', (e) => napake.push(e.message));
// Prenos ujamemo v strani: zabelezimo blob, preden ga brskalnik shrani.
await page.evaluateOnNewDocument(() => {
  const klik = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__prenos = { ime: this.download, href: this.href };
    return klik.call(this);
  };
  URL.revokeObjectURL = () => {};
});
await page.goto(`${BASE}/admin/company.html?id=${cid}`, { waitUntil: 'networkidle0' });
const gumb = await page.$('#btn-izvoz');
t('gumb je na strani', !!gumb);
t('gumb je v glavi poleg povratka', await page.$eval('#btn-izvoz', b => !!b.closest('.e-title') && b.textContent.includes('Izvoz za Claude')).catch(() => false));
await gumb?.click();
await page.waitForFunction(() => window.__prenos, { timeout: 15000 }).catch(() => {});
const prenos = await page.evaluate(async () => {
  if (!window.__prenos) return null;
  const b = new Uint8Array(await (await fetch(window.__prenos.href)).arrayBuffer());
  const m = await import('/admin/izvoz.js');
  // Branje ZIP-a v strani: lokalne glave po vrsti (metoda stored).
  const v = new DataView(b.buffer), dec = new TextDecoder(), datoteke = {};
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const vel = v.getUint32(p + 18, true), dIme = v.getUint16(p + 26, true), dEx = v.getUint16(p + 28, true);
    const ime = dec.decode(b.subarray(p + 30, p + 30 + dIme));
    const vsebina = b.subarray(p + 30 + dIme + dEx, p + 30 + dIme + dEx + vel);
    datoteke[ime] = { besedilo: dec.decode(vsebina), crcOk: m.crc32(vsebina) === v.getUint32(p + 14, true) };
    p += 30 + dIme + dEx + vel;
  }
  return { ime: window.__prenos.ime, velikost: b.length, datoteke };
});
t('prenos se je sprozil', !!prenos, 'ni prenosa');
const imena = Object.keys(prenos?.datoteke || {});
console.log('    ' + (prenos?.ime || '') + '\n    ' + imena.join('\n    '));
const koren = `hotel-izvozni-test-${oznaka}-za-claude-`;
t('ime ZIP-a = podjetje + datum', prenos?.ime?.startsWith(koren) && prenos.ime.endsWith('.zip'), prenos?.ime);
t('vse datoteke pod eno mapo in CRC ustreza', imena.length && imena.every(i => i.startsWith(koren)) && Object.values(prenos.datoteke).every(x => x.crcOk));
t('9 datotek: navodila, podjetje, 4 odgovori, seja, transkript, priporocilo', imena.length === 9, String(imena.length));
const najdi = (del) => Object.entries(prenos?.datoteke || {}).find(([k]) => k.includes(del))?.[1]?.besedilo || '';

const custom = najdi('test-izvoz-b');
t('custom_html: vprasanje iz obrazca, ne ime polja', custom.includes('### Kaj bi najraje avtomatizirali?') && custom.includes('> Mesečno poročilo za vodstvo.') && !custom.includes('### zelja'), custom);
t('custom_html: radio pod napisom vrstice, vrednost prevedena v besedilo izbire', custom.includes('## Dostopi') && custom.includes('### Google Business Profile') && custom.includes('> Nimamo / ne vemo') && !custom.includes('> nimamo'), custom);
t('custom_html: izpolnjevalec iz polja kontakt', custom.startsWith('# Test izvoza B: Eva Hrast'), custom.split('\n')[0]);
t('custom_html: honeypot ni v izvozu', !custom.includes('company_url'));
const ana = najdi('ana-breza');
t('navaden obrazec: izbira in vecvrsticni odgovor', ana.includes('### Kako pogosto?') && ana.includes('> Dnevno') && ana.includes('> Ročno prepisovanje rezervacij.\n> Vsak dan.'));
const score = najdi('ai-business-score');
t('score v ZIP-u z rezultatom', score.includes(`### ${V1[0].text}`) && score.includes('## Rezultat AI Business Score'));
t('seja in transkript', najdi('rezervacije.md').includes('- Svetovalec (Acenta): Maja') && najdi('rezervacije-transkript.md').includes('Ročno, v Excelu.'));
const pod = najdi('01-podjetje.md');
t('pregled: stirje sodelujoci', pod.includes('## Kdo je izpolnjeval vprašalnike (4)'), pod);
t('navodila za prodajni predlog', najdi('00-NAVODILA').includes('Seznam procesov za direktorja'));
t('gumb po izvozu spet omogocen', await page.$eval('#btn-izvoz', b => !b.disabled && b.textContent.includes('Izvoz za Claude')));
t('brez JS napak na strani', napake.length === 0, napake.join(' | '));

// Regresija: stran odgovora po premiku izluscevanja v app.js.
await page.goto(`${BASE}/admin/response.html?id=${o3.responseId}`, { waitUntil: 'networkidle0' });
const oznake = await page.$$eval('.q-label', els => els.map(e => e.textContent.trim()));
t('stran odgovora: besedila iz obrazca (izluscevanje iz app.js)', oznake.includes('Kaj bi najraje avtomatizirali?') && oznake.includes('Google Business Profile'), oznake.join(' | '));
t('stran odgovora: brez JS napak', napake.length === 0, napake.join(' | '));
await browser.close();

// ── 4. Pospravi ──────────────────────────────────────────────────────────
await api(`/api/companies/${cid}`, { method: 'DELETE' });
await pool.query('DELETE FROM process_sessions WHERE id = $1', [sid]);
await pool.query(`DELETE FROM questionnaires WHERE slug LIKE 'test-izvoz-%'`);
await pool.end();

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:\n  ' + padli.join('\n  ')); process.exit(1); }
