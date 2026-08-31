// Cross-analiza (FAZA 1) — ruta /api/procesi/analiza, cisti modul
// src/procesi/analiza.js in stran /admin/analiza.html.
//
// Zakaj svoj nabor: analiza je edino mesto, kjer se odgovori vec strank
// seštevajo. Napacen imenovalec ali tiho zlit snapshot tu ne pokvarita videza
// strani — pokvarita TRDITEV, ki jo bo nekdo odnesel na sestanek.
//
// Zagon: node test/reset-testne-baze.mjs && node test/analiza.test.mjs
import puppeteer from 'puppeteer-core';
import { izracunajAnalizo, MAX_SEJ } from '../src/procesi/analiza.js';

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

// ── Priprava: tri seje z NAMENOMA razlicno izpolnjenostjo ─────────────────
console.log('\n=== 0. Priprava sej ===');
const predloge = await api('/api/procesi/predloge');
const predlogaId = predloge.telo?.predloge?.find((p) => p.aktivna)?.id;
t('procesna predloga obstaja', Number.isInteger(predlogaId), JSON.stringify(predloge.telo));

async function novaSeja(kartica, answers) {
  const r = await api('/api/procesi/seje', {
    method: 'POST', body: JSON.stringify({ questionnaire_id: predlogaId, ...kartica }),
  });
  const id = r.telo?.seja?.id;
  if (id && answers) await api(`/api/procesi/seje/${id}`, { method: 'PATCH', body: JSON.stringify({ answers }) });
  return id;
}

// A: izpolnjena in zakljucena.
const sidA = await novaSeja(
  { stranka_naziv: 'Analiza Hotel A', proces: 'priprava urnikov', oddelek: 'recepcija', svetovalec: 'Maks Zager', datum_sestanka: '2026-08-10' },
  {
    cilj: 'Urnik v enem dnevu namesto v treh.',
    problem: 'Vodja recepcije ga sestavlja ročno v Excelu.',
    vpliv: 'Šest ur na teden.',
    korist: { izbrano: ['prihranek časa', 'manj napak'], drugo: 'manj nesporazumov' },
    odlocitev_razlicno: 'da',
    vodstvo_podpira: 'da',
    kazalniki: [['Ure priprave', '6 ur', '1 ura', 'evidenca'], ['', '', '', ''], ['', '', '', '']],
  }
);
await api(`/api/procesi/seje/${sidA}/zakljuci`, { method: 'POST', body: JSON.stringify({ vsiljeno: true }) });

// B: delno izpolnjena, ostane osnutek.
const sidB = await novaSeja(
  { stranka_naziv: 'Analiza Hotel B', proces: 'obdelava povpraševanj', oddelek: 'prodaja', svetovalec: 'Peter Novak', datum_sestanka: '2026-08-11' },
  {
    cilj: 'Odgovor v eni uri.',
    problem: 'Povpraševanja prihajajo na tri naslove.',
    korist: { izbrano: ['prihranek časa'], drugo: '' },
    odlocitev_razlicno: 'delno',
    vodstvo_podpira: 'da',
  }
);

// C: najnovejsa in s SPREMENJENIM snapshotom — brez vprasanja "vpliv" in s
// preimenovanim "cilj". To je edini nacin, da se preveri posten imenovalec.
const sidC = await novaSeja(
  { stranka_naziv: 'Analiza Hotel C', proces: 'nabava živil', oddelek: 'kuhinja', svetovalec: 'Peter Novak', datum_sestanka: '2026-08-12' },
  { cilj: 'Manj odpisa živil.', odlocitev_razlicno: 'ne' }
);
const sejaC = await api(`/api/procesi/seje/${sidC}`);
const snapshotC = sejaC.telo.seja.questions_snapshot
  .filter((q) => q.id !== 'vpliv')
  .map((q) => (q.id === 'cilj' ? { ...q, label: 'Kaj želi hotel doseči? (prilagojeno)' } : q));
