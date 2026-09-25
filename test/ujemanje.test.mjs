// Ujemanje podjetij (src/ai/match_company.js) nad pravo testno bazo, AI je
// lazen (globalni fetch za api.anthropic.com vrne odlocitev, ki jo doloci
// primer). Nastalo 25. 9. 2026, ko so bila v prod bazi tri podjetja za isto
// organizacijo (polno ime, skrajsano ime in kratica), vsa z e-naslovi na isti
// domeni. Imena v testu so izmisljena.
//
// Zagon (baza mora imeti migracije do 012; tece tudi strezniski del, ce je
// TEST_BASE dosegljiv):
//   TEST_DB_URL=postgres://... TEST_BASE=http://127.0.0.1:3399 node test/ujemanje.test.mjs
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test-lazni';
// Ista spremenljivka kot ostali testi; db.js (ki ga uvozi match_company) bere DATABASE_URL.
process.env.DATABASE_URL = process.env.TEST_DB_URL || process.env.DATABASE_URL || 'postgres://postgres:test@127.0.0.1:5435/vprasalniki';
import pg from 'pg';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3399';
const AUTH = 'Basic ' + Buffer.from('test@acenta.si:testgeslo123').toString('base64');

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

// ── Lazen AI ──────────────────────────────────────────────────────────────
// aiOdlocitev: id → AI izbere to podjetje; null → AI ne potrdi;
// 'napaka' → API vrne 500 (AI nedosegljiv).
let aiOdlocitev = null;
let aiKlici = [];
const praviFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('api.anthropic.com')) return praviFetch(url, opts);
  const body = JSON.parse(opts.body);
  aiKlici.push(body);
  if (aiOdlocitev === 'napaka') {
    return { status: 500, ok: false, text: async () => 'lazna napaka', json: async () => ({}) };
  }
  const besedilo = JSON.stringify({ match_id: aiOdlocitev, razlog: 'lazni AI' });
  return {
    status: 200, ok: true,
    json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: besedilo }] }),
  };
};

const tiho = console.log;
const { najdiPodjetjeAI, sluzbenaDomena, jeKratica } = await import('../src/ai/match_company.js');
const { normalizirajNaziv } = await import('../src/utils/normalize.js');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ── Pripomocki ────────────────────────────────────────────────────────────
const { rows: [{ max: pred }] } = await pool.query('SELECT COALESCE(MAX(id), 0) AS max FROM companies');
const { rows: [q] } = await pool.query(`
  INSERT INTO questionnaires (slug, naziv_prikaz, povzetek_system_prompt, povzetek_user_template,
                              priporocila_system_prompt, priporocila_user_template, namen)
  VALUES ('test-ujemanje', 'Test ujemanje', '', '', '', '', 'shramba') RETURNING id`);

async function podjetje(prikaz, norm, odgovori) {
  const { rows: [c] } = await pool.query(
    'INSERT INTO companies (naziv_normaliziran, naziv_prikaz) VALUES ($1, $2) RETURNING id', [norm, prikaz]);
  for (const raw of odgovori) {
    await pool.query('INSERT INTO responses (company_id, questionnaire_id, raw_data) VALUES ($1, $2, $3)',
      [c.id, q.id, JSON.stringify(raw)]);
  }
  return c.id;
}

// Tihi klic (match_company logira vsak izid) + stevilo AI klicev.
async function ujemi(naziv, payload) {
  aiKlici = [];
  console.log = () => {};
  const r = await najdiPodjetjeAI(naziv, { payload });
  console.log = tiho;
  return r;
}
const dvojnikOd = async (id) =>
  (await pool.query('SELECT mozni_dvojnik_id, mozni_dvojnik_razlog FROM companies WHERE id = $1', [id])).rows[0];
const pobrisi = (id) => pool.query('DELETE FROM companies WHERE id = $1', [id]);

