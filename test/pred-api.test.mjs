// Before / after the workshop (sql/019): questionnaire part, the company page
// split into tabs, the overview card before the workshop, the sales proposal
// without the answers from before the workshop, and the themes with a fake AI.
//
// Run: node test/reset-testne-baze.mjs && node test/pred-api.test.mjs
// The server runs WITHOUT AI (ANTHROPIC_API_KEY= and no CLAUDE_SDK), so a
// real theme run ends in an error; the ok path is tested with a fake AI
// directly against the test database (DATABASE_URL = TEST_DB_URL).
import puppeteer from 'puppeteer-core';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3399';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const AUTH = 'Basic ' + Buffer.from('test@acenta.si:testgeslo123').toString('base64');
const DB = process.env.TEST_DB_URL || 'postgres://postgres:test@127.0.0.1:5435/vprasalniki';
process.env.DATABASE_URL = DB;

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
  return { status: r.status, telo };
}

const pg = (await import('pg')).default;
const pool = new pg.Pool({ connectionString: DB });
const oznaka = String(Date.now() % 1000000);
const podjetja = [];

async function novo(naziv) {
  const c = (await pool.query(
    `INSERT INTO companies (naziv_prikaz, naziv_normaliziran, status) VALUES ($1, lower($1), 'nov') RETURNING id`, [naziv])).rows[0];
  podjetja.push(c.id);
  return c.id;
}
const qid = async (slug) => (await pool.query('SELECT id FROM questionnaires WHERE slug = $1', [slug])).rows[0].id;
async function odgovor(companyId, slug, raw, { minut = 0, povzetek = null } = {}) {
  return (await pool.query(
    `INSERT INTO responses (company_id, questionnaire_id, raw_data, consent_gdpr, submitted_at, ai_povzetek)
     VALUES ($1, $2, $3, TRUE, NOW() - make_interval(mins => $4), $5) RETURNING id`,
    [companyId, await qid(slug), JSON.stringify(raw), minut, povzetek])).rows[0].id;
}
const pred = (r, naloge, extra = {}) => ({
  q1_pogostost: r[4], q4_razumevanje: String(r[0]), q5_orodja_znanje: String(r[1]), q6_prompti: String(r[2]), q7_omejitve: String(r[3]),
  q10_naloge: naloge, q13_orodja_poznana: 'ChatGPT, Copilot', ...extra,
});

// ── 1. Questionnaire part ────────────────────────────────────────────────
console.log('\n=== 1. Del vprasalnika ===');
let r = await api('/api/questionnaires');
const del = Object.fromEntries((r.telo.questionnaires || []).map(q => [q.slug, q.faza]));
t('zacetni deli: pred-delavnico + napredni-ai = pred', del['pred-delavnico'] === 'pred' && del['napredni-ai'] === 'pred', JSON.stringify(del));
t('zacetni deli: moj-ai-nacrt + popis-opravil = po', del['moj-ai-nacrt'] === 'po' && del['popis-opravil'] === 'po');
t('ostali brez dela (drugo)', del['review-agent-intake'] === null && del['ai-business-score'] === null);

const qPred = await qid('pred-delavnico');
const prej = (await pool.query('SELECT updated_at FROM questionnaires WHERE id = $1', [qPred])).rows[0].updated_at;
r = await api(`/api/questionnaires/${qPred}`, { method: 'PATCH', body: JSON.stringify({ faza: '' }) });
const zdaj = (await pool.query('SELECT faza, updated_at FROM questionnaires WHERE id = $1', [qPred])).rows[0];
t('PATCH samo dela: drugo = NULL', r.status === 200 && zdaj.faza === null, JSON.stringify(r.telo));
t('PATCH samo dela NE premakne updated_at (stari odgovori ostanejo »neurejeni«)', +zdaj.updated_at === +prej, `${prej} -> ${zdaj.updated_at}`);
r = await api(`/api/questionnaires/${qPred}`, { method: 'PATCH', body: JSON.stringify({ faza: 'med' }) });
t('neveljaven del: 400 invalid_faza', r.status === 400 && r.telo.error === 'invalid_faza');
r = await api(`/api/questionnaires/${qPred}`, { method: 'PATCH', body: JSON.stringify({ faza: 'pred' }) });
t('nazaj na pred', r.status === 200 && r.telo.questionnaire?.faza === 'pred');
r = await api(`/api/questionnaires/${qPred}`, { method: 'PATCH', body: JSON.stringify({ opis: 'Anketa pred AI delavnico.', faza: 'pred' }) });
const po2 = (await pool.query('SELECT updated_at FROM questionnaires WHERE id = $1', [qPred])).rows[0].updated_at;
t('vsebinska sprememba z delom premakne updated_at', +po2 > +prej);
await pool.query('UPDATE questionnaires SET updated_at = $2 WHERE id = $1', [qPred, prej]);
r = await api('/api/questionnaires', { method: 'POST', body: JSON.stringify({ slug: `test-pred-${oznaka}`, naziv_prikaz: 'Test pred', namen: 'shramba', faza: 'po' }) });
t('POST nov vprasalnik z delom po', r.status === 201 && r.telo.questionnaire?.faza === 'po', JSON.stringify(r.telo));