const patchC = await api(`/api/procesi/seje/${sidC}`, {
  method: 'PATCH', body: JSON.stringify({ questions_snapshot: snapshotC }),
});
t('snapshot seje C prilagojen', patchC.status === 200, patchC.status);
t('tri seje ustvarjene', [sidA, sidB, sidC].every(Number.isInteger), JSON.stringify([sidA, sidB, sidC]));

// ── 1. Osnovni odziv ──────────────────────────────────────────────────────
console.log('\n=== 1. Osnovni odziv ===');
let r = await api('/api/procesi/analiza');
t('GET analiza = 200', r.status === 200, r.status);
const a = r.telo;
t('vrne vse odseke',
  ['obseg', 'seje', 'pokritost', 'porazdelitve', 'tabele', 'besedilna', 'neskladja', 'filtri']
    .every((k) => a && k in a), Object.keys(a || {}).join(','));
t('obseg.sej = 3', a.obseg.sej === 3, a.obseg.sej);
t('obseg.strank = 3', a.obseg.strank === 3, a.obseg.strank);
t('obseg.svetovalcev = 2', a.obseg.svetovalcev === 2, a.obseg.svetovalcev);
t('po_statusu loci osnutke od zakljucenih',
  a.obseg.po_statusu.osnutek === 2 && a.obseg.po_statusu.zakljucen === 1,
  JSON.stringify(a.obseg.po_statusu));
t('opozori, da so v naboru osnutki',
  a.obseg.opozorila.some((o) => o.includes('osnutk')), JSON.stringify(a.obseg.opozorila));
t('seje razvrscene od najnovejse', a.seje[0].id === sidC, a.seje.map((s) => s.id).join(','));

const brezAuth = await fetch(BASE + '/api/procesi/analiza');
t('brez auth = 401', brezAuth.status === 401, brezAuth.status);

// ── 2. Posten imenovalec (nosilno pravilo modula) ─────────────────────────
console.log('\n=== 2. Posten imenovalec ===');
const pVpliv = a.pokritost.find((p) => p.id === 'vpliv');
t('vprasanje, ki ga seja C nima, ima imenovalec 2 (ne 3)', pVpliv.od_skupno === 2, JSON.stringify(pVpliv));
t('odgovorjeno samo v seji A', pVpliv.odgovorjeno_v === 1 && pVpliv.seje_z_odgovorom[0] === sidA,
  JSON.stringify(pVpliv.seje_z_odgovorom));
t('odstotek racunan cez 2, ne cez 3', pVpliv.odstotek === 50, pVpliv.odstotek);
t('seja C ni niti med brez_odgovora',
  !pVpliv.seje_brez_odgovora.includes(sidC), JSON.stringify(pVpliv.seje_brez_odgovora));

const pCilj = a.pokritost.find((p) => p.id === 'cilj');
t('vprasanje iz vseh sej ima imenovalec 3', pCilj.od_skupno === 3, pCilj.od_skupno);
t('cilj odgovorjen povsod', pCilj.odgovorjeno_v === 3 && pCilj.odstotek === 100, JSON.stringify(pCilj));

t('preimenovano vprasanje da neskladje',
  a.neskladja.some((n) => n.id === 'cilj' && n.vrsta === 'label'), JSON.stringify(a.neskladja));
t('label vzet iz najnovejsega snapshota',
  pCilj.label.includes('prilagojeno'), pCilj.label);
t('vsako vprasanje ima imenovalec najvec enak stevilu sej',
  a.pokritost.every((p) => p.od_skupno <= a.obseg.sej && p.odgovorjeno_v <= p.od_skupno));

// ── 3. Porazdelitve ───────────────────────────────────────────────────────
console.log('\n=== 3. Porazdelitve ===');
t('devet vprasanj z izbirami', a.porazdelitve.length === 9, a.porazdelitve.length);

