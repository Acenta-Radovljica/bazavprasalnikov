// AI Business Score: "what would raise your score" (src/score/vzvodi.js).
//
// Assertions:
//  1. Every lever gain equals what the real scorer gives for that one changed answer.
//  2. Levers are sorted by maturity gain, at most 3, only for questions not yet maxed out.
//  3. "All three together" is rescored for real and flags a level change correctly.
//  4. A fully mature company gets no levers; empty input does not throw.
//  5. Echoed answers are option TEXTS only, neutral "Ne vem" left out, no ids or points.
//
// Run: node test/vzvodi.test.mjs   (no server, no DB)
import { izracunajVzvode, povzetekOdgovorov } from '../src/score/vzvodi.js';
import { izracunajScore } from '../src/score/izracunaj.js';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

const ZACETNIK = {
  panoga: 'proizvodnja', vloga: 'direktor', uporaba: 'ne', sistematicnost: 'ni',
  odgovorna_oseba: 'ne', razumevanje: 'slabo', pravila: 'ne', izguba_casa: ['ponudbe', 'povprasevanja'],
  stroski: ['ne_vem'], potencial: ['prodaja'], odziv: '2-3dni', nabavne_cene: 'redno',
  ovira: 'znanje', hitrost: 'pogovor', pomoc: 'pilot', interpretacija: 'ne',
};
const ZREL = {
  ...ZACETNIK, uporaba: 'procesi', sistematicnost: 'strategija', odgovorna_oseba: 'ekipa',
  razumevanje: 'zelo_dobro', pravila: 'politika',
};

console.log('\n1. Vsak vzvod = pravi točkovalnik');
const r = izracunajVzvode(ZACETNIK, '21-50');
const osnova = izracunajScore({ ...ZACETNIK, velikost: '21-50' });
const CILJ = { pravila: 'osnovna', odgovorna_oseba: 'neformalno', razumevanje: 'povprecno', sistematicnost: 'vsak_po_svoje', uporaba: 'posamezniki' };
for (const v of r.vzvodi) {
  const nov = izracunajScore({ ...ZACETNIK, velikost: '21-50', [v.id]: CILJ[v.id] });
  t(`${v.id}: +${v.zrelost} zrelosti, +${v.skupno} skupno`,
    v.zrelost === nov.dimenzije.zrelost - osnova.dimenzije.zrelost && v.skupno === nov.skupno - osnova.skupno,
    JSON.stringify(v));
  t(`${v.id}: ima besedilo koraka`, typeof v.korak === 'string' && v.korak.length > 20);
}

console.log('\n2. Razvrstitev in omejitev');
t('največ 3 vzvodi', r.vzvodi.length === 3, r.vzvodi.length);
t('prvi so pravila (0 -> osnovna = +10)', r.vzvodi[0].id === 'pravila' && r.vzvodi[0].zrelost === 10, JSON.stringify(r.vzvodi[0]));
t('padajoče po zrelosti', r.vzvodi.every((v, i, a) => !i || a[i - 1].zrelost >= v.zrelost));
const skoraj = izracunajVzvode({ ...ZREL, pravila: 'interna' }, '21-50');
t('samo nezapolnjena vprašanja', skoraj.vzvodi.length === 1 && skoraj.vzvodi[0].id === 'pravila', JSON.stringify(skoraj.vzvodi));

console.log('\n3. Vsi trije skupaj');
const vsi = izracunajScore({ ...ZACETNIK, velikost: '21-50', pravila: 'osnovna', odgovorna_oseba: 'neformalno', razumevanje: 'povprecno' });
t('skupaj = pravi preračun', r.skupaj.zrelost === vsi.dimenzije.zrelost && r.skupaj.skupno === vsi.skupno, JSON.stringify(r.skupaj));
t('zaznan prehod stopnje', r.skupaj.novaStopnja === (vsi.stopnja.naziv !== osnova.stopnja.naziv) && r.skupaj.stopnja === vsi.stopnja.naziv, JSON.stringify(r.skupaj));

console.log('\n4. Robni primeri');
const zrel = izracunajVzvode(ZREL, '100+');
t('zrelo podjetje: brez vzvodov', zrel.vzvodi.length === 0 && zrel.skupaj.novaStopnja === false);
let prazno;
try { prazno = izracunajVzvode({}, null); } catch (e) { prazno = e; }
t('prazen vhod ne vrže', !(prazno instanceof Error) && prazno.vzvodi.length === 3, String(prazno));
t('smeti ne vržejo', izracunajVzvode({ pravila: 'xx', uporaba: 42 }, 'zz').vzvodi.length === 3);

console.log('\n5. Odgovori nazaj v poročilu');
const p = povzetekOdgovorov(ZACETNIK);
t('čas: besedila izbranih', JSON.stringify(p.cas) === JSON.stringify(['Priprava ponudb', 'Odgovarjanje na povpraševanja']), JSON.stringify(p.cas));
t('Ne vem izpuščen', p.stroski.length === 0, JSON.stringify(p.stroski));
t('odziv kot besedilo', p.odziv === 'V 2–3 dneh', p.odziv);
t('želi pogovor iz hitrosti', p.zeliPogovor === true);
t('brez pogovora', povzetekOdgovorov({ ...ZACETNIK, hitrost: '1-3m' }).zeliPogovor === false);
t('brez ids in točk', !JSON.stringify(p).match(/"(zre|pot|prip|fin|sig)"|ponudbe"|povprasevanja"/), JSON.stringify(p));

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