// ── 2. Company with answers before, after and other ─────────────────────
console.log('\n=== 2. Podjetje z odgovori pred, po in drugo ===');
const cid = await novo(`Zavod Lipa ${oznaka}`);
const p1 = await odgovor(cid, 'pred-delavnico', pred([2, 2, 2, 1, 'Vsak dan'], 'analize in poročila za razpise'), { minut: 300 });
const p2 = await odgovor(cid, 'pred-delavnico', pred([3, 3, 3, 3, 'Pogosto (večkrat na teden)'], 'odgovarjanje gostom na ponavljajoča vprašanja'), { minut: 290 });
const p3 = await odgovor(cid, 'pred-delavnico', pred([2, 3, 2, 2, 'Nikoli'], ''), { minut: 280 });
const o1 = await odgovor(cid, 'moj-ai-nacrt', { '1_ime_priimek': 'Ana Breznik', email: 'ana@lipa.si', '7_naloge_najvec_casa': 'Poročila' }, { minut: 60, povzetek: '1. **KDO**: Ana' });
const o2 = await odgovor(cid, 'moj-ai-nacrt', { '1_ime_priimek': 'Bor Kos', email: 'bor@lipa.si' }, { minut: 50 });
const d1 = await odgovor(cid, 'review-agent-intake', { kontakt: 'Cene Lipa', email: 'cene@lipa.si' }, { minut: 40 });

r = await api(`/api/companies/${cid}`);
const faze = Object.fromEntries(r.telo.responses.map(x => [x.id, x.q_faza]));
t('odgovori nosijo q_faza', faze[p1] === 'pred' && faze[o1] === 'po' && faze[d1] === null, JSON.stringify(faze));

await pool.query(
  `INSERT INTO company_priporocila (company_id, questionnaire_id, vsebina) VALUES ($1, $2, 'iz ankete pred'), ($1, $3, 'iz nacrta po')`,
  [cid, qPred, await qid('moj-ai-nacrt')]);
r = await api(`/api/companies/${cid}/izvoz`);
const izv = r.telo.responses.map(x => x.id).sort((a, b) => a - b);
t('izvoz: brez odgovorov pred delavnico, s po in drugo', JSON.stringify(izv) === JSON.stringify([o1, o2, d1].sort((a, b) => a - b)), JSON.stringify(izv));
t('izvoz: brez priporocil iz ankete pred', r.telo.priporocila.length === 1 && r.telo.priporocila[0].vsebina === 'iz nacrta po', JSON.stringify(r.telo.priporocila));

r = await api(`/api/companies/${cid}/prodajni-predlog`);
t('gradivo: 3 odgovori (po + drugo), 3 pred izpusceni', r.telo.gradivo.odgovori === 3 && r.telo.gradivo.pred === 3, JSON.stringify(r.telo.gradivo));

// An old proposal, prepared before the split.
await pool.query(
  `INSERT INTO prodajni_predlogi (company_id, status, za_direktorja, za_matjaza, opozorila, vhod, model, created_at, koncano_at)
   VALUES ($1, 'ok', '# Procesi za Lipo', '# Za Matjaza', '[]'::jsonb, '{"odgovori": 6, "seje": 0}'::jsonb, 'claude-opus-5-5', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')`,
  [cid]);
r = await api(`/api/companies/${cid}/prodajni-predlog`);
t('stari predlog: brez_pred = false', r.telo.predlog?.brez_pred === false, JSON.stringify(r.telo.predlog));

// ── 3. Themes: API ───────────────────────────────────────────────────────
console.log('\n=== 3. Teme pred delavnico: API ===');
r = await api(`/api/companies/${cid}/pred-teme`);
t('GET brez tem: null, 3 odgovori pred, ni aktualno', r.telo.teme === null && r.telo.odgovori_pred === 3 && r.telo.aktualno === false, JSON.stringify(r.telo));
const cBrezPred = await novo(`Hotel Breza ${oznaka}`);
await odgovor(cBrezPred, 'moj-ai-nacrt', { '1_ime_priimek': 'Dan Breza', email: 'dan@breza.si' });
r = await api(`/api/companies/${cBrezPred}/pred-teme`, { method: 'POST' });
t('POST brez odgovorov pred: 400', r.status === 400 && r.telo.error === 'ni_odgovorov_pred');