const dRazlicno = a.porazdelitve.find((d) => d.id === 'odlocitev_razlicno');
t('radio: odgovorjeno v vseh treh', dRazlicno.odgovorjeno_v === 3, dRazlicno.odgovorjeno_v);
t('radio: da=1, delno=1, ne=1',
  ['da', 'delno', 'ne'].every((v) => dRazlicno.moznosti.find((m) => m.vrednost === v)?.sej === 1),
  JSON.stringify(dRazlicno.moznosti.map((m) => `${m.vrednost}=${m.sej}`)));
t('radio: ni oznacen kot vec izbir', dRazlicno.vec_izbir === false);
// Pri eni izbiri na sejo mora vsota IZBIR biti enaka stevilu sej z odgovorom.
// Vsota odstotkov to je samo priblizno (3 x 33 % = 99 %), zato se meri stevilo.
t('radio: vsota izbir je enaka stevilu sej z odgovorom',
  dRazlicno.moznosti.reduce((s, m) => s + m.sej, 0) === dRazlicno.odgovorjeno_v,
  dRazlicno.moznosti.reduce((s, m) => s + m.sej, 0));
t('radio: seje so poimensko navedene',
  dRazlicno.moznosti.find((m) => m.vrednost === 'da').seje[0] === sidA);

const dKorist = a.porazdelitve.find((d) => d.id === 'korist');
t('checkbox_multi je oznacen kot vec izbir', dKorist.vec_izbir === true);
t('checkbox_multi: prihranek casa v dveh sejah',
  dKorist.moznosti.find((m) => m.vrednost === 'prihranek časa').sej === 2);
t('checkbox_multi: vsota izbir sme presegati stevilo sej',
  dKorist.moznosti.reduce((s, m) => s + m.sej, 0) > dKorist.odgovorjeno_v,
  dKorist.moznosti.reduce((s, m) => s + m.sej, 0));
t('checkbox_multi: osnova je stevilo sej z odgovorom', dKorist.osnova === 'sej z odgovorom');
t('„drugo" ni prestet kot moznost',
  !dKorist.moznosti.some((m) => m.vrednost.includes('nesporazum')),
  JSON.stringify(dKorist.moznosti.map((m) => m.vrednost)));
t('„drugo" je vrnjen loceno, z imenom stranke',
  dKorist.drugo.length === 1 && dKorist.drugo[0].stranka === 'Analiza Hotel A',
  JSON.stringify(dKorist.drugo));
t('neizbrana moznost ostane v izpisu z 0',
  dKorist.moznosti.find((m) => m.vrednost === 'manjše tveganje')?.sej === 0);
t('nobena moznost ni oznacena kot izven seznama',
  a.porazdelitve.every((d) => d.moznosti.every((m) => !m.izven_seznama)));

// ── 4. Tabele in besedilni odgovori ──────────────────────────────────────
console.log('\n=== 4. Tabele in besedilo ===');
const tab = a.tabele.find((x) => x.id === 'kazalniki');
t('tabela kazalnikov je locena od porazdelitev', !!tab && a.porazdelitve.every((d) => d.id !== 'kazalniki'));
t('tabelo je izpolnila ena seja', tab.odgovorjeno_v === 1, tab.odgovorjeno_v);
t('prazne vrstice tabele so izpuscene', tab.seje[0].vrstice.length === 1,
  JSON.stringify(tab.seje[0].vrstice));
t('tabela nosi svoje stolpce', tab.seje[0].stolpci.length === 4, JSON.stringify(tab.seje[0].stolpci));

const bCilj = a.besedilna.find((b) => b.id === 'cilj');
t('besedilno vprasanje zbere odgovore vseh strank', bCilj.odgovori.length === 3, bCilj.odgovori.length);
t('odgovor nosi ime stranke in id seje',
  bCilj.odgovori.every((o) => o.stranka && Number.isInteger(o.seja_id)));
