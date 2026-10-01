// AI Business Score: end-to-end API test (local server + mock MailerLite, never production).
//
// Assertions:
//  1. Public page, question JSON without points, /f/ai-business-score redirect.
//  2. Validation: missing/invalid contact fields, missing GDPR, invalid answer -> 400 with field.
//  3. Valid submission -> response + score row in one go, reportUrl with 22-char token,
//     score equals the pure function for the same answers.
//  4. Public report data is minimised (no lead, no financial, no raw answers) + private headers;
//     unknown token 404, revoked 410, report page itself noindex.
//  5. Outbox: MailerLite mock receives the upsert with the agreed fields and group; ml_status ok;
//     no AI key -> ai_status failed and the report still has template text.
//  6. Outbox resilience: 500 from MailerLite -> retry with attempts 1 and a future next_attempt_at;
//     a stale lock (process died) is picked up again.
//  7. Qualification: an existing company qualification is NOT overwritten; an empty one is filled.
//  8. Honeypot stores nothing; double submit returns the same report.
//  9. CSV export: 401 without auth; BOM, ';' header and the row with auth.
//
// Run (see test/README): server with .env.test + the MAILERLITE_* / SCORE_* env below, then
//   node test/score-api.test.mjs
import http from 'node:http';
import pg from 'pg';
import { izracunajScore } from '../src/score/izracunaj.js';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3398';
const ML_PORT = 3397;
const AUTH = 'Basic ' + Buffer.from('test@acenta.si:testgeslo123').toString('base64');
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:test@127.0.0.1:5455/vprasalniki' });

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}
const pocakaj = (ms) => new Promise(r => setTimeout(r, ms));
async function dokler(fn, ms = 8000) { const k = Date.now() + ms; while (Date.now() < k) { const v = await fn(); if (v) return v; await pocakaj(200); } return null; }

// ── mock MailerLite ──
const mlKlici = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
    const body = JSON.parse(b || '{}');
    mlKlici.push({ url: req.url, auth: req.headers.authorization, body });
    if (body.email?.startsWith('pade')) { res.writeHead(500); return res.end('boom'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":{"id":"1"}}');
  });
}).listen(ML_PORT, '127.0.0.1');

const ODG = {
  panoga: 'proizvodnja', vloga: 'direktor', uporaba: 'posamezniki', sistematicnost: 'vsak_po_svoje',
  odgovorna_oseba: 'neformalno', razumevanje: 'povprecno', pravila: 'potrebovali',
  izguba_casa: ['nabava', 'porocila', 'ponudbe'], stroski: ['nabava', 'zaloge', 'rocna_administracija'],
  potencial: ['nabava', 'administracija'], odziv: '24h', nabavne_cene: 'ne_preverjamo', ovira: 'kje_zaceti',
  hitrost: 'cim_prej', pomoc: 'agent_nabava', interpretacija: 'pogovor',
};
const sufiks = Date.now().toString(36);
const oddaja = (o = {}) => ({
  ime: 'Ana', priimek: 'Novak', email: `ana-${sufiks}@primer.si`, telefon: '041 123 456',
  podjetje: `Kovinar Test ${sufiks}`, velikost: '51-100', gdpr_consent: true, marketing_consent: true,
  odgovori: ODG, ...o,
});
async function post(body) {
  const r = await fetch(`${BASE}/f/ai-business-score`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, d: await r.json().catch(() => ({})) };
}

console.log('\n1. Javna stran');
let r = await fetch(`${BASE}/ai-business-score/`);
t('pristajalna 200 + html', r.status === 200 && (await r.text()).includes('AI Business Score'));
const vj = await (await fetch(`${BASE}/ai-business-score/vprasanja.json`)).json();
const vjs = JSON.stringify(vj);
t('vprasanja.json: 16 vprasanj', vj.vprasanja.length === 16, vj.vprasanja.length);
t('vprasanja.json: brez tock in pravil', !/"(zre|pot|prip|fin|sig|odlocevalec|akcija)"/.test(vjs));
r = await fetch(`${BASE}/f/ai-business-score`, { redirect: 'manual' });
t('GET /f/ai-business-score -> 302 na pristajalno', r.status === 302 && r.headers.get('location') === '/ai-business-score', r.status);

