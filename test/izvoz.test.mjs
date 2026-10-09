// Izvoz podjetja za Claude (public/admin/izvoz.js): cist modul, brez streznika in baze.
//
// Nosilno: ZIP mora odpreti vsak razsirjevalnik (preverjeno z lastnim branjem
// formata IN z zlib.crc32), odgovori pa morajo priti pod besedili, ki jih je
// clovek videl, ne pod vrednostmi polj ("imamo" -> "Imamo dostop").
//
// Zagon: node test/izvoz.test.mjs
import zlib from 'node:zlib';
import {
  crc32, zip, slug, dan, besediloOdgovora, vrsticeOdgovora, sestaviDatoteke, imeMape,
} from '../public/admin/izvoz.js';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

// Bralnik ZIP-a za test: gre od konca (EOCD) prek centralnega imenika do
// lokalnih glav, tako kot pravi razsirjevalniki.
function preberiZip(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const e = b.length - 22;
  if (v.getUint32(e, true) !== 0x06054b50) throw new Error('ni EOCD');
  const n = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('ni centralne glave');
    const zastavice = v.getUint16(p + 8, true);
    const crc = v.getUint32(p + 16, true);
    const vel = v.getUint32(p + 24, true);
    const dIme = v.getUint16(p + 28, true);
    const lok = v.getUint32(p + 42, true);
    const ime = dec.decode(b.subarray(p + 46, p + 46 + dIme));
    if (v.getUint32(lok, true) !== 0x04034b50) throw new Error('ni lokalne glave za ' + ime);
    const lIme = v.getUint16(lok + 26, true), lExtra = v.getUint16(lok + 28, true);
    const vsebina = b.subarray(lok + 30 + lIme + lExtra, lok + 30 + lIme + lExtra + vel);
    out.push({ ime, zastavice, crc, vsebina: dec.decode(vsebina), crcOk: crc32(vsebina) === crc });
    p += 46 + dIme;
  }
  return out;
}

// ── 1. CRC in ZIP ──────────────────────────────────────────────────────
console.log('\n=== 1. CRC32 in ZIP ===');
const enc = new TextEncoder();
t('crc32("") = 0', crc32(enc.encode('')) === 0);
t('crc32("hello") = 0x3610a686', crc32(enc.encode('hello')) === 0x3610a686, crc32(enc.encode('hello')).toString(16));
if (typeof zlib.crc32 === 'function') {
  const s = enc.encode('Čačke in šumniki: žganci, đuveč.\n'.repeat(50));
  t('crc32 = zlib.crc32 na besedilu s sumniki', crc32(s) === zlib.crc32(s));
}

const vhod = [
  { ime: 'paket/00-NAVODILA.md', vsebina: '# Navodila\n' },
  { ime: 'paket/odgovori/01-kovačič.md', vsebina: 'Odgovor: Čas za šumnike, žlica, đ.\n' },
  { ime: 'paket/prazna.md', vsebina: '' },
];
const z = zip(vhod, new Date(2026, 9, 8, 14, 3, 20));
let prebrano = [];
try { prebrano = preberiZip(z); } catch (e) { t('zip se prebere', false, e.message); }
t('zip ima 3 datoteke', prebrano.length === 3, String(prebrano.length));
t('imena in vsebine so enake vhodu', vhod.every((d, i) => prebrano[i]?.ime === d.ime && prebrano[i]?.vsebina === d.vsebina),
  JSON.stringify(prebrano.map(x => x.ime)));
t('vsi CRC se ujemajo z vsebino', prebrano.every(x => x.crcOk));
t('zastavica UTF-8 imen (bit 11) je postavljena', prebrano.every(x => x.zastavice & 0x0800));
t('zip se zacne z lokalno glavo PK\\x03\\x04', z[0] === 0x50 && z[1] === 0x4b && z[2] === 3 && z[3] === 4);