r = await api(`/api/companies/${cid}/pred-teme`, { method: 'POST' });
t('POST: 202 in takoj »pripravlja«', r.status === 202 && r.telo.teme?.status === 'pripravlja', JSON.stringify(r.telo));
const drugi = await api(`/api/companies/${cid}/pred-teme`, { method: 'POST' });
t('drugi POST med pripravo: 409 ali ze konec', drugi.status === 409 || drugi.status === 202, drugi.status);
let stanje = null;
for (let i = 0; i < 40; i++) {
  stanje = (await api(`/api/companies/${cid}/pred-teme`)).telo;
  if (stanje.teme?.status !== 'pripravlja') break;
  await pocakaj(500);
}
t('streznik brez AI: priprava konca z napako, ne obvisi', stanje.teme?.status === 'napaka' && !!stanje.teme.napaka, JSON.stringify(stanje.teme));

// Ok path with a fake AI, straight against the test database.
const { generirajPredTeme } = await import('../src/ai/generate_pred_teme.js');
const lazen = async ({ user }) => JSON.stringify({ teme: [
  { naziv: 'Poročila za razpise', odgovori: ['R1'], citat: 'analize in poročila za razpise', citat_iz: 'R1' },
  { naziv: 'Odgovori gostom', odgovori: ['R2'], citat: 'odgovarjanje gostom', citat_iz: 'R2' },
  { naziv: 'Izmišljeno', odgovori: ['R3'], citat: 'nekaj', citat_iz: 'R3' },
], _user: user.length });
const teme = await generirajPredTeme(cid, { klic: lazen });
const vr = (await pool.query('SELECT * FROM pred_teme WHERE company_id = $1', [cid])).rows[0];
t('lazen AI: 2 preverjeni temi shranjeni, izmisljena izpadla', teme?.length === 2 && vr.status === 'ok' && vr.teme.length === 2, JSON.stringify(vr.teme));
t('shranjeni id-ji odgovorov in »brez teme« = 1', JSON.stringify([...vr.odgovori].sort((a, b) => a - b)) === JSON.stringify([p1, p2, p3]) && vr.brez_opravil === 1, JSON.stringify([vr.odgovori, vr.brez_opravil]));
t('citat_odgovor je pravi odgovor', vr.teme[0].citat_odgovor === p1 && vr.teme[1].citat_odgovor === p2, JSON.stringify(vr.teme));
r = await api(`/api/companies/${cid}/pred-teme`);
t('GET: aktualno = true', r.telo.aktualno === true && r.telo.teme.status === 'ok', JSON.stringify(r.telo));

const p4 = await odgovor(cid, 'pred-delavnico', pred([4, 4, 4, 4, 'Vsak dan'], 'priprava ponudb'), { minut: 270 });
r = await api(`/api/companies/${cid}/pred-teme`);
t('nov odgovor pred: ni vec aktualno', r.telo.aktualno === false && r.telo.odgovori_pred === 4);
await pool.query('DELETE FROM responses WHERE id = $1', [p4]);

await generirajPredTeme(cid, { klic: async () => { throw new Error('API ni dosegljiv'); } });
const napaka = (await pool.query('SELECT status, napaka, jsonb_array_length(teme) AS n FROM pred_teme WHERE company_id = $1', [cid])).rows[0];
t('napaka AI: status napaka, prejsnje teme ostanejo', napaka.status === 'napaka' && /API ni dosegljiv/.test(napaka.napaka) && napaka.n === 2, JSON.stringify(napaka));
await generirajPredTeme(cid, { klic: lazen });

await pool.query(`UPDATE pred_teme SET status = 'pripravlja', zacetek_at = NOW() - INTERVAL '30 minutes' WHERE company_id = $1`, [cid]);
r = await api(`/api/companies/${cid}/pred-teme`);
t('obticala priprava se pokaze kot napaka', r.telo.teme.status === 'napaka' && /predolgo/.test(r.telo.teme.napaka), JSON.stringify(r.telo.teme));
await generirajPredTeme(cid, { klic: lazen });