console.log('\n2. Preverjanje');
for (const [ime, body, polje] of [
  ['brez telefona', oddaja({ telefon: '' }), 'telefon'],
  ['slab e-naslov', oddaja({ email: 'ana@' }), 'email'],
  ['brez podjetja', oddaja({ podjetje: '  ' }), 'podjetje'],
  ['napacna velikost', oddaja({ velikost: '7' }), 'velikost'],
  ['neveljaven odgovor', oddaja({ odgovori: { ...ODG, uporaba: 'xxx' } }), 'uporaba'],
  ['4 izbire pri "do 3"', oddaja({ odgovori: { ...ODG, izguba_casa: ['nabava', 'porocila', 'ponudbe', 'marketing'] } }), 'izguba_casa'],
  ['manjka vprasanje', oddaja({ odgovori: { ...ODG, pomoc: undefined } }), 'pomoc'],
]) {
  const x = await post(body);
  t(`${ime} -> 400 field=${polje}`, x.status === 400 && x.d.field === polje, JSON.stringify(x));
}
const brezGdpr = await post(oddaja({ gdpr_consent: false }));
t('brez GDPR -> 400', brezGdpr.status === 400 && brezGdpr.d.error === 'gdpr_consent_required', JSON.stringify(brezGdpr));

console.log('\n3. Veljavna oddaja');
const x = await post(oddaja());
t('200 ok + reportUrl', x.status === 200 && x.d.ok && /^\/r\/[A-Za-z0-9_-]{22}$/.test(x.d.reportUrl || ''), JSON.stringify(x));
const token = (x.d.reportUrl || '').split('/').pop();
const row = (await db.query(
  `SELECT s.*, r.raw_data, r.company_id FROM score_results s JOIN responses r ON r.id = s.response_id WHERE s.token = $1`, [token])).rows[0];
t('vrstica v score_results + responses', !!row && row.response_id === x.d.responseId);
const pricakovano = izracunajScore({ ...ODG, velikost: '51-100' });
t('rezultat = cista funkcija', row?.rezultat?.skupno === pricakovano.skupno && row?.rezultat?.lead?.razred === 'A', `${row?.rezultat?.skupno} vs ${pricakovano.skupno}`);
t('marketing_soglasje shranjen', row?.marketing_soglasje === true);
t('raw_data ima kontakt in odgovore', row?.raw_data?.email === `ana-${sufiks}@primer.si` && row?.raw_data?.odgovori?.hitrost === 'cim_prej');

console.log('\n4. Javno porocilo');
r = await fetch(`${BASE}/r/${token}/podatki`);
const pd = await r.json();
t('podatki 200', r.status === 200);
t('glave: noindex, no-referrer, no-store',
  r.headers.get('x-robots-tag')?.includes('noindex') && r.headers.get('referrer-policy') === 'no-referrer' && r.headers.get('cache-control')?.includes('no-store'));
const pds = JSON.stringify(pd);
t('brez lead razreda, financnega potenciala, signalov in odgovorov',
  !/"lead"|"financni"|"signali"|"odgovori"|"telefon"|"razlogi"/.test(pds), pds.slice(0, 200));
// Since 1. 10. no answer texts are echoed (Matjaž: "only what I ticked"); only the talk flag.
t('brez besedil odgovorov, samo zeliPogovor',
  !('izbrano' in pd) && typeof pd.zeliPogovor === 'boolean'
  && !/"cim_prej"|"pilot"|"proizvodnja"|"zre"|"prip"|"sig"/.test(pds), JSON.stringify({ izbrano: pd.izbrano, zeliPogovor: pd.zeliPogovor }));
t('vzvodi: najvec 3 z besedilom in tockami',
  Array.isArray(pd.vzvodi) && pd.vzvodi.length <= 3 && pd.vzvodi.every(v => v.korak && v.zrelost > 0) && typeof pd.skupaj?.skupno === 'number',
  JSON.stringify(pd.vzvodi));