// Stari zapisi imajo naziv_normaliziran po stari normalizaciji (s sumniki,
// z "javni zavod") — tako kot v prod bazi.
const TKM = await podjetje('Javni zavod Turizem in kultura Mlinsko', 'javni zavod turizem in kultura mlinsko', [
  { podjetje: 'Javni zavod Turizem in kultura Mlinsko', email: 'ana@tk-mlinsko.si' },
  { podjetje: 'Turizem in kultura Mlinsko', email: 'bor@tk-mlinsko.si' },
]);
const LIPA = await podjetje('Hotel Lipa', 'lipa', [{ podjetje: 'Hotel Lipa', email: 'info@veriga-hotelov.si' }]);
const CUBO = await podjetje('Hotel Cubo', 'cubo', [{ podjetje: 'Hotel Cubo', email: 'cubo@gmail.com' }]);
const KOVACIC = await podjetje('Gostišče Kovačič', 'gostišče kovačič', [{ podjetje: 'Gostišče Kovačič' }]);
// Odgovor v prostem besedilu omenja tuj e-naslov — ne sme postati domena tega podjetja.
const ZUPAN = await podjetje('Kmetija Zupan', 'kmetija zupan', [
  { podjetje: 'Kmetija Zupan', email: 'info@kmetija-zupan.si', opomba: 'sodelujemo z info@veriga-hotelov.si' },
]);