const prazno = await novo(`Penzion Brez ${oznaka}`);
await pool.query(`INSERT INTO pred_teme (company_id, status) VALUES ($1, 'ok')`, [prazno]);
await generirajPredTeme(prazno, { klic: lazen });
t('brez odgovorov pred: vrstica tem izbrisana', (await pool.query('SELECT 1 FROM pred_teme WHERE company_id = $1', [prazno])).rows.length === 0);

// ── 4. Answer summary ────────────────────────────────────────────────────
console.log('\n=== 4. Povzetek odgovora ===');
r = await api(`/api/responses/${p1}/povzetek`, { method: 'POST' });
t('lead odgovor: 202', r.status === 202, JSON.stringify(r.telo));
r = await api(`/api/responses/${d1}/povzetek`, { method: 'POST' });
t('shramba: 400 brez_povzetka', r.status === 400 && r.telo.error === 'brez_povzetka');
r = await api('/api/responses/999999/povzetek', { method: 'POST' });
t('neznan odgovor: 404', r.status === 404);
r = await api(`/api/responses/${p1}`);
t('odgovor nosi q_faza in q_namen', r.telo.response.q_faza === 'pred' && r.telo.response.q_namen === 'lead');

// ── 5. Company page ──────────────────────────────────────────────────────
console.log('\n=== 5. Stran podjetja ===');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });
const napake = [];
page.on('pageerror', e => napake.push(e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (/favicon/.test((m.location()?.url || '') + m.text())) return;
  napake.push(m.text());
});
page.on('dialog', d => d.accept());
await page.setViewport({ width: 1400, height: 1000 });