t('skupno + 3 dimenzije + stopnja + proces', pd.skupno === pricakovano.skupno && Object.keys(pd.dimenzije).length === 3 && pd.stopnja?.naziv && pd.proces?.id === 'nabava');
t('brez SCORE_BOOKING_URL ni gumba za rezervacijo', pd.rezervacija === null);
r = await fetch(`${BASE}/r/${token}`);
t('stran porocila 200 + noindex', r.status === 200 && r.headers.get('x-robots-tag')?.includes('noindex') && (await r.text()).includes('noindex'));
t('neznan token 404', (await fetch(`${BASE}/r/AAAAAAAAAAAAAAAAAAAAAA/podatki`)).status === 404);
t('neveljaven token 404', (await fetch(`${BASE}/r/..%2F..%2Fetc/podatki`)).status === 404);

console.log('\n5. Outbox');
const done = await dokler(async () => (await db.query('SELECT ml_status, ai_status FROM score_results WHERE token = $1', [token])).rows[0]?.ml_status === 'ok');
t('ml_status ok', !!done);
const klic = mlKlici.find(k => k.body.email === `ana-${sufiks}@primer.si`);
t('mock: POST /api/subscribers z Bearer', klic?.url === '/api/subscribers' && klic?.auth === 'Bearer test-ml', klic?.auth);
t('mock: skupina + polja', JSON.stringify(klic?.body?.groups) === '["999"]' && klic?.body?.fields?.abs_score === pricakovano.skupno
  && klic?.body?.fields?.abs_lead === 'A' && klic?.body?.fields?.abs_marketing === 'da' && klic?.body?.fields?.phone === '041 123 456'
  && klic?.body?.fields?.abs_report_url?.endsWith(`/r/${token}`), JSON.stringify(klic?.body));
const aiRow = (await db.query('SELECT ai_status, besedilo FROM score_results WHERE token = $1', [token])).rows[0];
t('brez AI kljuca: ai_status failed, besedilo prazno', aiRow.ai_status === 'failed' && aiRow.besedilo === null);
t('porocilo ima besedilo iz predloge (v2: 5 priloznosti, dobro in zatika vsaj 3)',
  pd.besedilo?.odstavek?.includes(`Kovinar Test ${sufiks}`) && pd.besedilo.zatika.length >= 3 && pd.besedilo.priloznosti.length === 5 && pd.besedilo.dobro.length >= 3,
  JSON.stringify(pd.besedilo));

console.log('\n6. Odpornost outboxa');
const y = await post(oddaja({ email: `pade-${sufiks}@primer.si`, podjetje: `Pade ${sufiks}` }));
const tokY = y.d.reportUrl?.split('/').pop();
const retry = await dokler(async () => {
  const v = (await db.query('SELECT ml_status, attempts_ml, next_attempt_at > NOW() AS kasneje, last_error FROM score_results WHERE token = $1', [tokY])).rows[0];
  return v?.ml_status === 'retry' ? v : null;
});
t('500 -> retry, 1 poskus, naslednji kasneje', retry?.attempts_ml === 1 && retry?.kasneje === true && /HTTP 500/.test(retry?.last_error || ''), JSON.stringify(retry));
// Simulate a crashed worker: stale lock + due. The mock now succeeds for this e-mail.
await db.query(`UPDATE score_results SET ml_status = 'pending', locked_at = NOW() - INTERVAL '10 minutes', next_attempt_at = NOW() WHERE token = $1`, [tokY]);
await db.query(`UPDATE responses SET raw_data = jsonb_set(raw_data, '{email}', to_jsonb($2::text)) WHERE id = (SELECT response_id FROM score_results WHERE token = $1)`, [tokY, `ok-${sufiks}@primer.si`]);
const po = await dokler(async () => (await db.query('SELECT ml_status FROM score_results WHERE token = $1', [tokY])).rows[0]?.ml_status === 'ok');
t('zastarel zaklep se ponovno obdela', !!po);
// A fresh lock must NOT be taken.
await db.query(`UPDATE score_results SET ml_status = 'pending', locked_at = NOW(), next_attempt_at = NOW() WHERE token = $1`, [tokY]);
await pocakaj(1500);
t('svez zaklep ostane nedotaknjen', (await db.query('SELECT ml_status FROM score_results WHERE token = $1', [tokY])).rows[0].ml_status === 'pending');
await db.query(`UPDATE score_results SET locked_at = NULL, ml_status = 'ok' WHERE token = $1`, [tokY]);