// ── 2. Imena in datumi ─────────────────────────────────────────────────
console.log('\n=== 2. Imena datotek in datumi ===');
t('slug brez sumnikov', slug('Hotel Kovačič & Đurić d.o.o.') === 'hotel-kovacic-duric-d-o-o', slug('Hotel Kovačič & Đurić d.o.o.'));
t('slug odreze na mejo brez visecega pomisljaja', slug('aaa bbb ccc', 5) === 'aaa-b' && !slug('aaaa bbbb', 5).endsWith('-'), slug('aaaa bbbb', 5));
t('slug praznega je prazen', slug(null) === '' && slug('—') === '');
t('dan iz DATE niza', dan('2026-08-27') === '27. 8. 2026', dan('2026-08-27'));
t('dan iz casa je ljubljanski, ne UTC', dan('2026-08-26T22:30:00Z') === '27. 8. 2026', dan('2026-08-26T22:30:00Z'));
t('dan praznega je prazen', dan(null) === '' && dan('nesmisel') === '');

// ── 3. Odgovori pod pravimi besedili ───────────────────────────────────
console.log('\n=== 3. Prevod odgovorov ===');
const qDostop = { id: 'dostop', label: 'Ali imate dostop?', tip: 'radio', options: [{ value: 'imamo', label: 'Imamo dostop' }, { value: 'nimamo', label: 'Nimamo dostopa' }] };
t('vrednost radia -> oznaka', besediloOdgovora(qDostop, 'imamo') === 'Imamo dostop');
t('neznana vrednost ostane', besediloOdgovora(qDostop, 'mogoce') === 'mogoce');
t('vec izbir z nizi kot moznostmi', besediloOdgovora({ options: ['A', 'B'] }, ['A', 'B']) === 'A; B');
t('samostojen checkbox "on" -> Da', besediloOdgovora({}, 'on') === 'Da');
t('false -> Ne, prazno -> ""', besediloOdgovora({}, false) === 'Ne' && besediloOdgovora({}, '') === '' && besediloOdgovora({}, []) === '');
t('objekt -> JSON', besediloOdgovora({}, { a: 1 }) === '{"a":1}');

const vprasanja = [
  { id: 'podjetje', label: 'Naziv podjetja', tip: 'text' },
  { id: 's1', label: 'Procesi', tip: 'section' },
  { id: 'bolecina', label: 'Kaj vam vzame največ časa?', tip: 'textarea' },
  qDostop,
  { id: 'prazno', label: 'Neodgovorjeno', tip: 'text', obvezno: true },
];
const raw = {
  podjetje: 'Hotel Test', bolecina: 'Ročno prepisovanje naročil.\nVsak petek.', dostop: 'nimamo',
  prazno: '', company_url: 'http://spam', gdpr_consent: true, _subject: 'x', star_kljuc: 'ostanek',
};
const odg = vrsticeOdgovora(raw, vprasanja);
t('stetje: 4 vprasanja, 3 odgovorjena (sekcija ne steje)', odg.st === 4 && odg.odgovorjeno === 3, `${odg.odgovorjeno}/${odg.st}`);
t('sklop iz sekcije', odg.vrstice.find(v => v.vprasanje === 'Kaj vam vzame največ časa?')?.sklop === 'Procesi');
t('radio prikazan z oznako', odg.vrstice.some(v => v.odgovor === 'Nimamo dostopa'));
t('honeypot, GDPR in _ polja izpusceni', !odg.vrstice.some(v => /spam|company_url|gdpr|_subject/.test(v.vprasanje + v.odgovor)));
t('polje brez vprasanja ostane pod kljucem v "Ostala polja"', odg.vrstice.some(v => v.vprasanje === 'star_kljuc' && v.sklop === 'Ostala polja'));
t('prazno obvezno se ne izpise', !odg.vrstice.some(v => v.vprasanje === 'Neodgovorjeno'));
const brezVpr = vrsticeOdgovora({ a: 'x' }, []);
t('brez vprasanj gre vse pod "Odgovori"', brezVpr.vrstice[0]?.sklop === 'Odgovori' && brezVpr.st === 0);