t('besedilo odgovora je dobesedno',
  bCilj.odgovori.some((o) => o.vrednost === 'Manj odpisa živil.'),
  JSON.stringify(bCilj.odgovori.map((o) => o.vrednost)));
t('vprasanja z izbirami niso podvojena v besedilnih',
  !a.besedilna.some((b) => ['korist', 'odlocitev_razlicno', 'kazalniki'].includes(b.id)));

// ── 5. Filtri ─────────────────────────────────────────────────────────────
console.log('\n=== 5. Filtri ===');
r = await api('/api/procesi/analiza?status=zakljucen');
t('status=zakljucen vrne eno sejo', r.telo.obseg.sej === 1, r.telo.obseg.sej);
r = await api('/api/procesi/analiza?status=zakljucen,osnutek');
t('seznam statusov je dovoljen', r.telo.obseg.sej === 3, r.telo.obseg.sej);
r = await api('/api/procesi/analiza?svetovalec=Peter');
t('filter po svetovalcu', r.telo.obseg.sej === 2, r.telo.obseg.sej);
r = await api('/api/procesi/analiza?stranka=Hotel C');
t('filter po stranki', r.telo.obseg.sej === 1, r.telo.obseg.sej);
r = await api('/api/procesi/analiza?od=2026-08-11');
t('filter od datuma', r.telo.obseg.sej === 2, r.telo.obseg.sej);
r = await api('/api/procesi/analiza?do=2026-08-10');
t('filter do datuma', r.telo.obseg.sej === 1, r.telo.obseg.sej);
r = await api(`/api/procesi/analiza?predloga=${predlogaId}`);
t('filter po predlogi', r.telo.obseg.sej === 3, r.telo.obseg.sej);
r = await api('/api/procesi/analiza?status=izmisljen');
t('neveljaven status = 400', r.status === 400 && r.telo.error === 'invalid_status', r.status);
r = await api('/api/procesi/analiza?od=10.8.2026');
t('neveljaven datum = 400', r.status === 400 && r.telo.error === 'invalid_datum', r.status);
r = await api('/api/procesi/analiza?predloga=abc');
t('neveljavna predloga = 400', r.status === 400, r.status);

// Arhiv: privzeto ga ni, s ?status=vse pa je.
await api(`/api/procesi/seje/${sidB}`, { method: 'PATCH', body: JSON.stringify({ status: 'arhiv' }) });
r = await api('/api/procesi/analiza');
t('arhivirana seja privzeto ni v analizi', r.telo.obseg.sej === 2, r.telo.obseg.sej);
r = await api('/api/procesi/analiza?status=vse');
t('status=vse zajame tudi arhiv', r.telo.obseg.sej === 3, r.telo.obseg.sej);
await api(`/api/procesi/seje/${sidB}`, { method: 'PATCH', body: JSON.stringify({ status: 'osnutek' }) });

// ── 6. Cisti modul (brez baze) ───────────────────────────────────────────
console.log('\n=== 6. Cisti modul ===');
const prazna = izracunajAnalizo([]);
t('prazen vhod ne vrze', prazna.obseg.sej === 0 && prazna.pokritost.length === 0);
t('prazen vhod opozori, da nabora ni', prazna.obseg.opozorila.length > 0);
t('vhod, ki ni seznam, ne vrze', izracunajAnalizo(null).obseg.sej === 0);

const vprasanje = (id, tip = 'text', dodatno = {}) => ({ id, label: id, tip, ...dodatno });
const izmisljene = Array.from({ length: MAX_SEJ + 5 }, (_, i) => ({
  id: 1000 - i, stranka_naziv: `Stranka ${i}`, status: 'osnutek', questionnaire_id: 1,
  naziv_prikaz: 'Predloga', questions_snapshot: [vprasanje('x')], answers: { x: 'da' },
}));
const odrezana = izracunajAnalizo(izmisljene);
t(`nad ${MAX_SEJ} sej se nabor omeji`, odrezana.obseg.sej === MAX_SEJ, odrezana.obseg.sej);
t('odrezane seje niso odrezane tiho',
  odrezana.obseg.odrezanih === 5 && odrezana.obseg.opozorila.some((o) => o.includes('omejen')),
  JSON.stringify(odrezana.obseg));