async function odpri(pot) {
  await page.goto(`${BASE}${pot}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#faze, #odgovori-section .panel__title', { timeout: 8000 }).catch(() => {});
  await pocakaj(300);
}
const stanjeStrani = () => page.evaluate(() => {
  const vid = (sel) => { const el = document.querySelector(sel); return !!el && !el.hidden && el.getBoundingClientRect().height > 0; };
  return {
    hash: location.hash,
    faze: [...document.querySelectorAll('#faze [data-del]')].map(b => b.textContent.replace(/\s+/g, ' ').trim()),
    aktivna: document.querySelector('#faze [data-del].active')?.dataset.del || null,
    fazeVidne: vid('#faze'),
    pred: vid('#pred-pregled'), predlog: vid('#prodajni-predlog'), popis: vid('#popis-opravil'),
    delavnica: !!document.getElementById('delavnica'),
    odgNaslov: document.querySelector('#odgNaslov')?.textContent.trim(),
    odgOpis: document.querySelector('#odgovori-section .panel__desc')?.textContent.trim(),
    odgovori: [...document.querySelectorAll('#odgovori-section .resp')].map(a => Number(a.dataset.response)),
    odgZavihki: document.querySelectorAll('#odgovori-section .odg-tabs .tab').length,
  };
});

await odpri(`/admin/company.html?id=${cid}`);
let s = await stanjeStrani();
t('zavihki: Pred 3, Po 2, Drugo 1', JSON.stringify(s.faze) === JSON.stringify(['Pred delavnico 3', 'Po delavnici 2', 'Drugo 1']), JSON.stringify(s.faze));
t('privzeto Po delavnici (ima odgovore po)', s.aktivna === 'po');
t('Po: predlog in popis vidna, pregled pred skrit', s.predlog && s.popis && !s.pred, JSON.stringify(s));
t('Priprave na delavnico ni vec', !s.delavnica);
t('Po: odgovori po delavnici, samo 2, brez notranjih zavihkov', s.odgNaslov === 'Odgovori po delavnici' && JSON.stringify(s.odgovori.sort()) === JSON.stringify([o1, o2].sort()) && s.odgZavihki === 0 && s.odgOpis.startsWith('Moj AI načrt'), JSON.stringify(s));
let pp = await page.evaluate(() => ({
  opozorilo: document.querySelector('#pp-iz-vseh')?.textContent.replace(/\s+/g, ' ').trim() || '',
  gumb: document.querySelector('#pp-pripravi-brez-pred')?.textContent.trim(),
}));
t('stari predlog: opozorilo »Pripravljeno še iz vseh odgovorov« s 3 odgovori pred', pp.opozorilo.includes('Pripravljeno še iz vseh odgovorov') && pp.opozorilo.includes('3 odgovore pred delavnico') && pp.gumb === 'Pripravi znova', JSON.stringify(pp));

await page.click('#faze [data-del="pred"]');
await pocakaj(400);
s = await stanjeStrani();
t('klik Pred: aktivno pred, #pred v naslovu', s.aktivna === 'pred' && s.hash === '#pred');
t('Pred: pregled viden, predlog in popis skrita', s.pred && !s.predlog && !s.popis, JSON.stringify(s));
t('Pred: odgovori pred delavnico, 3', s.odgNaslov === 'Odgovori pred delavnico' && s.odgovori.length === 3, JSON.stringify(s));
let pk = await page.evaluate(() => {
  const el = document.getElementById('pred-pregled');
  return {
    naslov: el.querySelector('#predNaslov')?.textContent,
    pod: el.querySelector('.docp__title p')?.textContent || '',
    ocena: el.querySelector('.pred__ocena')?.textContent,
    stopnja: el.querySelector('.pred__raven .chip')?.textContent,
    opis: el.querySelector('.pred__opis')?.textContent || '',
    vrstic: el.querySelectorAll('.bar-row').length,
    pogostost: [...el.querySelectorAll('.pred__blok:first-child .chips')[0]?.querySelectorAll('.chip') || []].map(c => c.textContent.trim()),
    orodja: [...el.querySelectorAll('.pred__blok:first-child .chips')[1]?.querySelectorAll('.chip') || []].map(c => c.textContent.trim()),
    teme: [...el.querySelectorAll('.teme li')].map(li => ({ n: li.querySelector('b')?.textContent, st: li.querySelector('.count')?.textContent, c: li.querySelector('.teme__citat')?.textContent, href: li.querySelector('.teme__citat')?.getAttribute('href') })),
    noga: el.querySelector('.pred__foot')?.textContent.replace(/\s+/g, ' ').trim() || '',
    gumb: el.querySelector('#pred-teme-znova')?.textContent.trim(),
  };
});
t('naslov in podnaslov (3 odgovori, ime ankete)', pk.naslov === 'Pregled pred delavnico' && pk.pod.startsWith('Iz 3 odgovorov na »') && pk.pod.includes('pred izobraževanjem'), pk.pod);
t('raven 2,3 od 4 (28 / 12), osnovna', pk.ocena === '2,3' && pk.stopnja === 'Osnovna raven', JSON.stringify([pk.ocena, pk.stopnja]));
t('opis: 3 udeležencev + najšibkejše področje', pk.opis.includes('Povprečje samoocen 3 udeležencev') && pk.opis.includes('Najšibkejše področje'), pk.opis);
t('4 področja kot vrstice', pk.vrstic === 4);
t('pogostost: vseh 5, s številkami', pk.pogostost.length === 5 && pk.pogostost[0].replace(/\s/g, '') === 'Vsakdan1' && pk.pogostost[4].replace(/\s/g, '') === 'Nikoli1', JSON.stringify(pk.pogostost));
t('orodja: ChatGPT 3, Copilot 3', JSON.stringify(pk.orodja.map(x => x.replace(/\s/g, ''))) === JSON.stringify(['ChatGPT3', 'Copilot3']), JSON.stringify(pk.orodja));
t('teme: 2, s številom ljudi in dobesednim citatom', pk.teme.length === 2 && pk.teme[0].n === 'Poročila za razpise' && pk.teme[0].st === '1' && pk.teme[0].c === '»analize in poročila za razpise«', JSON.stringify(pk.teme));
t('citat vodi na odgovor', pk.teme[0].href === `/admin/response.html?id=${p1}`, pk.teme[0].href);
t('noga: 1 od 3 ni v nobeni temi + Pripravi znova', pk.noga.includes('1 od 3 odgovorov ni v nobeni temi') && pk.gumb === 'Pripravi znova', pk.noga);

// Header link of the po questionnaire while on Pred: back to Po.
await page.evaluate(() => [...document.querySelectorAll('#ident .qlink')].find(a => a.textContent.includes('Moj AI'))?.click());
await pocakaj(500);
s = await stanjeStrani();
t('povezava v glavi preklopi na del svojega vprasalnika', s.aktivna === 'po' && s.odgovori.length === 2, JSON.stringify([s.aktivna, s.odgovori.length]));

await page.click('#faze [data-del="drugo"]');
await pocakaj(300);
s = await stanjeStrani();
t('Drugo: samo odgovori (1), brez predloga in pregleda', s.aktivna === 'drugo' && !s.predlog && !s.pred && !s.popis && s.odgovori.length === 1 && s.odgNaslov === 'Drugi odgovori', JSON.stringify(s));

await odpri(`/admin/company.html?id=${cid}#pred`);
s = await stanjeStrani();
t('#pred ob nalaganju odpre Pred', s.aktivna === 'pred' && s.pred);
await odpri(`/admin/company.html?id=${cid}&q=${qPred}`);
s = await stanjeStrani();
t('?q= vprasalnika pred odpre Pred', s.aktivna === 'pred');

// "Pripravi znova" on the card: the server has no AI, so it ends in an error.
await odpri(`/admin/company.html?id=${cid}#pred`);
await page.click('#pred-teme-znova');
await page.waitForSelector('#pred-teme-tece, #pred-teme-napaka', { timeout: 6000 }).catch(() => {});
let v = await page.evaluate(() => !!document.querySelector('#pred-teme-tece, #pred-teme-napaka'));
t('Pripravi znova: stanje priprave se pokaze', v);
await page.waitForSelector('#pred-teme-napaka', { timeout: 15000 }).catch(() => {});
v = await page.evaluate(() => ({ napaka: document.querySelector('#pred-teme-napaka')?.textContent || '', teme: document.querySelectorAll('.teme li').length }));
t('brez AI: napaka vidna, prejšnje teme ostanejo', v.napaka.includes('Priprava tem ni uspela') && v.teme === 2, JSON.stringify(v));
await generirajPredTeme(cid, { klic: lazen });

// Automatic run: a company with answers before the workshop and no themes.
const cAuto = await novo(`Hisa Javor ${oznaka}`);
await odgovor(cAuto, 'pred-delavnico', pred([1, 1, 2, 1, 'Redko (1–2× na mesec)'], 'pisanje zapisnikov'));
await odpri(`/admin/company.html?id=${cAuto}`);
s = await stanjeStrani();
t('samo odgovori pred: privzeto Pred, zavihka Pred in Po', s.aktivna === 'pred' && JSON.stringify(s.faze) === JSON.stringify(['Pred delavnico 1', 'Po delavnici 0']), JSON.stringify(s.faze));
await pocakaj(800);
const avto = (await pool.query('SELECT status FROM pred_teme WHERE company_id = $1', [cAuto])).rows[0];
t('stran sama zažene pripravo tem', !!avto, JSON.stringify(avto));
pk = await page.evaluate(() => ({ ocena: document.querySelector('.pred__ocena')?.textContent, stopnja: document.querySelector('.pred__raven .chip')?.textContent }));
t('raven 1,3: Začetna raven', pk.ocena === '1,3' && pk.stopnja === 'Začetna raven', JSON.stringify(pk));
await page.click('#faze [data-del="po"]');
await pocakaj(400);
pp = await page.evaluate(() => ({
  caka: document.querySelector('#pp-caka-po')?.textContent.replace(/\s+/g, ' ').trim() || '',
  gumb: !!document.querySelector('#pp-pripravi'),
  odg: document.querySelector('#odgovori-section .empty-line')?.textContent,
}));
t('Po brez odgovorov po: predlog čaka, brez gumba', pp.caka.includes('Predlog se pripravi iz odgovorov po delavnici') && pp.caka.includes('(1)') && !pp.gumb, JSON.stringify(pp));
t('Po brez odgovorov: prazen seznam z razlago', pp.odg === 'Po delavnici to podjetje še ni oddalo nobenega odgovora.', pp.odg);

// A company without workshop answers looks as before: no tabs.
const cDrugo = await novo(`Avtohisa Jelka ${oznaka}`);
await odgovor(cDrugo, 'review-agent-intake', { kontakt: 'Eva Jelka', email: 'eva@jelka.si' });
await odpri(`/admin/company.html?id=${cDrugo}`);
s = await stanjeStrani();
t('brez odgovorov pred/po: brez zavihkov, predlog in popis kot prej', !s.fazeVidne && s.predlog && s.popis && !s.pred && s.odgNaslov === 'Odgovori' && s.odgovori.length === 1, JSON.stringify(s));
pp = await page.evaluate(() => document.querySelector('#prodajni-predlog .empty__text')?.textContent || '');
t('prazen predlog: »vse odgovore tega podjetja (1)«', pp.includes('vse odgovore tega podjetja (1)'), pp);

// Phone
await page.setViewport({ width: 390, height: 844 });
await odpri(`/admin/company.html?id=${cid}#pred`);
v = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.pred__blok')].map(x => x.getBoundingClientRect());
  const y = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
  return {
    preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    zlozeno: b.length === 2 && b[1].top >= b[0].bottom - 1,
    vrstniRed: y('#pred-pregled') < y('.pp-stran') && y('.pp-stran') < y('#odgovori-section'),
    zavihki: [...document.querySelectorAll('#faze .tab')].every(x => x.getBoundingClientRect().right <= innerWidth + 1),
  };
});
t('telefon: brez vodoravnega prelivanja', v.preliv <= 1, `${v.preliv}px`);
t('telefon: bloka pregleda drug pod drugim', v.zlozeno);
t('telefon: pregled, opombe, odgovori', v.vrstniRed);
t('telefon: zavihki v sirini zaslona', v.zavihki);
await page.setViewport({ width: 1400, height: 1000 });