// ── 4. Cel paket ───────────────────────────────────────────────────────
console.log('\n=== 4. Sestava paketa ===');
const data = {
  izvozeno_at: '2026-10-08T12:00:00Z',
  company: { id: 7, naziv_prikaz: 'Hotel Lipa d.o.o.', status: 'sestanek', kvalifikacija: 'hot', kvalifikacija_razlog: 'odločevalec', created_at: '2026-06-01T08:00:00Z', last_response_at: '2026-09-12T10:00:00Z' },
  responses: [
    { id: 11, q_slug: 'napredni-ai', q_naziv: 'Napredni AI', submitted_at: '2026-09-10T09:00:00Z', raw_data: { ...raw, ime: 'Ana Breza', vloga: 'vodja recepcije' }, ai_povzetek: 'Povzetek **A**.', ima_snapshot: true, vprasanja_za_prikaz: vprasanja },
    { id: 12, q_slug: 'napredni-ai', q_naziv: 'Napredni AI', submitted_at: '2026-09-11T09:00:00Z', raw_data: { ime: 'Ana Breza', bolecina: 'Še enkrat.' }, ima_snapshot: false, vprasalnik_urejen_po_oddaji: true, vprasanja_za_prikaz: vprasanja },
    { id: 13, q_slug: 'ai-business-score', q_naziv: 'AI Business Score', submitted_at: '2026-09-12T10:00:00Z', raw_data: { ime: 'Bor', priimek: 'Lipa', odgovori: { x: 'y' } }, ima_snapshot: false,
      score: { score_version: 'v2', vrstice: [['Ime', 'Bor Lipa'], ['Katere naloge vam vzamejo največ časa?', 'Ponudbe; Naročila']],
        rezultat: { skupno: 54, dimenzije: { zrelost: 40, potencial: 60, pripravljenost: 50, financni: 33 }, stopnja: { naziv: 'AI uporabnik' }, proces: { naziv: 'Prodaja', priporocilo: 'AI pomočnik za prodajo' }, lead: { razred: 'A', razlogi: ['odločevalec'] }, ovira: 'Pomanjkanje časa' } } },
  ],
  priporocila: [{ questionnaire_id: 1, naziv_prikaz: 'Napredni AI', vsebina: '## Priporočila\nNekaj.', updated_at: '2026-09-13T08:00:00Z' }],
  seje: [
    { id: 3, q_naziv: 'Ocena poslovnega potenciala za AI', stranka_naziv: 'Hotel Lipa', proces: 'Urniki zaposlenih', oddelek: 'Recepcija', svetovalec: 'Maja', datum_sestanka: '2026-08-27', status: 'zakljucen',
      besedilo: '## 1. Proces\nRezultat procesa: urnik za teden', ai_povzetek: null,
      transkripti: [{ raw_text: 'Govorec 1: Dober dan.', vir: 'rocno', fetched_at: '2026-08-27T15:00:00Z' }, { raw_text: 'Drugi del.', vir: 'api', fetched_at: '2026-08-28T15:00:00Z' }] },
    { id: 4, q_naziv: 'Ocena poslovnega potenciala za AI', stranka_naziv: 'Hotel Lipa', proces: null, oddelek: null, svetovalec: null, datum_sestanka: null, created_at: '2026-09-01T10:00:00Z', status: 'osnutek', besedilo: '', transkripti: [] },
  ],
};
const klici = [];
const datoteke = sestaviDatoteke(data, {
  vprasanjaZa: (r) => { klici.push(r.id); return r.vprasanja_za_prikaz; },
  izpolnjevalec: (r) => {
    const ime = [r?.ime, r?.priimek].filter(Boolean).join(' ');
    return { ime: ime || 'Anonimni odgovor', imaIme: !!ime, vloga: r?.vloga || '' };
  },
});
const po = Object.fromEntries(datoteke.map(d => [d.ime.split('/').slice(1).join('/'), d.vsebina]));
const imena = Object.keys(po);
console.log('    ' + imena.join('\n    '));