try {
  console.log('\n=== pomozne funkcije ===');
  t('gmail ni sluzbena domena', sluzbenaDomena({ email: 'a@gmail.com' }) === null);
  t('acenta.si se ne steje (izpolnjujemo za stranke)', sluzbenaDomena({ email: 'maks@acenta.si' }) === null);
  t('domena iz znanega kljuca', sluzbenaDomena({ email: 'Ana@TK-Mlinsko.SI' }) === 'tk-mlinsko.si');
  t('domena iz polja z "mail" v imenu (custom_html)', sluzbenaDomena({ kontakt_email: 'Ana <ana@kovacic.si>' }) === 'kovacic.si');
  t('prosto besedilo s tujim e-naslovom se ne steje', sluzbenaDomena({ opomba: 'pisite na info@tuje.si' }) === null);
  t('gmail v email + sluzbeni v drugem polju → sluzbeni',
    sluzbenaDomena({ email: 'ana@gmail.com', kontakt_email: 'ana@kovacic.si' }) === 'kovacic.si');
  t('brez e-naslova null', sluzbenaDomena({ podjetje: 'X' }) === null);
  t('normalizacija: brez sumnikov', normalizirajNaziv('Gostišče Kovačič Brežice') === 'kovacic brezice',
    normalizirajNaziv('Gostišče Kovačič Brežice'));
  t('normalizacija: JZ in javni zavod odpadeta',
    normalizirajNaziv('JZ Turizem in kultura Mlinsko') === 'turizem in kultura mlinsko'
    && normalizirajNaziv('Javni zavod Turizem in kultura Mlinsko') === 'turizem in kultura mlinsko');
  t('kratica TKM', jeKratica('tkm', 'turizem in kultura mlinsko'));
  t('kratica TIKM (z malimi besedami)', jeKratica('tikm', 'turizem in kultura mlinsko'));
  t('ni kratica za enobesedno ime', !jeKratica('cu', 'cubo'));

  console.log('\n=== 1. enako ime, tudi pod prej vpisanim imenom ===');
  let r = await ujemi('Turizem in kultura Mlinsko', { email: 'x@gmail.com' });
  t('najde TKM prek imena iz starega odgovora', r?.companyId === TKM && r.source === 'exact', JSON.stringify(r));
  t('brez AI klica', aiKlici.length === 0);
  r = await ujemi('JZ Turizem in kultura Mlinsko', {});
  t('"JZ ..." = "Javni zavod ..."', r?.companyId === TKM && r.source === 'exact', JSON.stringify(r));
  r = await ujemi('Gostisce Kovacic', {});
  t('brez sumnikov najde star zapis s sumniki', r?.companyId === KOVACIC && r.source === 'exact', JSON.stringify(r));

  console.log('\n=== 2. kratica + ista domena, AI potrdi ===');
  aiOdlocitev = TKM;
  r = await ujemi('JZ TKM', { email: 'cilka@tk-mlinsko.si' });
  t('zdruzi v TKM', r?.companyId === TKM && r.source === 'domena_ai', JSON.stringify(r));
  t('en AI klic na Sonnet 5', aiKlici.length === 1 && aiKlici[0].model === 'claude-sonnet-5', aiKlici.map(k => k.model).join());
  const prompt = aiKlici[0]?.messages?.[0]?.content || '';
  t('AI dobi znak "ista domena"', prompt.includes('ISTA domena'));
  t('AI dobi znak "kratica"', prompt.includes('kratica'));
  t('AI dobi prej vpisana imena', prompt.includes('"Turizem in kultura Mlinsko"'));

  console.log('\n=== 3. ista domena, AI NE potrdi → novo + opozorilo ===');
  aiOdlocitev = null;
  r = await ujemi('JZ TKM', { email: 'cilka@tk-mlinsko.si' });
  t('ustvari novo podjetje', r?.source === 'created' && r.companyId !== TKM, JSON.stringify(r));
  let d = await dvojnikOd(r.companyId);
  t('oznaci mozen dvojnik TKM', d?.mozni_dvojnik_id === TKM, JSON.stringify(d));
  t('razlog omenja domeno', d?.mozni_dvojnik_razlog?.includes('tk-mlinsko.si'), d?.mozni_dvojnik_razlog);
  await pobrisi(r.companyId);

  console.log('\n=== 4. AI nedosegljiv → novo + opozorilo (nikoli tihe zdruzitve) ===');
  aiOdlocitev = 'napaka';
  r = await ujemi('JZ TKM', { email: 'cilka@tk-mlinsko.si' });
  t('ustvari novo podjetje', r?.source === 'created', JSON.stringify(r));
  d = await dvojnikOd(r.companyId);
  t('oznaci mozen dvojnik TKM', d?.mozni_dvojnik_id === TKM, JSON.stringify(d));
  await pobrisi(r.companyId);

  console.log('\n=== 5. veriga: ista domena, drugo ime → AI ne zdruzi ===');
  aiOdlocitev = null;
  r = await ujemi('Hotel Breza', { email: 'breza@veriga-hotelov.si' });
  t('ustvari novo podjetje', r?.source === 'created' && r.companyId !== LIPA, JSON.stringify(r));
  t('AI je bil vprasan', aiKlici.length === 1);
  d = await dvojnikOd(r.companyId);
  t('opozorilo za cloveka (ista domena)', d?.mozni_dvojnik_id === LIPA, JSON.stringify(d));
  await pobrisi(r.companyId);

  console.log('\n=== 6. podobno ime, a nasprotujoca domena → ne zdruzi ===');
  aiOdlocitev = LIPA;
  r = await ujemi('Hotel Lipaa', { email: 'info@lipa-drugje.si' });
  t('ni samodejne zdruzitve kljub lev=1', r?.source === 'created' && r.companyId !== LIPA, JSON.stringify(r));
  t('odlocil je AI, ne prag', aiKlici.length === 1);
  d = await dvojnikOd(r.companyId);
  t('AI meni isto → opozorilo z obema domenama', d?.mozni_dvojnik_id === LIPA && d.mozni_dvojnik_razlog.includes('lipa-drugje.si'),
    JSON.stringify(d));
  await pobrisi(r.companyId);

  console.log('\n=== 7. tipkarska napaka brez domen → samodejno kot doslej ===');
  aiOdlocitev = null;
  // En sam kandidat ("kubo" bi bil tudi do "lipa" oddaljen le 4 znake → AI).
  r = await ujemi('Hotel Cubbo', { email: 'cubbo@gmail.com' });
  t('fuzzy_auto v Cubo', r?.companyId === CUBO && r.source === 'fuzzy_auto', JSON.stringify(r));
  t('brez AI klica', aiKlici.length === 0);

  console.log('\n=== 8. obrazec brez imena podjetja ===');
  r = await ujemi(`NEZNANO_PODJETJE_${Date.now()}`, { email: 'dana@tk-mlinsko.si' });
  t('ustvari novo podjetje', r?.source === 'created', JSON.stringify(r));
  d = await dvojnikOd(r.companyId);
  t('oznaci verjetno podjetje po domeni', d?.mozni_dvojnik_id === TKM, JSON.stringify(d));
  const brezImena = r.companyId;

  console.log('\n=== 8b. enako ime, a nasprotujoca domena (Codex) ===');
  aiKlici = [];
  r = await ujemi('Hotel Lipa', { email: 'info@lipa-drugje.si' });
  t('NE zdruzi v Hotel Lipa @veriga-hotelov.si', r?.source === 'created' && r.companyId !== LIPA, JSON.stringify(r));
  d = await dvojnikOd(r.companyId);
  t('locena vrstica z oznako dvojnika kljub unikatnemu kljucu', d?.mozni_dvojnik_id === LIPA, JSON.stringify(d));
  const { rows: [lipa2] } = await pool.query('SELECT naziv_prikaz FROM companies WHERE id = $1', [LIPA]);
  t('obstojecemu podjetju ime ni prepisano', lipa2.naziv_prikaz === 'Hotel Lipa', lipa2.naziv_prikaz);
  const drugaLipa = r.companyId;
  r = await ujemi('Hotel Lipa', { email: 'recepcija@lipa-drugje.si' });
  t('naslednja oddaja @lipa-drugje.si gre v locen Lipa', r?.companyId === drugaLipa && r.source === 'exact', JSON.stringify(r));
  r = await ujemi('Hotel Lipa', { email: 'nabava@veriga-hotelov.si' });
  t('oddaja @veriga-hotelov.si gre v prvotni Lipa', r?.companyId === LIPA && r.source === 'exact', JSON.stringify(r));
  r = await ujemi('Hotel Lipa', { email: 'x@gmail.com' });
  t('brez domene: enako ime ostane samodejno (kot doslej)', [LIPA, drugaLipa].includes(r?.companyId) && r.source === 'exact', JSON.stringify(r));
  await pobrisi(drugaLipa);

  console.log('\n=== 8c. tuj e-naslov v prostem besedilu ne povzroci konflikta ===');
  aiOdlocitev = null;
  r = await ujemi('Kmetija Zupan', { email: 'miha@kmetija-zupan.si' });
  t('enako ime + ista domena → zdruzi', r?.companyId === ZUPAN && r.source === 'exact', JSON.stringify(r));
  r = await ujemi('Hotel Breza', { email: 'breza@veriga-hotelov.si' });
  t('@veriga-hotelov.si iz opombe ne naredi Zupana kandidata', !aiKlici.some(k => (k.messages?.[0]?.content || '').includes('Kmetija Zupan')),
    'Zupan je bil med kandidati');
  if (r?.source === 'created') await pobrisi(r.companyId);

  console.log('\n=== 9. popolnoma novo podjetje ===');
  r = await ujemi('Vinska klet Bric', { email: 'info@klet-bric.si' });
  t('ustvari brez opozorila', r?.source === 'created' && !(await dvojnikOd(r.companyId)).mozni_dvojnik_id, JSON.stringify(r));
  t('brez AI klica (ni kandidatov)', aiKlici.length === 0);

  console.log('\n=== 10. API: opozorilo na strani podjetja ===');
  const api = async (pot, opts = {}) => {
    const res = await praviFetch(BASE + pot, { ...opts, headers: { Authorization: AUTH, 'content-type': 'application/json' } });
    return { status: res.status, telo: await res.json().catch(() => null) };
  };
  const dosegljiv = await praviFetch(BASE + '/health').then(x => x.ok).catch(() => false);
  if (!dosegljiv) {
    t(`streznik na ${BASE} dosegljiv (za API del)`, false, 'ni dosegljiv');
  } else {
    let a = await api(`/api/companies/${brezImena}`);
    t('GET vrne mozni_dvojnik z imenom', a.telo?.mozni_dvojnik?.id === TKM
      && a.telo.mozni_dvojnik.naziv_prikaz === 'Javni zavod Turizem in kultura Mlinsko', JSON.stringify(a.telo?.mozni_dvojnik));
    a = await api(`/api/companies/${brezImena}`, { method: 'PATCH', body: JSON.stringify({ mozni_dvojnik_id: 5 }) });
    t('PATCH z id-jem zavrnjen (nastavi ga le ujemanje)', a.status === 400, a.status);
    a = await api(`/api/companies/${brezImena}`, { method: 'PATCH', body: JSON.stringify({ mozni_dvojnik_id: null }) });
    t('PATCH null = "Ni isto podjetje"', a.status === 200 && a.telo?.company?.mozni_dvojnik_id === null, JSON.stringify(a.telo));
    a = await api(`/api/companies/${brezImena}`);
    t('opozorila ni vec', a.telo?.mozni_dvojnik === null && a.telo?.company?.mozni_dvojnik_razlog === null);
    a = await api(`/api/companies/${TKM}`);
    t('podjetje brez opozorila vrne null', a.telo?.mozni_dvojnik === null);
  }
} finally {
  // Pospravi vse, kar je test ustvaril (tudi ce je padel sredi primera).
  console.log = tiho;
  await pool.query('DELETE FROM companies WHERE id > $1', [pred]);
  await pool.query('DELETE FROM questionnaires WHERE id = $1', [q.id]);
  await pool.end();
}

console.log(`\n${'─'.repeat(46)}\nOK: ${ok}   FAIL: ${fail}`);
if (padli.length) console.log('Padli:\n  - ' + padli.join('\n  - '));
process.exit(fail ? 1 : 0);