// ── 6. Other pages ───────────────────────────────────────────────────────
console.log('\n=== 6. Druge strani ===');
await odpri('/admin/podjetja.html');
await page.waitForSelector('.ctable', { timeout: 5000 }).catch(() => {});
v = await page.evaluate(() => [...document.querySelectorAll('.ctable thead th')].map(th => th.textContent.trim()));
t('Podjetja: brez stolpca Priporočila', !v.includes('Priporočila') && v.includes('Prodajni predlog') && v.length === 7, JSON.stringify(v));

await page.goto(`${BASE}/admin/questionnaires.html`, { waitUntil: 'networkidle0' });
await pocakaj(300);
v = await page.evaluate(() => {
  const vrsta = [...document.querySelectorAll('.vp-row')].find(li => li.textContent.includes('pred izobraževanjem'));
  return { cip: vrsta?.querySelector('.vp-side')?.textContent.includes('Pred delavnico') };
});
t('Vprasalniki: oznaka »Pred delavnico« na seznamu', v.cip === true);
await page.evaluate(() => [...document.querySelectorAll('.vp-row')].find(li => li.textContent.includes('pred izobraževanjem'))?.querySelector('.vp-ime')?.click());
await page.waitForFunction(() => document.getElementById('f-slug')?.value === 'pred-delavnico', { timeout: 5000 }).catch(() => {});
v = await page.evaluate(() => ({ faza: document.getElementById('f-faza')?.value, vidno: !document.getElementById('polje-faza')?.hidden }));
t('urejevalnik: Del delavnice = Pred delavnico', v.faza === 'pred' && v.vidno, JSON.stringify(v));