t('koren mape = slug podjetja + datum', datoteke.every(d => d.ime.startsWith('hotel-lipa-d-o-o-za-claude-2026-10-08/')), datoteke[0].ime);
t('imeMape enako korenu', imeMape(data) === 'hotel-lipa-d-o-o-za-claude-2026-10-08');
t('navodila in podjetje sta prva', imena[0] === '00-NAVODILA-ZA-CLAUDE.md' && imena[1] === '01-podjetje.md');
t('vsa imena datotek so ASCII brez presledkov', imena.every(i => /^[a-z0-9./_-]+$/i.test(i)), imena.join(' '));
t('3 odgovori, 2 seji + 1 transkript, 1 priporocilo', imena.filter(i => i.startsWith('odgovori/')).length === 3
  && imena.filter(i => i.startsWith('procesne-seje/')).length === 3 && imena.filter(i => i.startsWith('obstojeca-ai-priporocila/')).length === 1);
t('ime odgovora: zaporedje-datum-vprasalnik-oseba', imena.includes('odgovori/01-2026-09-10-napredni-ai-ana-breza.md'));
t('izluscevanje ni klicano za AI Business Score', JSON.stringify(klici) === '[11,12]', JSON.stringify(klici));

const o1 = po['odgovori/01-2026-09-10-napredni-ai-ana-breza.md'];
t('odgovor: naslov z vprasalnikom in osebo', o1.startsWith('# Napredni AI: Ana Breza'));
t('odgovor: vloga izpolnjevalca', o1.includes('- Izpolnil/-a: Ana Breza, vodja recepcije'));
t('odgovor: ura oddaje po Ljubljani', o1.includes('- Oddano: 10. 9. 2026 ob 11.00'), o1.split('\n').find(v => v.startsWith('- Oddano')));
t('odgovor: vecvrsticni odgovor kot citat', o1.includes('> Ročno prepisovanje naročil.\n> Vsak petek.'));
t('odgovor: sklop kot naslov, vprasanje kot podnaslov', o1.includes('## Procesi') && o1.includes('### Kaj vam vzame največ časa?'));
t('odgovor: izvor = kopija ob oddaji', o1.includes('kopija ob oddaji'));
t('odgovor: stevec odgovorjenih', o1.includes('- Odgovorjenih vprašanj: 3 od 4'));
t('odgovor: AI povzetek oznacen kot samodejen', o1.includes('## Samodejni AI povzetek tega odgovora') && o1.includes('Povzetek **A**.'));
const o2 = po[imena.find(i => i.startsWith('odgovori/02-'))];
t('stara oddaja: opozorilo, da je bil vprasalnik urejen', o2.includes('po oddaji urejen'));
const o3 = po[imena.find(i => i.startsWith('odgovori/03-'))];
t('score: odgovori iz streznika', o3.includes('### Katere naloge vam vzamejo največ časa?') && o3.includes('> Ponudbe; Naročila'));
t('score: rezultat s stopnjo in procesom', o3.includes('Skupna ocena: 54 od 100') && o3.includes('AI uporabnik') && o3.includes('Prodaja (priporočen prvi projekt: AI pomočnik za prodajo)'));

