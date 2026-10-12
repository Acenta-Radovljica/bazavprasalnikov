// Popis opravil: cista pravila brez streznika in baze.
//   - ure iz pogostosti in casa (public/admin/popis.js)
//   - preverjanje javne oddaje
//   - stalne oznake O1, O2 ... cez odgovore podjetja
//   - zamenjava [ure: …] v prodajnem predlogu in preverjanje (lazen AI)
//   - datoteka 03-popis-opravil.md in navodila v ZIP-u
//
// Zagon: node test/popis.test.mjs
import {
  POGOSTOST, CAS, NACINI, VPRASANJA, minutNaMesec, besediloUr, opravilaOdgovora,
  opravilaPodjetja, skupajMinut, preveriOddajo,
} from '../public/admin/popis.js';
import { zamenjajUre, pripraviPredlog } from '../src/ai/generate_prodajni_predlog.js';
import { sestaviDatoteke } from '../public/admin/izvoz.js';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

// ── 1. Pravilo za ure ────────────────────────────────────────────────────
console.log('\n=== 1. Ure na mesec ===');
t('vsak dan × 15 do 60 minut = 600 min', minutNaMesec('Vsak dan', '15 do 60 minut') === 600);
t('večkrat na teden × 1 do 3 ure = 1200 min', minutNaMesec('Večkrat na teden', '1 do 3 ure') === 1200);
t('enkrat na mesec × več kot 3 ure = 240 min', minutNaMesec('Enkrat na mesec', 'Več kot 3 ure') === 240);
t('enkrat na teden × do 15 minut = 40 min', minutNaMesec('Enkrat na teden', 'Do 15 minut') === 40);
t('neznana izbira = 0', minutNaMesec('Vsako uro', '1 do 3 ure') === 0 && minutNaMesec('Vsak dan', '') === 0);
t('štiri pogostosti, štirje časi, pet načinov', Object.keys(POGOSTOST).length === 4 && Object.keys(CAS).length === 4 && NACINI.length === 5);

t('10 ur', besediloUr(600) === 'okoli 10 ur na mesec', besediloUr(600));
t('1 ura', besediloUr(60) === 'okoli 1 ura na mesec', besediloUr(60));
t('2 uri (dvojina)', besediloUr(120) === 'okoli 2 uri na mesec', besediloUr(120));
t('4 ure', besediloUr(240) === 'okoli 4 ure na mesec', besediloUr(240));
t('5 ur', besediloUr(300) === 'okoli 5 ur na mesec', besediloUr(300));
t('101 ura', besediloUr(6060) === 'okoli 101 ura na mesec', besediloUr(6060));
t('pod pol ure: manj kot 1 ura', besediloUr(20) === 'manj kot 1 ura na mesec', besediloUr(20));
t('zaokrozeno: 40 min = 1 ura', besediloUr(40) === 'okoli 1 ura na mesec', besediloUr(40));
t('kratko za tabelo', besediloUr(600, { kratko: true }) === 'okoli 10' && besediloUr(20, { kratko: true }) === 'manj kot 1');

// ── 2. Vprasanja ─────────────────────────────────────────────────────────
console.log('\n=== 2. Vprašanja ===');
t('17 polj (oddelek, 3 × 5, ime)', VPRASANJA.length === 17, VPRASANJA.length);
t('obvezno samo oddelek in prvo opravilo (opis, pogostost, čas)',
  VPRASANJA.filter(q => q.obvezno).map(q => q.id).join() === 'delovno_mesto,o1_opis,o1_pogostost,o1_cas');
t('besedila iz načrta 9. 10.',
  VPRASANJA[0].label === 'Vaše delovno mesto ali oddelek'
  && VPRASANJA[1].label === 'Opišite opravilo, ki vam vzame največ časa ali vas najbolj moti.'
  && VPRASANJA.at(-1).label === 'Ime in priimek (neobvezno)');
t('sklopi Opravilo 1 do 3', ['Opravilo 1', 'Opravilo 2', 'Opravilo 3'].every(s => VPRASANJA.filter(q => q.sklop === s).length === 5));