await odpri(`/admin/response.html?id=${o2}`);
await page.waitForSelector('#sumNaslov', { timeout: 5000 }).catch(() => {});
v = await page.evaluate(() => ({
  gumb: document.querySelector('#btn-povzetek')?.textContent.trim(),
  delavnica: [...document.querySelectorAll('a')].some(a => (a.getAttribute('href') || '').includes('#delavnica')),
  pot: document.querySelector('.crumbs a[href*="company.html"]')?.getAttribute('href'),
}));
t('odgovor brez povzetka: gumb Pripravi povzetek, brez povezave na delavnico', v.gumb === 'Pripravi povzetek' && !v.delavnica, JSON.stringify(v));
t('pot nazaj odpre del vprasalnika (?q=)', /company\.html\?id=\d+&q=\d+$/.test(v.pot || ''), v.pot);
await odpri(`/admin/response.html?id=${d1}`);
await page.waitForSelector('#sumNaslov', { timeout: 5000 }).catch(() => {});
v = await page.evaluate(() => ({ gumb: !!document.querySelector('#btn-povzetek'), besedilo: document.querySelector('.a-sum .empty__title')?.textContent }));
t('shramba: brez gumba, »Brez AI povzetka«', !v.gumb && v.besedilo === 'Brez AI povzetka', JSON.stringify(v));

// ── 7. Danes: Brez prodajnega predloga ──────────────────────────────────
// Replaces "Brez priporočil" and "Zastarela priporočila". Counted as a delta,
// other suites may leave companies in the test database.
console.log('\n=== 7. Danes: brez prodajnega predloga ===');
async function brezPredloga() {
  const [s, n] = await Promise.all([api('/api/stats'), api('/api/naloge')]);
  const ukrepaj = n.telo.ukrepaj || [];
  return {
    stats: s.telo.totals?.brez_predloga,
    naloga: ukrepaj.find(x => x.tip === 'brez_predloga')?.stevilo ?? 0,
    stari: ukrepaj.some(x => /priporocil/.test(x.tip)) || 'zastarela' in s.telo || 'brez_priporocil' in (s.telo.totals || {}),
  };
}
const b0 = await brezPredloga();
t('stats in Ukrepaj stejeta isto, starih stevcev ni', Number.isInteger(b0.stats) && b0.stats === b0.naloga && !b0.stari, JSON.stringify(b0));
const cDanes = await novo(`Kmetija Hrast ${oznaka}`);
await odgovor(cDanes, 'pred-delavnico', pred([2, 2, 2, 2, 'Vsak dan'], 'racuni'));
let b = await brezPredloga();
t('samo odgovori pred: ne steje', b.stats === b0.stats, JSON.stringify(b));
await odgovor(cDanes, 'moj-ai-nacrt', { '1_ime_priimek': 'Iva Hrast', email: 'iva@hrast.si' });
b = await brezPredloga();
t('odgovor po delavnici, predloga ni: +1 (stats in Ukrepaj)', b.stats === b0.stats + 1 && b.naloga === b.stats, JSON.stringify(b));
const ppId = (await pool.query(`INSERT INTO prodajni_predlogi (company_id, status) VALUES ($1, 'pripravlja') RETURNING id`, [cDanes])).rows[0].id;
b = await brezPredloga();
t('predlog v pripravi: ne steje', b.stats === b0.stats, JSON.stringify(b));
await pool.query(`UPDATE prodajni_predlogi SET status = 'napaka', napaka = 'test' WHERE id = $1`, [ppId]);
b = await brezPredloga();
t('neuspela priprava: spet steje', b.stats === b0.stats + 1, JSON.stringify(b));
const brez = b.stats;