const s1 = po['procesne-seje/01-2026-08-27-urniki-zaposlenih.md'];
t('seja: metapodatki', s1?.includes('- Svetovalec (Acenta): Maja') && s1.includes('- Datum sestanka: 27. 8. 2026'), s1);
t('seja: sklopi en nivo nizje', s1?.includes('### 1. Proces') && !/^## 1\. Proces/m.test(s1));
t('seja: kaze na transkript', s1?.includes('procesne-seje/01-2026-08-27-urniki-zaposlenih-transkript.md'));
const tr1 = po['procesne-seje/01-2026-08-27-urniki-zaposlenih-transkript.md'];
t('transkript: oba dela in opozorilo o vec transkriptih', tr1?.includes('Govorec 1: Dober dan.') && tr1.includes('Drugi del.') && tr1.includes('Število shranjenih transkriptov: 2.'));
const s2 = po[imena.find(i => i.startsWith('procesne-seje/02-'))];
t('seja brez procesa in datuma: ime iz vprasalnika in created_at', imena.some(i => i.startsWith('procesne-seje/02-2026-09-01-ocena-poslovnega-potenciala')), imena.join(' '));
t('seja brez transkripta to pove', s2?.includes('- Transkript: ni shranjen'));
t('osnutek seje oznacen', s2?.includes('osnutek (zapis morda ni dokončan)'));

const pod = po['01-podjetje.md'];
t('podjetje: status in ocena', pod.includes('- Prodajni status pri Acenti: sestanek') && pod.includes('- Ocena leada: HOT (odločevalec)'));
t('podjetje: ista oseba na dveh oddajah je ena', (pod.match(/^- Ana Breza/gm) || []).length === 1, pod);
t('podjetje: dva sodelujoca', pod.includes('## Kdo je izpolnjeval vprašalnike (2)'));
t('podjetje: kazalo vseh treh vrst virov', pod.includes('## Oddani vprašalniki (3)') && pod.includes('## Zapisi s sestankov (2)') && pod.includes('## Obstoječa AI priporočila (1)'));

const nav = po['00-NAVODILA-ZA-CLAUDE.md'];
t('navodila: ime podjetja in oba dokumenta', nav.includes('Hotel Lipa d.o.o.') && nav.includes('Seznam procesov za direktorja') && nav.includes('Prodajna priporočila za Matjaža'));
t('navodila: stevci v opisu gradiva', nav.includes('oddani vprašalniki (3)') && nav.includes('zapisi s sestankov (2)') && nav.includes('transkripti teh sestankov (2)'));
t('navodila: prepoved izmisljenih stevilk in cen', nav.includes('Ne izmišljujte številk') && nav.includes('ne navajajte cen'));
t('navodila: brez pomisljajev (—)', !nav.includes('—'));
t('navodila: brez splosnih orodij, procesi kot Acentina resitev', nav.includes('Microsoft Copilot') && nav.includes('Acenta za stranko izdela in uvede'));

t('brez kataloga ni datoteke 02', !imena.some(i => i.startsWith('02-')));
t('navodila brez kataloga ne omenjajo kataloga', !nav.includes('02-acenta-resitve.md') && !nav.includes('Smemo stranko omeniti'));

// ── 5. Katalog in interne opombe ───────────────────────────────────────
console.log('\n=== 5. Katalog in interne opombe ===');
const zKatalogom = {
  ...data,
  company: { ...data.company, interne_opombe: 'Račun za Claude že imajo.\nCopilota ne uporabljajo.', interne_opombe_updated_at: '2026-10-09T08:12:00Z' },
  katalog: {
    resitve: [
      { naziv: 'Osnutki odgovorov na mnenja', tezava: 'Ni časa za odgovore.', kaj_naredi: 'AI napiše osnutek, človek objavi.', kje: 'Hotel Breza', panoga: 'hoteli', status: 'produkcija', smemo_omeniti: true },
      { naziv: 'Razpored izmen', tezava: 'Ročni razpored.', kaj_naredi: '', kje: 'Hotel Lipa', panoga: 'hoteli', status: 'pilot', smemo_omeniti: false },
    ],
    ne_priporocamo: 'Copilot, naročnine ChatGPT.',
  },
};
const dk = sestaviDatoteke(zKatalogom, { vprasanjaZa: r => r.vprasanja_za_prikaz || [], izpolnjevalec: () => ({ ime: 'X', imaIme: true }) });
const pk = Object.fromEntries(dk.map(d => [d.ime.split('/').slice(1).join('/'), d.vsebina]));
const kat = pk['02-acenta-resitve.md'] || '';
t('katalog je tretja datoteka', dk[2]?.ime.endsWith('/02-acenta-resitve.md'), dk[2]?.ime);
t('katalog: status z besedo, ne s kljucem', kat.includes('- Status: v produkciji') && kat.includes('- Status: v pilotu') && !kat.includes('Status: pilot'));
t('katalog: smemo omeniti da/ne', kat.includes('pred drugo stranko: da') && kat.includes('pred drugo stranko: ne (v dokumentu za direktorja je ne imenujte)'));
t('katalog: prazno polje se ne izpise', !/AI in kaj ostane človeku: $/m.test(kat) && (kat.match(/Kaj naredi AI/g) || []).length === 1);
t('katalog: cesa ne priporocamo', kat.includes('## Česa ne priporočamo') && kat.includes('Copilot, naročnine ChatGPT.'));
const navK = pk['00-NAVODILA-ZA-CLAUDE.md'];
t('navodila: gradivo omeni katalog', navK.includes('`02-acenta-resitve.md`: katalog rešitev'));
t('navodila: proces poveži z rešitvijo, sicer »nova rešitev«', navK.includes('Vsak proces povežite z rešitvijo iz kataloga') && navK.includes('»nova rešitev«'));
t('navodila: imena strank samo z dovoljenjem v dokumentu 1', navK.includes('Smemo stranko omeniti: da'));
t('navodila: prepovedi iz kataloga', navK.includes('Upoštevajte tudi razdelek »Česa ne priporočamo«'));
t('navodila: interne opombe kot dejstva, ne za direktorja', navK.includes('Interne opombe v `01-podjetje.md` so dejstva'));
t('navodila: pravila so zaporedno ostevilcena', /\n12\. Interne opombe/.test(navK), (navK.match(/^\d+\. .{0,30}/gm) || []).join(' | '));
const podK = pk['01-podjetje.md'];
t('podjetje: interne opombe z datumom', podK.includes('## Interne opombe Acente (9. 10. 2026)') && podK.includes('Copilota ne uporabljajo.'));
t('podjetje brez opomb nima razdelka', !pod.includes('Interne opombe'));
const samoPrepovedi = sestaviDatoteke({ ...data, katalog: { resitve: [], ne_priporocamo: 'Copilot' } }, { vprasanjaZa: () => [], izpolnjevalec: () => ({ ime: 'X' }) });
t('samo prepovedi brez resitev: datoteka 02 vseeno nastane', samoPrepovedi.some(d => d.ime.endsWith('/02-acenta-resitve.md')));
const prazenKatalog = sestaviDatoteke({ ...data, katalog: { resitve: [], ne_priporocamo: '  ' } }, { vprasanjaZa: () => [], izpolnjevalec: () => ({ ime: 'X' }) });
t('prazen katalog: brez datoteke 02', !prazenKatalog.some(d => d.ime.endsWith('/02-acenta-resitve.md')));

const samoOdg = sestaviDatoteke({ ...data, seje: [], priporocila: [] }, { vprasanjaZa: r => r.vprasanja_za_prikaz || [], izpolnjevalec: () => ({ ime: 'X', imaIme: true }) });
const nav2 = samoOdg[0].vsebina;
t('navodila ne nastejejo virov, ki jih ni', !nav2.includes('procesne-seje/') && !nav2.includes('obstojeca-ai-priporocila/') && nav2.includes('odgovori/'));
t('navodila brez sej: glavni vir samo odgovori, brez omembe priporocil', nav2.includes('Odgovori zaposlenih so glavni vir.') && !nav2.includes('Obstoječa AI priporočila'));
t('navodila s sejami: vsi trije viri', nav.includes('Odgovori zaposlenih, zapisi sestankov in transkripti so glavni vir.'));
t('navodila: imena datotek samo v internem dokumentu', nav.includes('v dokumentu 1 imen datotek ni'));
// Prodajni predlog v aplikaciji preverja izhod po tej obliki (razdelek na
// proces, citat v »…«), zato mora biti v navodilih dobesedno.
t('navodila: razdelek procesa je »### 1. Ime procesa (oddelek)«', nav.includes('`### 1. Ime procesa (oddelek)`'));
t('navodila: citati v »…«', nav.includes('dobesednima citatoma v »…«'));
t('navodila: anonimni odgovori se stejejo kot odgovori', nav.includes('štejte odgovore, ne ljudi'));
const prazen = sestaviDatoteke({ ...data, responses: [], seje: [], priporocila: [] }, { vprasanjaZa: () => [], izpolnjevalec: () => ({}) });
t('podjetje brez odgovorov: samo navodila in pregled', prazen.length === 2);
t('cel paket se zapakira in prebere nazaj', preberiZip(zip(datoteke)).length === datoteke.length);

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:\n  ' + padli.join('\n  ')); process.exit(1); }
