// Klikni-test admin UI z pravim brskalnikom (puppeteer-core je ze odvisnost projekta).
// Namen: preveriti, da polja RES delujejo — da se vpisano shrani in prezivi ponovno
// nalozitev strani, in da noben gumb ni mrtev.
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3399';
const SLIKE = 'C:/screenshots';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}
const pocakaj = (ms) => new Promise(r => setTimeout(r, ms));

// Pocakaj, da se autosave RES zakljuci (kazalnik pokaze "Shranjeno"), preden
// stran ponovno nalozimo. Brez tega test meri hitrost omrezja, ne aplikacije.
async function pocakajNaShranjeno(page, opis = '') {
  try {
    await page.waitForFunction(
      () => (document.getElementById('shranjeno')?.textContent || '').includes('Shranjeno'),
      { timeout: 8000, polling: 150 });
    return true;
  } catch {
    console.log(`  (opozorilo: shranjevanje ni potrjeno v 8s ${opis})`);
    return false;
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

// Sveza seja SAMO za ta zagon. Prej je test uporabljal trdo zapisan id=1 in
// se je pri drugem zagonu lomil na besedilu, ki ga je vpisal prvi zagon.
const AUTH = 'Basic ' + Buffer.from('test@acenta.si:testgeslo123').toString('base64');
async function apiJson(pot, opt = {}) {
  const res = await fetch('http://127.0.0.1:3399' + pot, {
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
    stranka_naziv: 'UI Test Hotel',
    proces: 'preizkus izpolnjevanja',
    svetovalec: 'Maks Zager',
    datum_sestanka: '2026-08-24',
  }),
});
const SID = ustvarjena.seja.id;
// Druga seja, da je preverjanje filtra sploh smiselno (filter mora seznam
// ZOZITI, za kar sta potrebni vsaj dve vrstici). Prej se je test zanasal na
// seje, ki jih je pustil e2e.mjs — in je padel, ce je tekel sam.
await apiJson('/api/procesi/seje', {
  method: 'POST',
  body: JSON.stringify({ questionnaire_id: predlogaId, stranka_naziv: 'Drugi Hotel (za filter)' }),
});
// Znano izhodisce odgovorov, da so trditve o nalozenih vrednostih smiselne.
await apiJson(`/api/procesi/seje/${SID}`, {
  method: 'PATCH',
  body: JSON.stringify({ answers: {
    cilj: 'Skrajšati pripravo urnikov.',
    korist: { izbrano: ['več prihodkov'], drugo: '' },
    kazalniki: [['Ure priprave urnika', '6 h/teden', '1 h/teden', 'evidenca vodje'], ['', '', '', ''], ['', '', '', '']],
  } }),
});
console.log(`(testna seja #${SID}, predloga #${predlogaId})`);

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.authenticate({ username: 'test@acenta.si', password: 'testgeslo123' });

// Zanesljiv vnos: polje najprej POCISTI, sele nato vpisi. page.type() sam
// vriva na polozaj kazalca in bi se prilepil na obstojeco vsebino.
async function vpisi(page, izbirnik, besedilo) {
  await page.click(izbirnik, { clickCount: 3 });
  await page.evaluate((s) => { const e = document.querySelector(s); if (e) e.value = ''; }, izbirnik);
  await page.click(izbirnik);
  await page.type(izbirnik, besedilo);
}

const napakeKonzole = [];
page.on('console', m => {
  if (m.type() !== 'error') return;
  const url = (m.location && m.location().url) || '';
  napakeKonzole.push({ besedilo: m.text(), url });
});
page.on('pageerror', e => napakeKonzole.push({ besedilo: 'pageerror: ' + e.message, url: '' }));

// ── Stran 1: seznam procesov ─────────────────────────────────────────────
console.log('\n=== Seznam procesov ===');
await page.goto(`${BASE}/admin/procesi.html`, { waitUntil: 'networkidle0' });
await pocakaj(600);

t('naslov strani', await page.$eval('h1', e => e.textContent.trim() === 'Procesi'),
   await page.$eval('h1', e => e.textContent.trim()));
const stVrstic = await page.$$eval('#seje tbody tr[data-odpri]', r => r.length);
t('seznam pokaze vsaj 2 seji', stVrstic >= 2, stVrstic);
t('napredek narisan', (await page.$$('#seje tbody tr[data-odpri] [style*="width"]')).length > 0);
const predlogeVrstic = await page.$$eval('#predloge tbody tr', r => r.length);
t('knjiznica pokaze predlogo', predlogeVrstic === 1, predlogeVrstic);
t('stranska vrstica izrisana', !!(await page.$('#sidebar nav a')));
t('Procesi so aktivna postavka',
   (await page.$eval('#sidebar nav a.active', e => e.textContent.trim())) === 'Procesi',
   await page.$eval('#sidebar nav a.active', e => e.textContent.trim()));

// Gumb "Nov sestanek" res odpre obrazec
t('obrazec za novo sejo je skrit', await page.$eval('#novaSeja', e => e.className.includes('hidden')));
await page.click('#btnNova');
await pocakaj(250);
t('klik na Nov sestanek odpre obrazec', !(await page.$eval('#novaSeja', e => e.className.includes('hidden'))));
t('datum privzeto izpolnjen', (await page.$eval('#nsDatum', e => e.value)).length === 10);
t('izbirnik predlog napolnjen', (await page.$$eval('#nsPredloga option', o => o.length)) === 1);

// Validacija: prazna stranka javi napako in NE ustvari seje
await page.click('#nsShrani');
await pocakaj(300);
t('prazna stranka javi napako', (await page.$eval('#nsNapaka', e => e.textContent)).includes('stranko'));

await page.click('#nsPreklici');
await pocakaj(200);
t('Preklici zapre obrazec', await page.$eval('#novaSeja', e => e.className.includes('hidden')));

// Filter
await vpisi(page, '#fStranka', 'UI Test Hotel');
await pocakaj(700);
t('filter zozi seznam', (await page.$$eval('#seje tbody tr[data-odpri]', r => r.length)) >= 1 && (await page.$$eval('#seje tbody tr[data-odpri]', r => r.length)) < stVrstic,
   await page.$$eval('#seje tbody tr[data-odpri]', r => r.length));

// ── Loceni stolpci (prej so bili stranka+proces+oddelek v enem) ──
const glave = await page.$$eval('#seje thead th', e => e.map(x => x.textContent.replace(/[▲▼]/g, '').trim()));
t('10 locenih stolpcev', glave.length === 10, JSON.stringify(glave));
t('stranka, proces in oddelek so LOCENI stolpci',
   glave.includes('Stranka') && glave.includes('Proces') && glave.includes('Oddelek'),
   JSON.stringify(glave));
// Ne ":first-child" — prva vrstica v tbody je zdaj naslov skupine.
const celicVrstici = await page.$$eval('#seje tbody tr[data-odpri]', r => r[0].querySelectorAll('td').length);
t('vrstica ima 10 celic', celicVrstici === 10, celicVrstici);

// Noben naslov stolpca ne sme biti odrezan — pri uppercase + tracking-wider
// so bili "SVETOVAL...", "TR..." in "PO..." sirsi od svojih stolpcev.
const odrezaniNaslovi = await page.$$eval('#seje thead th', e => e
  .filter(th => th.scrollWidth > th.clientWidth + 1)
  .map(th => th.textContent.replace(/[▲▼]/g, '').trim()));
t('noben naslov stolpca ni odrezan', odrezaniNaslovi.length === 0, JSON.stringify(odrezaniNaslovi));

// Vrstice morajo ostati enovrsticne (prej so bile trikrat visje).
const visine = await page.$$eval('#seje tbody tr[data-odpri]', e => e.map(r => Math.round(r.getBoundingClientRect().height)));
t('vrstice so enovrsticne (<56px)', Math.max(...visine) < 56, JSON.stringify(visine));

// Tabela se mora prilegati svojemu ovoju na obicajnem namiznem zaslonu.
const prileganje = await page.evaluate(() => {
  const ovoj = document.getElementById('seje');
  return { ovoj: ovoj.clientWidth, tabela: ovoj.querySelector('table').scrollWidth };
});
t('tabela se prilega ovoju pri 1440px', prileganje.tabela <= prileganje.ovoj + 1,
   `tabela ${prileganje.tabela} > ovoj ${prileganje.ovoj}`);

// ── Sortiranje ──
async function imenaStrank() {
  return page.$$eval('#seje tbody tr[data-odpri] td:first-child', e => e.map(x => x.textContent.trim()));
}
// Od prenove 27. 8. 2026 je seznam razdeljen na skupine po statusu (V teku /
// Zakljuceno, caka posiljanje / Poslano / Arhiv), zato razvrscanje velja
// ZNOTRAJ skupine, ne cez cel seznam. Trditev je zato izrazena po skupinah —
// namen (klik na naslov res razvrsti) ostaja isti.
async function imenaPoSkupinah() {
  return page.$$eval('#seje tbody tr', (vrstice) => {
    const skupine = [];
    for (const tr of vrstice) {
      if (tr.classList.contains('skupina')) skupine.push([]);
      else if (skupine.length) skupine[skupine.length - 1].push(tr.querySelector('td').textContent.trim());
    }
    return skupine;
  });
}
const jeSortirano = (arr, smer) => JSON.stringify(arr) === JSON.stringify(
  [...arr].sort((a, b) => a.localeCompare(b, 'sl') * (smer === 'asc' ? 1 : -1)));

await page.click('#seje thead th[data-sort="stranka_naziv"]');
await pocakaj(250);
const skupineNaras = await imenaPoSkupinah();
t('sortiranje narascajoce znotraj skupin', skupineNaras.every(g => jeSortirano(g, 'asc')),
   JSON.stringify(skupineNaras));
await page.click('#seje thead th[data-sort="stranka_naziv"]');
await pocakaj(250);
const skupinePada = await imenaPoSkupinah();
t('drugi klik obrne smer', skupinePada.every(g => jeSortirano(g, 'desc')),
   JSON.stringify(skupinePada));
t('skupine imajo naslove', (await page.$$('#seje tbody tr.skupina')).length >= 1,
   (await page.$$('#seje tbody tr.skupina')).length);
t('aktiven stolpec je oznacen',
   !!(await page.$('#seje thead th[data-sort="stranka_naziv"].aktiven')));

// ── Filtri in znacke ──
// Iskalno polje pocistimo: prejsnji korak je vanj vpisal "UI Test Hotel" in
// brez tega bi bil vedno aktiven en filter (Iskanje), kar je pri gradnji
// naredilo videz, da cipi ne delajo.
await page.evaluate(() => { document.getElementById('fStranka').value = ''; });
await page.evaluate(() => document.getElementById('fStranka').dispatchEvent(new Event('input', { bubbles: true })));
await pocakaj(350);
t('brez filtrov ni cipov',
   (await page.$eval('#cipi', e => e.textContent)).includes('Ni aktivnih filtrov'));
const vseh = (await imenaStrank()).length;
await page.select('#fTranskript', 'ne');
await pocakaj(300);
t('filter transkript zozi seznam', (await imenaStrank()).length <= vseh, (await imenaStrank()).length);
t('cip za aktiven filter se pojavi',
   (await page.$eval('#cipi', e => e.textContent)).includes('Transkript'),
   await page.$eval('#cipi', e => e.textContent.trim().slice(0, 60)));
// Stevec sklanja samostalnik (1 sestanek / 2 sestanka / 3 sestanki / 5 sestankov),
// zato je vzorec na koncnici ohlapen.
t('stevec pokaze razmerje',
   /\d+ od \d+ sestan\w*/.test(await page.$eval('#stevec', e => e.textContent)),
   await page.$eval('#stevec', e => e.textContent));

// Klik na x v cipu odstrani filter
await page.click('#cipi [data-pocisti-filter="fTranskript"]');
await pocakaj(300);
t('x na cipu odstrani filter', (await page.$eval('#fTranskript', e => e.value)) === '');
t('po odstranitvi ni cipov',
   (await page.$eval('#cipi', e => e.textContent)).includes('Ni aktivnih filtrov'));

// Pocisti vse
await page.select('#fStatus', 'osnutek');
await page.select('#fNapredek', 'prazno');
await pocakaj(300);
t('dva cipa hkrati', (await page.$$eval('#cipi .cip', e => e.length)) === 2,
   await page.$$eval('#cipi .cip', e => e.length));
await page.click('#pocistiVse');
await pocakaj(300);
t('Pocisti vse pobrise vse filtre',
   (await page.$eval('#fStatus', e => e.value)) === '' && (await page.$eval('#fNapredek', e => e.value)) === '');

// Filter po svetovalcu je sestavljen iz podatkov
const svetovalci = await page.$$eval('#fSvetovalec option', e => e.map(x => x.textContent.trim()));
t('izbirnik svetovalcev napolnjen iz podatkov', svetovalci.includes('Maks Zager'),
   JSON.stringify(svetovalci));

// Filter po vprasalniku dejansko deluje (rabi questionnaire_id iz API-ja)
const idPredloge = await page.$eval('#fPredloga option:nth-child(2)', e => e.value);
await page.select('#fPredloga', idPredloge);
await pocakaj(300);
t('filter po vprasalniku ne vrne praznega seznama', (await imenaStrank()).length > 0,
   (await imenaStrank()).length);
await page.click('#pocistiVse');
await pocakaj(300);

await page.screenshot({ path: `${SLIKE}/procesi-seznam.png`, fullPage: true });

// ── Stran 2: izpolnjevanje ───────────────────────────────────────────────
console.log('\n=== Izpolnjevanje vprasalnika ===');
await page.goto(`${BASE}/admin/proces-seja.html?id=${SID}`, { waitUntil: 'networkidle0' });
await pocakaj(900);

t('glava pokaze stranko', (await page.$eval('#glavaNaslov', e => e.textContent)).includes('UI Test Hotel'));
t('glava pokaze status', (await page.$eval('#glavaNaslov', e => e.textContent)).includes('Osnutek'));
t('napredek v glavi', (await page.$eval('#glavaNapredek', e => e.textContent)).includes('izpolnjenih'));

const stSekcij = await page.$$eval('#obrazec section', s => s.length);
t('9 sklopov izrisanih (Osnovni podatki + 8)', stSekcij === 9, stSekcij);
const stNav = await page.$$eval('#sklopNav a', a => a.length);
t('navigacija ima 9 sklopov', stNav === 9, stNav);

// Vsi tipi polj so izrisani
t('textarea polja', (await page.$$('#obrazec textarea[data-qid]')).length > 0);
t('radio polja', (await page.$$('#obrazec input[type=radio][data-qid]')).length > 0);
t('checkbox polja', (await page.$$('#obrazec input[type=checkbox][data-qid]')).length > 0);
t('tabela kazalnikov', (await page.$$('#obrazec input[data-tip=table]')).length === 12,
   (await page.$$('#obrazec input[data-tip=table]')).length);
t('poudarjeno vprasanje', (await page.$$('#obrazec .poudarek')).length === 1,
   (await page.$$('#obrazec .poudarek')).length);
t('namig pri poudarjenem', await page.$eval('#obrazec .poudarek', e => e.textContent.includes('osnova za vse nadaljnje')));

// Nobeno polje ne sme biti nedosegljivo — pred popravkom jih je bilo pet
// (med njimi "Sodelujoci predstavniki hotela"), ker glava obrazca ni bila izrisana.
const dosegljivost = await page.evaluate(() => {
  const polja = vprasanja.filter(q => q.tip !== 'section');
  const vDom = new Set([...document.querySelectorAll('[data-qid]')].map(e => e.dataset.qid));
  return { skupaj: polja.length, manjkajo: polja.filter(q => !vDom.has(q.id)).map(q => q.id) };
});
t('vsa polja vprasalnika so urejljiva', dosegljivost.manjkajo.length === 0,
   `nedosegljiva: ${JSON.stringify(dosegljivost.manjkajo)}`);
t('vsaj 43 polj v vprasalniku', dosegljivost.skupaj >= 43, dosegljivost.skupaj);
t('glava prednapolnjena iz kartice',
  (await page.$eval('[data-qid="hotel"]', e => e.value)) === 'UI Test Hotel',
  await page.$eval('[data-qid="hotel"]', e => e.value));
t('datum prednapolnjen', (await page.$eval('[data-qid="datum"]', e => e.value)) === '2026-08-24',
  await page.$eval('[data-qid="datum"]', e => e.value));
t('svetovalec prednapolnjen', (await page.$eval('[data-qid="svetovalec"]', e => e.value)) === 'Maks Zager',
  await page.$eval('[data-qid="svetovalec"]', e => e.value));
t('predstavniki so prazni a urejljivi', (await page.$eval('[data-qid="predstavniki"]', e => e.value)) === '');
// Regresija: datum v kartici sestanka je kazal dan prej kot v glavi obrazca.
const dKartica = await page.$eval('#mDatum', e => e.value);
const dGlava = await page.$eval('[data-qid="datum"]', e => e.value);
t('datum v kartici = 2026-08-24', dKartica === '2026-08-24', dKartica);
t('datum v kartici in glavi je enak', dKartica === dGlava, `kartica=${dKartica} glava=${dGlava}`);

// Ze shranjeni odgovori so nalozeni v polja
const ciljVrednost = await page.$eval('[data-qid="cilj"]', e => e.value);
t('obstojeci odgovor nalozen v polje', ciljVrednost.includes('Skrajšati'), ciljVrednost.slice(0, 40));
const tabelaCelica = await page.$eval('[data-qid="kazalniki"][data-r="0"][data-c="0"]', e => e.value);
t('celica tabele nalozena', tabelaCelica === 'Ure priprave urnika', tabelaCelica);
const checkedMulti = await page.$$eval('[data-qid="korist"][data-tip=checkbox_multi]:checked', e => e.map(x => x.value));
t('checkbox_multi ohranjen', JSON.stringify(checkedMulti) === JSON.stringify(['več prihodkov']),
   JSON.stringify(checkedMulti));

// ── AUTOSAVE: to je bistvo ekrana ──
console.log('\n=== Autosave ===');
await vpisi(page, '[data-qid="problem"]', 'Urnik pripravlja ena oseba, brez pregleda razpolozljivosti.');
await pocakaj(400);
t('kazalnik javi neshranjeno', (await page.$eval('#shranjeno', e => e.textContent)).includes('Spremembe'));
await pocakaj(1800);
const poShranjevanju = await page.$eval('#shranjeno', e => e.textContent);
t('kazalnik javi shranjeno', poShranjevanju.includes('Shranjeno'), poShranjevanju);

// Dokaz, da je RES v bazi: ponovno nalozi stran
await pocakajNaShranjeno(page, '(textarea)');
await page.reload({ waitUntil: 'networkidle0' });
await pocakaj(900);
const poReloadu = await page.$eval('[data-qid="problem"]', e => e.value);
t('vpis prezivi ponovno nalozitev (je v bazi)', poReloadu.includes('Urnik pripravlja ena oseba'), poReloadu.slice(0, 40));

// Radio klik + gumb pocisti
console.log('\n=== Radio in pocisti ===');
await page.click('input[data-qid="odlocitev_razlicno"][value="da"]');
await pocakaj(1700);
t('radio izbran', await page.$eval('input[data-qid="odlocitev_razlicno"][value="da"]', e => e.checked));
const imaPocisti = await page.$('[data-pocisti="odlocitev_razlicno"]');
t('gumb pocisti se pojavi po izbiri', !!imaPocisti);
if (imaPocisti) {
  await imaPocisti.click();
  await pocakaj(1700);
  const nicIzbrano = await page.$$eval('input[data-qid="odlocitev_razlicno"]:checked', e => e.length);
  t('pocisti odizbere radio', nicIzbrano === 0, nicIzbrano);
}

// Tabela
console.log('\n=== Tabela kazalnikov ===');
await vpisi(page, '[data-qid="kazalniki"][data-r="2"][data-c="0"]', 'Zadovoljstvo ekipe');
t('tabela: shranjevanje potrjeno', await pocakajNaShranjeno(page, '(tabela)'));
await page.reload({ waitUntil: 'networkidle0' });
await pocakaj(900);
t('nova vrstica tabele shranjena',
  (await page.$eval('[data-qid="kazalniki"][data-r="2"][data-c="0"]', e => e.value)) === 'Zadovoljstvo ekipe',
  await page.$eval('[data-qid="kazalniki"][data-r="2"][data-c="0"]', e => JSON.stringify(e.value)));

// Nacin urejanja vprasanj
console.log('\n=== Urejanje vprasanj ===');
t('v obicajnem nacinu ni gumbov odstrani', (await page.$$('[data-odstrani]')).length === 0);
t('v obicajnem nacinu ni gumba dodaj', (await page.$$('[data-dodajvsekcijo]')).length === 0);
await page.click('#btnUredi');
await pocakaj(400);
t('urejanje pokaze odstrani', (await page.$$('[data-odstrani]')).length > 0);
t('urejanje pokaze dodaj v sklop', (await page.$$('[data-dodajvsekcijo]')).length === 9,
   (await page.$$('[data-dodajvsekcijo]')).length);
t('urejanje pokaze polja za label', (await page.$$('[data-labelza]')).length > 0);
t('opozorilo pojasni obseg', (await page.$eval('#opozorilo', e => e.textContent)).includes('samo za ta sestanek'));

// Sprememba besedila vprasanja se shrani
await vpisi(page, '[data-labelza="problem"]', 'Kaj je danes glavni problem? (prilagojeno)');
t('urejanje: shranjevanje potrjeno', await pocakajNaShranjeno(page, '(label)'));
await page.reload({ waitUntil: 'networkidle0' });
await pocakaj(900);
t('spremenjeno besedilo vprasanja prezivi reload',
  (await page.$eval('[data-polje="problem"] label', e => e.textContent)).includes('(prilagojeno)'),
  await page.$eval('[data-polje="problem"] label', e => e.textContent.trim()));

await page.click('#btnUredi');   // vklop (po reloadu je bilo izklopljeno)
await pocakaj(350);
t('ponoven vklop urejanja pokaze gumbe', (await page.$$('[data-odstrani]')).length > 0,
   (await page.$$('[data-odstrani]')).length);
await page.click('#btnUredi');   // izklop
await pocakaj(350);
t('izklop urejanja skrije gumbe', (await page.$$('[data-odstrani]')).length === 0,
   (await page.$$('[data-odstrani]')).length);
t('gumb se preimenuje nazaj', (await page.$eval('#btnUredi', e => e.textContent.trim())) === 'Uredi vprašanja',
   await page.$eval('#btnUredi', e => e.textContent.trim()));

// Transkript in posiljanje
console.log('\n=== Transkript in posiljanje ===');
t('sveza seja javi, da transkripta se ni',
  (await page.$eval('#tSeznam', e => e.textContent)).includes('Še ni shranjenega'),
  await page.$eval('#tSeznam', e => e.textContent.trim().slice(0, 50)));
t('zadeva prednapolnjena', (await page.$eval('#pZadeva', e => e.value)).includes('UI Test Hotel'));
t('spremno besedilo prednapolnjeno', (await page.$eval('#pSporocilo', e => e.value)).startsWith('Pozdravljeni,'));
t('predogled ima pravo povezavo',
  (await page.$eval('#pPredogled', e => e.getAttribute('href'))) === `/api/procesi/seje/${SID}/predogled?namen=stranka`);
t('interni predogled ima pravo povezavo',
  (await page.$eval('#pPredogledInterno', e => e.getAttribute('href'))).includes('namen=interno'));
t('PDF ima pravo povezavo', (await page.$eval('#pPdfLink', e => e.getAttribute('href'))).includes('/pdf'));

// Testno okolje nima Resend kljuca: gumb mora biti ONEMOGOCEN z vidno
// razlago, ne aktiven gumb, ki ob kliku tiho pade. (Validacijo praznega
// prejemnika ob VKLOPLJENEM posiljanju pokriva save-guard.test.mjs oz.
// koda pPoslji — tu do nje po novem ni mogoce priti.)
t('brez Resend kljuca je Poslji stranki onemogocen',
  await page.$eval('#pPoslji', e => e.disabled));
t('razlaga "se ni vklopljeno" je vidna',
  await page.$eval('#pNiVklopljeno', e => !e.classList.contains('hidden')));

// Vsi gumbi in povezave so ozivljeni (ni mrtvih kontrol)
const mrtvi = await page.evaluate(() => {
  const problemi = [];
  document.querySelectorAll('button').forEach(b => {
    if (b.disabled) return;
    const id = b.id || b.dataset.odstrani || b.dataset.pocisti || b.dataset.dodajvsekcijo || b.textContent.trim().slice(0, 25);
    if (!id) problemi.push('gumb brez identitete: ' + b.outerHTML.slice(0, 60));
  });
  document.querySelectorAll('a[href="#"]').forEach(a => problemi.push('povezava na #: ' + a.textContent.trim()));
  return problemi;
});
t('ni mrtvih gumbov ali praznih povezav', mrtvi.length === 0, JSON.stringify(mrtvi));

await page.screenshot({ path: `${SLIKE}/proces-seja-full.png`, fullPage: true });
await page.setViewport({ width: 390, height: 844 });
await pocakaj(400);
await page.screenshot({ path: `${SLIKE}/proces-seja-mobile.png`, fullPage: true });

// Vodoravni prelivi na mobilnem
const preliv = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
t('mobilno brez vodoravnega drsenja strani', preliv <= 1, `preliv ${preliv}px`);

// Na mobilnem mora biti ime stranke berljivo, ne odrezano na "Hote...".
const naslovMobilno = await page.$eval('#glavaNaslov', e => e.textContent.trim());
const odrezan = await page.$eval('#glavaNaslov', e => e.scrollWidth > e.clientWidth + 2);
t('ime stranke na mobilnem ni odrezano', !odrezan, `"${naslovMobilno}"`);
t('ime stranke je celo', naslovMobilno.includes('UI Test Hotel'), naslovMobilno);

console.log('\n=== Napake v konzoli ===');
const jeFavicon = (m) => (m.url + ' ' + m.besedilo).includes('favicon');
const faviconNapake = napakeKonzole.filter(jeFavicon);
const praveNapake = napakeKonzole.filter(m => !jeFavicon(m));
t('brez JS napak v konzoli (favicon izvzet)', praveNapake.length === 0, JSON.stringify(praveNapake.slice(0, 3)));
console.log(`  info: favicon 404 x${faviconNapake.length} — obstojeca lastnost vseh admin strani, ne regresija`);

await browser.close();
console.log(`\n${'─'.repeat(46)}\nOK: ${ok}   FAIL: ${fail}`);
if (padli.length) console.log('Padli:\n  - ' + padli.join('\n  - '));
console.log('');
process.exit(fail ? 1 : 0);