// ── 3. Preverjanje oddaje ────────────────────────────────────────────────
console.log('\n=== 3. Preverjanje oddaje ===');
const polna = {
  delovno_mesto: '  Recepcija ', o1_opis: 'Prepisujem rezervacije iz e-pošte.', o1_pogostost: 'Vsak dan',
  o1_cas: '15 do 60 minut', o1_kako: ['E-pošta', 'Naš informacijski sistem'], o1_pomocnik: 'Naj sam vnese.',
  ime: 'Ana Kos', gdpr_consent: true, company_url: '', vdor: '<script>',
};
let v = preveriOddajo(polna);
t('polna oddaja je veljavna', v.ok, JSON.stringify(v));
t('obrezano in samo znana polja', v.raw?.delovno_mesto === 'Recepcija' && !('vdor' in v.raw) && !('gdpr_consent' in v.raw) && !('company_url' in v.raw), JSON.stringify(v.raw));
t('načini kot seznam', Array.isArray(v.raw?.o1_kako) && v.raw.o1_kako.length === 2);
v = preveriOddajo({ ...polna, o1_kako: 'Excel' });
t('en način kot niz postane seznam', v.ok && v.raw.o1_kako.join() === 'Excel');
v = preveriOddajo({ ...polna, delovno_mesto: '' });
t('brez oddelka: manjka delovno_mesto', !v.ok && v.napaka === 'manjka' && v.polje === 'delovno_mesto');
v = preveriOddajo({ delovno_mesto: 'Kuhinja' });
t('brez opravila: manjka o1_opis', !v.ok && v.polje === 'o1_opis');
v = preveriOddajo({ ...polna, o1_pogostost: 'Vsako uro' });
t('neveljavna pogostost', !v.ok && v.napaka === 'neveljavno' && v.polje === 'o1_pogostost');
v = preveriOddajo({ ...polna, o1_cas: '' });
t('manjka čas', !v.ok && v.napaka === 'manjka' && v.polje === 'o1_cas');
v = preveriOddajo({ ...polna, o1_kako: ['Fax'] });
t('neznan način', !v.ok && v.polje === 'o1_kako');
v = preveriOddajo({ ...polna, o2_pogostost: 'Vsak dan' });
t('začeto drugo opravilo brez opisa', !v.ok && v.polje === 'o2_opis');
v = preveriOddajo({ ...polna, o2_opis: 'Urnik izmen', o2_pogostost: 'Enkrat na teden' });
t('drugo opravilo brez časa', !v.ok && v.polje === 'o2_cas');
v = preveriOddajo({ ...polna, o2_opis: 'Urnik izmen', o2_pogostost: 'Enkrat na teden', o2_cas: '1 do 3 ure' });
t('dve opravili', v.ok && v.raw.o2_opis === 'Urnik izmen' && v.raw.o2_kako.length === 0);
t('prazno tretje se ne shrani', v.ok && !('o3_opis' in v.raw));
v = preveriOddajo({ ...polna, o1_opis: 'x'.repeat(2001) });
t('predolg opis', !v.ok && v.napaka === 'predolgo');
v = preveriOddajo({ ...polna, ime: '' });
t('brez imena je veljavno, ime se ne shrani', v.ok && !('ime' in v.raw));

// ── 4. Opravila in oznake ────────────────────────────────────────────────
console.log('\n=== 4. Opravila in oznake ===');
const raw = (oddelek, ime, ...opravila) => {
  const r = { delovno_mesto: oddelek };
  if (ime) r.ime = ime;
  opravila.forEach(([opis, pog, cas], i) => Object.assign(r, { [`o${i + 1}_opis`]: opis, [`o${i + 1}_pogostost`]: pog, [`o${i + 1}_cas`]: cas }));
  return r;
};
const odg = [
  { id: 12, submitted_at: '2026-10-12T09:00:00Z', raw_data: raw('Prodaja', 'Tina Rozman', ['Priprava ponudb za skupine', 'Večkrat na teden', '1 do 3 ure']) },
  { id: 10, submitted_at: '2026-10-11T08:00:00Z', raw_data: raw('Recepcija', 'Ana Kos', ['Prepisovanje rezervacij', 'Vsak dan', '15 do 60 minut'], ['Urnik izmen', 'Enkrat na teden', '1 do 3 ure']) },
  { id: 11, submitted_at: '2026-10-11T08:00:00Z', raw_data: raw('Recepcija', '', ['Prepisovanje rezervacij', 'Vsak dan', '15 do 60 minut']) },
];
const op = opravilaPodjetja(odg);
t('štiri opravila', op.length === 4, op.length);
t('oznake po času oddaje, nato id, nato številki opravila',
  op.map(o => `${o.oznaka}:${o.responseId}/${o.st}`).join() === 'O1:10/1,O2:10/2,O3:11/1,O4:12/1', op.map(o => `${o.oznaka}:${o.responseId}/${o.st}`).join());