// Ruta vhod ze omeji s SQL LIMIT, zato dolzina vhoda NI posteno stevilo vseh
// sej — pravi COUNT pride kot drugi parameter. Pri 500 ujemajocih sejah mora
// opozorilo reci "400 ni vkljucenih", ne "0" (vhod dolzine MAX_SEJ) ali "100".
const sPravimStevcem = izracunajAnalizo(izmisljene.slice(0, MAX_SEJ), 500);
t('odrezanih se steje iz pravega COUNT, ne iz dolzine vhoda',
  sPravimStevcem.obseg.odrezanih === 500 - MAX_SEJ,
  sPravimStevcem.obseg.odrezanih);
t('opozorilo nosi pravo stevilo',
  sPravimStevcem.obseg.opozorila.some((o) => o.includes(`${500 - MAX_SEJ} najstarejsih`)),
  JSON.stringify(sPravimStevcem.obseg.opozorila));
t('neveljaven ali premajhen stevec pade nazaj na dolzino vhoda',
  izracunajAnalizo(izmisljene, 3).obseg.odrezanih === 5
    && izracunajAnalizo(izmisljene.slice(0, 10), undefined).obseg.odrezanih === 0,
  JSON.stringify([izracunajAnalizo(izmisljene, 3).obseg.odrezanih]));

const razlicniTipi = izracunajAnalizo([
  { id: 2, stranka_naziv: 'B', status: 'osnutek', questionnaire_id: 1, naziv_prikaz: 'P',
    questions_snapshot: [vprasanje('y', 'radio', { options: ['da', 'ne'] })], answers: { y: 'da' } },
  { id: 1, stranka_naziv: 'A', status: 'osnutek', questionnaire_id: 1, naziv_prikaz: 'P',
    questions_snapshot: [vprasanje('y', 'text')], answers: { y: 'nekaj' } },
]);
t('nasprotujoc tip vprasanja se javi kot neskladje',
  razlicniTipi.neskladja.some((n) => n.vrsta === 'tip'), JSON.stringify(razlicniTipi.neskladja));
t('ob nasprotujocem tipu porazdelitve ne izracunamo',
  razlicniTipi.porazdelitve.length === 0, JSON.stringify(razlicniTipi.porazdelitve));

const dvePredlogi = izracunajAnalizo([
  { id: 2, stranka_naziv: 'B', status: 'osnutek', questionnaire_id: 2, naziv_prikaz: 'Druga',
    questions_snapshot: [vprasanje('z')], answers: { z: 'a' } },
  { id: 1, stranka_naziv: 'A', status: 'osnutek', questionnaire_id: 1, naziv_prikaz: 'Prva',
    questions_snapshot: [vprasanje('z')], answers: {} },
]);
t('vec predlog v naboru sprozi opozorilo',
  dvePredlogi.obseg.opozorila.some((o) => o.includes('predlog')), JSON.stringify(dvePredlogi.obseg.opozorila));
t('vrednost izven seznama options se steje in oznaci', (() => {
  const x = izracunajAnalizo([{
    id: 1, stranka_naziv: 'A', status: 'osnutek', questionnaire_id: 1, naziv_prikaz: 'P',
    questions_snapshot: [vprasanje('w', 'radio', { options: ['da'] })], answers: { w: 'stara vrednost' },
  }]);
  const m = x.porazdelitve[0].moznosti.find((o) => o.vrednost === 'stara vrednost');
  return m && m.sej === 1 && m.izven_seznama === true;
})());