await odpri('/admin/index.html');
await page.waitForFunction(() => /\d/.test(document.getElementById('s-brez')?.textContent || ''), { timeout: 5000 }).catch(() => {});
v = await page.evaluate(() => {
  const kpi = document.getElementById('kpi-vrh');
  const besedilo = document.querySelector('main')?.innerText || document.body.innerText;
  return {
    kartic: kpi.querySelectorAll('.metric').length,
    oznaka: kpi.querySelector('.metric:last-child .metric__label')?.textContent.trim(),
    vrednost: document.getElementById('s-brez')?.textContent,
    stat: document.getElementById('stat-brez')?.textContent,
    naloga: [...document.querySelectorAll('#v-ukrepaj .task__title')].map(x => x.textContent).find(x => x.includes('prodajnega predloga')),
    priporocila: /priporočil/i.test(besedilo + document.getElementById('statistika').innerText),
    znacke: [...document.querySelectorAll('#aktivnost .chip')].map(x => x.textContent.trim()),
    preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
t('Danes: 4 kazalniki, zadnji »Brez prodajnega predloga«', v.kartic === 4 && v.oznaka === 'Brez prodajnega predloga', JSON.stringify(v));
t('Danes: stevilka kot v API-ju (vrh in statistika)', v.vrednost === String(brez) && v.stat === String(brez), JSON.stringify(v));
t('Ukrepaj: »N podjetij brez prodajnega predloga«', !!v.naloga && v.naloga.startsWith(String(brez)), v.naloga);
t('Danes: nikjer vec »priporočil«', !v.priporocila);
t('Aktivnost: znacke predloga, ne AI', v.znacke.length > 0 && v.znacke.every(z => /predlog/i.test(z)), JSON.stringify(v.znacke));
t('Danes 1400: brez prelivanja', v.preliv <= 1, `${v.preliv}px`);
for (const sirina of [900, 390]) {
  await page.setViewport({ width: sirina, height: 900 });
  await pocakaj(200);
  v = await page.evaluate(() => {
    const k = [...document.querySelectorAll('#kpi-vrh .metric')].map(m => m.getBoundingClientRect());
    const vrh = document.getElementById('kpi-vrh').getBoundingClientRect();
    const oznaka = document.querySelector('#kpi-vrh .metric:last-child .metric__label');
    return {
      preliv: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // every row of cards fills the strip: no empty cell at the end
      polno: Math.abs(Math.max(...k.map(r => r.right)) - vrh.right) <= 2 && Math.abs(k[k.length - 1].right - vrh.right) <= 2,
      oznakaCela: oznaka.scrollWidth <= oznaka.clientWidth + 1,
    };
  });
  t(`Danes ${sirina}: kazalniki brez praznega polja, oznaka cela, brez prelivanja`, v.polno && v.oznakaCela && v.preliv <= 1, JSON.stringify(v));
}
await page.setViewport({ width: 1400, height: 1000 });

t('brez JS napak na straneh', napake.length === 0, JSON.stringify(napake.slice(0, 3)));
await browser.close();

// ── Cleanup ──────────────────────────────────────────────────────────────
await pool.query('DELETE FROM companies WHERE id = ANY($1::int[])', [podjetja]);
await pool.query(`DELETE FROM questionnaires WHERE slug = $1`, [`test-pred-${oznaka}`]);
await pool.end();
const { pool: dbPool } = await import('../src/db.js').catch(() => ({}));
await dbPool?.end?.().catch(() => {});

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
process.exit(0);