t('oddelek in ime pri opravilu', op[0].oddelek === 'Recepcija' && op[0].ime === 'Ana Kos' && op[2].ime === '');
t('skupaj 10+8+10+20 = 48 ur', skupajMinut(op) === 2880, skupajMinut(op));
const novejsi = opravilaPodjetja([...odg, { id: 13, submitted_at: '2026-10-12T10:00:00Z', raw_data: raw('Kuhinja', '', ['Naročanje živil', 'Večkrat na teden', '15 do 60 minut']) }]);
t('nov odgovor ne premakne starih oznak', novejsi.slice(0, 4).map(o => o.oznaka + o.opis).join() === op.map(o => o.oznaka + o.opis).join() && novejsi[4].oznaka === 'O5');
t('opravilo brez opisa se ne šteje', opravilaOdgovora({ o1_opis: '', o1_pogostost: 'Vsak dan', o2_opis: 'X', o2_pogostost: 'Vsak dan', o2_cas: 'Do 15 minut' }).map(o => o.st).join() === '2');

// ── 5. Zamenjava [ure: …] ────────────────────────────────────────────────
console.log('\n=== 5. Zamenjava ur v predlogu ===');
let z = zamenjajUre('- **Koliko časa vam vzame danes**: [ure: O1, O3 | na recepciji]', op);
t('vsota dveh ljudi z mestom', z.besedilo === '- **Koliko časa vam vzame danes**: okoli 20 ur na mesec (2 zaposlena na recepciji, po popisu opravil)', z.besedilo);
z = zamenjajUre('[ure: O1, O2]', op);
t('isti človek dvakrat = 1 zaposleni', z.besedilo === 'okoli 18 ur na mesec (1 zaposleni, po popisu opravil)', z.besedilo);
z = zamenjajUre('| Rezervacije | recepcija | [ure: O1,O3] | manj napak |', op);
t('v tabeli kratko', z.besedilo === '| Rezervacije | recepcija | okoli 20 | manj napak |', z.besedilo);
z = zamenjajUre('[ure: o4]', op);
t('male črke oznake', z.besedilo.startsWith('okoli 20 ur na mesec'), z.besedilo);
z = zamenjajUre('A [ure: O9] B [ure: O1, O9]', op);
t('neznana oznaka se javi in odstrani', z.neznane.join() === 'O9' && z.besedilo === 'A  B okoli 10 ur na mesec (1 zaposleni, po popisu opravil)', `${z.neznane} ${z.besedilo}`);
z = zamenjajUre('Brez oznak, 3 procesi.', op);
t('besedilo brez oznak ostane enako', z.besedilo === 'Brez oznak, 3 procesi.' && !z.nove.length);
z = zamenjajUre('[ure: O1, O2, O3, O4]', op);
t('štirje zaposleni? ne: trije odgovori = 3 zaposleni', z.besedilo === 'okoli 48 ur na mesec (3 zaposleni, po popisu opravil)', z.besedilo);