console.log('\n7. Kvalifikacija podjetja');
t('prazna kvalifikacija dobi hot (A)', (await db.query('SELECT kvalifikacija FROM companies WHERE id = $1', [row.company_id])).rows[0].kvalifikacija === 'hot');
await db.query(`UPDATE companies SET kvalifikacija = 'cold', kvalifikacija_razlog = 'rocno' WHERE id = $1`, [row.company_id]);
const z = await post(oddaja({ email: `druga-${sufiks}@primer.si` }));
t('druga oddaja istega podjetja', z.status === 200 && z.d.companyId === row.company_id, JSON.stringify(z.d));
const kv = (await db.query('SELECT kvalifikacija, kvalifikacija_razlog FROM companies WHERE id = $1', [row.company_id])).rows[0];
t('obstojeca kvalifikacija NI povozena', kv.kvalifikacija === 'cold' && kv.kvalifikacija_razlog === 'rocno', JSON.stringify(kv));

console.log('\n8. Honeypot in dvojni klik');
const pred = (await db.query('SELECT count(*)::int n FROM score_results')).rows[0].n;
const hp = await post(oddaja({ email: `bot-${sufiks}@primer.si`, company_url: 'http://spam' }));
t('honeypot: ok, nic shranjeno', hp.d._hp === true && (await db.query('SELECT count(*)::int n FROM score_results')).rows[0].n === pred);
const dvojno = await post(oddaja());
t('dvojni klik -> isto porocilo', dvojno.d.deduplicated === true && dvojno.d.reportUrl === x.d.reportUrl, JSON.stringify(dvojno.d));

console.log('\n9. CSV izvoz');
t('brez prijave 401', (await fetch(`${BASE}/api/score/export.csv`)).status === 401);
r = await fetch(`${BASE}/api/score/export.csv`, { headers: { Authorization: AUTH } });
// fetch().text() silently drops a BOM, so check the raw bytes (Excel needs EF BB BF).
const bajti = new Uint8Array(await r.arrayBuffer());
const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bajti);
t('200 + text/csv + BOM', r.status === 200 && r.headers.get('content-type')?.startsWith('text/csv')
  && bajti[0] === 0xEF && bajti[1] === 0xBB && bajti[2] === 0xBF, [...bajti.slice(0, 3)].join(','));
t('glava s ; in sumniki', csv.split('\r\n')[0].includes('Ime;Priimek;E-pošta;Telefon;Podjetje'));
const vrstica = csv.split('\r\n').find(l => l.includes(`ana-${sufiks}@primer.si`)) || '';
t('vrstica z oceno, razredom in soglasjem', vrstica.includes(`;${pricakovano.skupno};`) && vrstica.includes(';A;') && vrstica.includes(';da;'), vrstica.slice(0, 160));
t('filter po datumu izloci', !(await (await fetch(`${BASE}/api/score/export.csv?od=2001-01-01&do=2001-01-02`, { headers: { Authorization: AUTH } })).text()).includes('@primer.si'));

console.log('\n10. Preklic porocila');
await db.query('UPDATE score_results SET revoked_at = NOW() WHERE token = $1', [token]);
t('preklicano -> 410', (await fetch(`${BASE}/r/${token}/podatki`)).status === 410);

// Cleanup: company delete cascades to responses and score_results.
await db.query(`DELETE FROM companies WHERE naziv_prikaz LIKE $1 OR naziv_prikaz LIKE $2`, [`%${sufiks}`, `Pade ${sufiks}`]);
mock.close(); await db.end();
console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