// ── 7. Stran /admin/analiza.html ─────────────────────────────────────────
console.log('\n=== 7. Stran ===');
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });
// Manjkajoc favicon je lastnost celotnega admina (nobena stran ga nima) in
// ne napaka te strani — v besedilu sporocila ga ni, je pa v lokaciji.
const jeFavicon = (m) => (m.location?.()?.url || '').includes('favicon');
const napake = [];
page.on('console', (m) => { if (m.type() === 'error' && !jeFavicon(m)) napake.push(m.text()); });
page.on('pageerror', (e) => napake.push('pageerror: ' + e.message));

await page.setViewport({ width: 1440, height: 1000 });
await page.goto(BASE + '/admin/analiza.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !document.getElementById('stevec').textContent.includes('nalagam'), { timeout: 10000 });

t('glava pokaze stevilo sej in strank',
  (await page.$eval('#stevec', (e) => e.textContent)).includes('3 seje'),
  await page.$eval('#stevec', (e) => e.textContent));
t('navigacija oznaci Primerjavo kot aktivno',
  !!(await page.$('.sidebar-item.active[href="/admin/analiza.html"]')));
t('KPI kartice so izpolnjene',
  (await page.$$eval('#kpi .kpi .v', (e) => e.map((x) => x.textContent))).every((v) => v && v !== '—'),
  JSON.stringify(await page.$$eval('#kpi .kpi .v', (e) => e.map((x) => x.textContent))));
t('opozorilo o osnutkih je vidno na strani',
  (await page.$eval('#opozorila', (e) => e.textContent)).includes('osnutk'));

// Matrika
t('matrika ima stolpec za vsako sejo',
  (await page.$$eval('#matrika thead th.seja', (e) => e.length)) === 3);
t('matrika ima vrstico za vsako vprasanje',
  (await page.$$eval('#matrika tbody tr:not(.skupina)', (e) => e.length)) === a.pokritost.length,
  await page.$$eval('#matrika tbody tr:not(.skupina)', (e) => e.length));
t('vrstice so grupirane po sklopih',
  (await page.$$eval('#matrika tbody tr.skupina', (e) => e.length)) >= 8);
t('celica „vprasanja v tej seji ni" je razlicna od prazne',
  (await page.$$eval('#matrika .ni-vprasanja', (e) => e.length)) === 1,
  await page.$$eval('#matrika .ni-vprasanja', (e) => e.length));
t('imena strank v glavi vodijo na sejo',
  (await page.$$eval('#matrika thead th.seja a', (e) => e.map((x) => x.getAttribute('href'))))
    .every((h) => h.startsWith('/admin/proces-seja.html?id=')));

// Zavihki: samo en panel naenkrat (Tailwindov .flex je nekoc povozil [hidden]).
const vidniPaneli = () => page.$$eval('[data-panel]', (p) => p.filter((x) => !x.hidden).map((x) => x.dataset.panel));
t('privzeto je viden samo panel pokritosti',
  JSON.stringify(await vidniPaneli()) === '["pokritost"]', JSON.stringify(await vidniPaneli()));
await page.click('[data-zavihek="porazdelitve"]');
await pocakaj(250);
t('klik na zavihek zamenja panel',
  JSON.stringify(await vidniPaneli()) === '["porazdelitve"]', JSON.stringify(await vidniPaneli()));
t('aktiven zavihek je oznacen', !!(await page.$('.tab.active[data-zavihek="porazdelitve"]')));
t('zavihek se zapise v naslov strani', page.url().includes('zavihek=porazdelitve'), page.url());

// Porazdelitve: sirina stolpica se mora ujemati z izpisanim odstotkom.
const ujemanje = await page.$$eval('#porazdelitve .vrsta-moznosti', (vrstice) => vrstice.map((v) => ({
  sirina: v.querySelector('.stolpic i').style.width,
  odstotek: v.querySelector('.st .pc').textContent.trim(),
})));
t('stolpic meri delez, ne deleza najvecje vrednosti',
  ujemanje.every((u) => u.sirina.replace('%', '') === u.odstotek.replace('%', '')),
  JSON.stringify(ujemanje.slice(0, 3)));
t('vec izbir je oznaceno na strani',
  (await page.$eval('#porazdelitve', (e) => e.textContent)).includes('več izbir'));
t('stevilo sej in delez sta locena elementa (ne "1 · 17 %")',
  (await page.$eval('#porazdelitve .vrsta-moznosti .st', (e) =>
    !!e.querySelector('b') && !!e.querySelector('.pc') && !e.textContent.includes('·'))));

// Slovenscina: dvojina in rodilnik. "2 svetovalcev" in "3 osnutkov" sta napaki,
// ki ju bralec opazi takoj, test pa brez izrecne trditve nikoli.
const kpiBesedilo = await page.$eval('#kpi', (e) => e.textContent.replace(/\s+/g, ' '));
t('sklanjanje v KPI je pravilno',
  kpiBesedilo.includes('2 svetovalca') && kpiBesedilo.includes('1 vprašalnik')
    && !kpiBesedilo.includes('svetovalcev ·'), kpiBesedilo);
t('sklon() pravilno sklanja 1, 2, 3 in 5',
  await page.evaluate(() => [
    sklon(1, SKLONI.seja), sklon(2, SKLONI.seja), sklon(3, SKLONI.seja), sklon(5, SKLONI.seja),
  ].join('|')) === '1 seja|2 seji|3 seje|5 sej');

// Odgovori: privzeto strnjeno, gumba in iskanje delujejo.
await page.click('[data-zavihek="odgovori"]');
await pocakaj(250);
const stBlokov = await page.$$eval('details.vprasanje-blok', (d) => d.length);
t('vsako besedilno vprasanje ima svoj blok', stBlokov === a.besedilna.filter((b) => b.odgovorjeno_v > 0).length,
  `${stBlokov} proti ${a.besedilna.filter((b) => b.odgovorjeno_v > 0).length}`);
t('bloki so privzeto strnjeni',
  (await page.$$eval('details.vprasanje-blok[open]', (d) => d.length)) === 0);
await page.click('#bRazpri');
await pocakaj(150);
t('„Razpri vse" odpre vse bloke',
  (await page.$$eval('details.vprasanje-blok[open]', (d) => d.length)) === stBlokov);
await page.click('#bStrni');
await pocakaj(150);
t('„Strni vse" jih zapre',
  (await page.$$eval('details.vprasanje-blok[open]', (d) => d.length)) === 0);

await page.type('#iskanjeOdgovori', 'odpisa živil');
await pocakaj(500);
const vidniBloki = await page.$$eval('details.vprasanje-blok', (d) => d.filter((x) => !x.hidden).length);
t('iskanje po besedilu odgovora zozi seznam', vidniBloki >= 1 && vidniBloki < stBlokov, vidniBloki);
t('zadetek iskanja se tudi odpre',
  (await page.$$eval('details.vprasanje-blok[open]', (d) => d.length)) >= 1);
await page.$eval('#iskanjeOdgovori', (e) => { e.value = ''; e.dispatchEvent(new Event('input')); });
await pocakaj(400);
t('prazno iskanje vrne vse bloke',
  (await page.$$eval('details.vprasanje-blok', (d) => d.filter((x) => !x.hidden).length)) === stBlokov);

// Kazalniki
await page.click('[data-zavihek="kazalniki"]');
await pocakaj(250);
t('kazalniki pokazejo tabelo izpolnjene seje',
  (await page.$$eval('#kazalniki table.kaz tbody tr', (e) => e.length)) === 1,
  await page.$$eval('#kazalniki table.kaz tbody tr', (e) => e.length));

// Filtri na strani morajo RES zoziti nabor, ne samo prebarvati znacke.
async function pocakajNaStevec(vzorec, ime) {
  try {
    await page.waitForFunction(
      (v) => document.getElementById('stevec').textContent.includes(v),
      { timeout: 8000 }, vzorec);
    t(ime, true);
  } catch {
    t(ime, false, await page.$eval('#stevec', (e) => e.textContent));
  }
}

await page.select('#fStatus', 'zakljucen');
await pocakajNaStevec('1 seja', 'filter statusa zozi nabor');
t('aktiven filter dobi znacko', (await page.$$eval('#znacke .chip.active', (e) => e.length)) === 1);
t('filter se zapise v naslov strani', page.url().includes('status=zakljucen'), page.url());
await page.click('#znacke .chip.active');
await pocakajNaStevec('3 seje', 'klik na × odstrani filter');

// Prazen nabor: vsi stirje zavihki morajo povedati isto, sicer "ni besedilnih
// odgovorov" zveni, kot da seje so, pa so prazne.
await page.type('#fStranka', 'nicesar-takega-ni');
await pocakajNaStevec('0 sej', 'prazen nabor se pozna v glavi');
const prazna4 = {};
for (const z of ['pokritost', 'porazdelitve', 'odgovori', 'kazalniki']) {
  await page.click(`[data-zavihek="${z}"]`);
  await pocakaj(150);
  prazna4[z] = (await page.$eval(`[data-panel="${z}"]`, (e) => e.textContent)).includes('Nobena seja ne ustreza filtrom');
}
t('vsi stirje zavihki povedo isto ob praznem naboru',
  Object.values(prazna4).every(Boolean), JSON.stringify(prazna4));
t('opozorilo pojasni, da prazno ni isto kot neodgovorjeno',
  (await page.$eval('#opozorila', (e) => e.textContent)).includes('filter je preozek'));
await page.click('#bPocisti');
await pocakajNaStevec('3 seje', '„Počisti" vrne cel nabor');
await page.click('[data-zavihek="odgovori"]');
await pocakaj(200);

// Nobena povezava na strani ne sme biti mrtva.
await page.click('#bRazpri').catch(() => {});
const povezave = [...new Set(await page.$$eval('main a[href]', (as) => as.map((x) => x.getAttribute('href'))))];
t('vse povezave kazejo na admin strani', povezave.every((h) => h && h.startsWith('/admin/')), JSON.stringify(povezave.slice(0, 5)));
const stanja = [];
for (const h of povezave.slice(0, 8)) {
  const res = await fetch(BASE + h.split('#')[0], { headers: { Authorization: AUTH } });
  stanja.push(`${h}=${res.status}`);
}
t('ciljne strani obstajajo', stanja.every((s) => s.endsWith('=200')), JSON.stringify(stanja));

// Mobilno: stran se ne sme preliti cez rob.
await page.setViewport({ width: 390, height: 900 });
await pocakaj(400);
const mob = await page.evaluate(() => ({
  telo: document.body.scrollWidth, okno: window.innerWidth,
  stranska: !!document.getElementById('sidebar')?.offsetParent,
}));
t('na 390px ni vodoravnega drsenja strani', mob.telo <= mob.okno + 1, JSON.stringify(mob));
t('na 390px je stranska vrstica skrita', mob.stranska === false);

t('brez JS napak', napake.length === 0, JSON.stringify(napake.slice(0, 2)));

// Pospravi testne seje.
for (const sid of [sidA, sidB, sidC]) {
  await api(`/api/procesi/seje/${sid}`, { method: 'PATCH', body: JSON.stringify({ status: 'arhiv' }) });
}

await browser.close();
console.log('\n──────────────────────────────────────────────');
console.log(`OK: ${ok}   FAIL: ${fail}`);
if (padli.length) { console.log('Padli:'); padli.forEach((p) => console.log('  - ' + p)); }
process.exit(fail ? 1 : 0);