// ── 6. Predlog z laznim AI ───────────────────────────────────────────────
console.log('\n=== 6. Predlog z lažnim AI ===');
const datoteke = [
  { ime: 'k/00-NAVODILA-ZA-CLAUDE.md', vsebina: '# Navodila' },
  { ime: 'k/01-podjetje.md', vsebina: '# Hotel Smrekov gaj\n\n## Kdo je izpolnjeval\n\n- Ana Kos, recepcija\n' },
  { ime: 'k/odgovori/01-x.md', vsebina: '> »Vsako jutro gre na to prva ura«' },
];
const dokument = (ure) => `<za_direktorja>
Sodelovali so trije zaposleni.

### 1. Prepisovanje rezervacij (recepcija)
- **Kaj pravijo vaši ljudje**: »Vsako jutro gre na to prva ura«
- **Koliko časa vam vzame danes**: ${ure}

| proces | kdo | ur na mesec danes |
|---|---|---|
| Prepisovanje rezervacij | recepcija | [ure: O1, O3] |
</za_direktorja>
<za_matjaza>
- S čim odpreti pogovor: rezervacije, [ure: O1, O3].
</za_matjaza>`;
let klici = 0;
let izid = await pripraviPredlog(datoteke, { popis: op, klic: async () => { klici++; return dokument('[ure: O1, O3 | na recepciji]'); } });
t('en klic, brez opozoril', izid.ok && klici === 1 && izid.opozorila.length === 0, JSON.stringify(izid.opozorila));
t('ure v dokumentu za direktorja', izid.za_direktorja.includes('okoli 20 ur na mesec (2 zaposlena na recepciji, po popisu opravil)'));
t('ure v tabeli', izid.za_direktorja.includes('| Prepisovanje rezervacij | recepcija | okoli 20 |'));
t('ure tudi za Matjaža', izid.za_matjaza.includes('okoli 20 ur na mesec (2 zaposlena, po popisu opravil)'));
t('nobene oznake več', !/\[ure:/.test(izid.za_direktorja + izid.za_matjaza));

klici = 0;
izid = await pripraviPredlog(datoteke, { popis: op, klic: async () => (++klici === 1 ? dokument('[ure: O1, O9 | na recepciji]') : dokument('[ure: O1, O3 | na recepciji]')) });
t('neznana oznaka sproži popravek', klici === 2 && izid.ok && izid.opozorila.length === 0, `${klici} ${JSON.stringify(izid.opozorila)}`);

klici = 0;
izid = await pripraviPredlog(datoteke, { popis: op, klic: async () => { klici++; return dokument('okoli 35 ur na mesec'); } });
t('ure, ki si jih je izmislil model, ostanejo opozorilo', klici === 2 && izid.opozorila.some(o => o.includes('35 ur')), JSON.stringify(izid.opozorila));

klici = 0;
izid = await pripraviPredlog(datoteke, { klic: async () => { klici++; return dokument('[ure: O1 | na recepciji]'); } });
t('brez popisa je vsaka oznaka neznana', klici === 2 && izid.opozorila.some(o => o.includes('03-popis-opravil.md')), JSON.stringify(izid.opozorila));

// ── 7. ZIP: 03-popis-opravil.md in navodila ──────────────────────────────
console.log('\n=== 7. ZIP ===');
const vprasanja = (r) => r.vprasanja_za_prikaz || [];
const oseba = (raw) => ({ ime: raw?.ime || 'Anonimni odgovor', imaIme: !!raw?.ime, vloga: raw?.delovno_mesto || '', zacetnice: '', podnaslov: '', mail: '' });
const podatki = (responses) => ({
  izvozeno_at: '2026-10-12T12:00:00Z',
  company: { id: 1, naziv_prikaz: 'Hotel Smrekov gaj', status: 'nov', created_at: '2026-10-01T00:00:00Z' },
  katalog: null, priporocila: [], seje: [],
  responses,
});
const vrstica = (o) => ({ ...o, questionnaire_id: 7, q_slug: 'popis-opravil', q_naziv: 'Popis opravil', vprasanja_za_prikaz: VPRASANJA, ai_povzetek: null });
let dat = sestaviDatoteke(podatki(odg.map(vrstica)), { vprasanjaZa: vprasanja, izpolnjevalec: oseba });
const popis = dat.find(d => d.ime.endsWith('/03-popis-opravil.md'))?.vsebina || '';
const navodila = dat.find(d => d.ime.endsWith('/00-NAVODILA-ZA-CLAUDE.md'))?.vsebina || '';
t('datoteka 03 obstaja', !!popis);
t('povzetek: 3 odgovori, 4 opravila, skupaj okoli 48 ur', popis.includes('3 odgovori · 4 opravila · skupaj okoli 48 ur na mesec'), popis.split('\n').slice(0, 6).join(' | '));
t('oznake O1 do O4 v pravem vrstnem redu', /### O1 · Prepisovanje rezervacij[\s\S]*### O2 · Urnik izmen[\s\S]*### O3 · Prepisovanje rezervacij[\s\S]*### O4 · Priprava ponudb/.test(popis));
t('ure pri opravilu', popis.includes('- **Ure: okoli 10 ur na mesec**') && popis.includes('- **Ure: okoli 8 ur na mesec**'));
t('po oddelkih, največ ur prvi', /- Recepcija: 3 opravila, 2 odgovora, skupaj okoli 28 ur na mesec\n- Prodaja: 1 opravilo, 1 odgovor, skupaj okoli 20 ur na mesec/.test(popis), popis.match(/## Po oddelkih\n\n([\s\S]*?)\n\n/)?.[1]);
t('brez imena označeno', popis.includes('- Kdo: brez imena'));
t('pot do odgovora', /- Odgovor: `odgovori\/\d\d-2026-10-1\d-popis-opravil-[a-z-]+\.md`/.test(popis));
t('navodila omenjajo datoteko in oznako', navodila.includes('`03-popis-opravil.md`') && navodila.includes('[ure: O1, O4 | na recepciji]'));
t('navodila: stolpec ur v tabeli', navodila.includes('ur na mesec danes'));
t('navodila: nikoli prihranka', navodila.includes('Nikoli ne pišite, koliko časa ali denarja podjetje prihrani'));

dat = sestaviDatoteke(podatki([]), { vprasanjaZa: vprasanja, izpolnjevalec: oseba });
const navodilaBrez = dat.find(d => d.ime.endsWith('/00-NAVODILA-ZA-CLAUDE.md'))?.vsebina || '';
t('brez popisa ni datoteke 03', !dat.some(d => d.ime.endsWith('/03-popis-opravil.md')));
t('brez popisa navodila enaka kot prej (brez oznake ur)', !navodilaBrez.includes('[ure:') && !navodilaBrez.includes('ur na mesec danes') && !navodilaBrez.includes('03-popis'));

console.log(`\n${'─'.repeat(46)}\nOK: ${ok}   FAIL: ${fail}`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
