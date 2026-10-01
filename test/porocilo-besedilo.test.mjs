// AI Business Score report text v2 (1. 10. 2026, after Matjaž: "only what I ticked, things repeat").
//
// Assertions:
//  1. Template (predloga.js) for four very different profiles: "priloznosti" has 5 points, "dobro"
//     and "zatika" 3–5 (a mature company honestly has fewer stuck points; the AI version gives 5+5+5);
//     the paragraph starts with the company and has 3–6 sentences.
//  2. No repetition: no point twice, the strongest area named at most twice in the whole text,
//     the recommended first project never inside the lists.
//  3. No echo: no point is just an answer option text; the old "Kot največjo oviro ste navedli" is gone.
//  4. No digits anywhere (no invented numbers).
//  5. AI validator (besedilo.js): 5+5+5 accepted; too few points, numbers, a repeated thought or a
//     two-sentence paragraph rejected.
//
// Run: node test/porocilo-besedilo.test.mjs   (no server, no DB, no AI)
import { sestaviPredlogo } from '../src/score/predloga.js';
import { preveriBesedilo } from '../src/score/besedilo.js';
import { izracunajScore } from '../src/score/izracunaj.js';
import { VPRASANJA } from '../src/score/vprasanja-v1.js';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

const PROFILI = {
  zacetnik: { velikost: '6-20', panoga: 'storitve', vloga: 'lastnik', uporaba: 'ne', sistematicnost: 'ni', odgovorna_oseba: 'ne', razumevanje: 'slabo', pravila: 'ne', izguba_casa: ['ne_vem'], stroski: ['ne_vem'], potencial: ['ne_vem'], odziv: 'ure', nabavne_cene: 'redno', ovira: 'znanje', hitrost: 'raziskujemo', pomoc: 'ne_vem', interpretacija: 'ne' },
  raziskovalec_prodaja: { velikost: '21-50', panoga: 'trgovina', vloga: 'direktor', uporaba: 'posamezniki', sistematicnost: 'vsak_po_svoje', odgovorna_oseba: 'neformalno', razumevanje: 'povprecno', pravila: 'potrebovali', izguba_casa: ['ponudbe', 'povprasevanja', 'porocila'], stroski: ['odzivnost', 'leadi'], potencial: ['prodaja', 'marketing'], odziv: '2-3dni', nabavne_cene: 'obcasno', ovira: 'kje_zaceti', hitrost: '1-3m', pomoc: 'pomocnik_prodaja', interpretacija: 'pogovor' },
  nabava: { velikost: '51-100', panoga: 'proizvodnja', vloga: 'direktor', uporaba: 'vec_zaposlenih', sistematicnost: 'priporocila', odgovorna_oseba: 'brez_odgovornosti', razumevanje: 'povprecno', pravila: 'osnovna', izguba_casa: ['nabava', 'dokumenti', 'administracija'], stroski: ['nabava', 'zaloge', 'rocna_administracija'], potencial: ['nabava', 'administracija', 'finance'], odziv: '24h', nabavne_cene: 'ne_preverjamo', ovira: 'cas', hitrost: 'cim_prej', pomoc: 'agent_nabava', interpretacija: 'diagnostika' },
  zrel: { velikost: '100+', panoga: 'turizem', vloga: 'vodja_operacij', uporaba: 'procesi', sistematicnost: 'strategija', odgovorna_oseba: 'ekipa', razumevanje: 'zelo_dobro', pravila: 'politika', izguba_casa: ['podpora', 'nacrtovanje'], stroski: ['porocila'], potencial: ['recepcija', 'operativa'], odziv: 'ure', nabavne_cene: 'avtomatizirano', ovira: 'partner', hitrost: '3-6m', pomoc: 'retainer', interpretacija: 'priporocilo' },
};
const OPCIJE = new Set(VPRASANJA.flatMap(q => q.moznosti.map(o => o.text.toLowerCase())));
const stavki = (s) => (s.match(/[.!?](\s|$)/g) || []).length;

console.log('\n1–4. Predloga za štiri različne profile');
for (const [ime, odg] of Object.entries(PROFILI)) {
  const { velikost, ...odgovori } = odg;
  const rez = izracunajScore(odg);
  const p = sestaviPredlogo(rez, `Test ${ime} d.o.o.`, odgovori);
  t(`${ime}: priloznosti 5, dobro in zatika 3–5`, p.priloznosti.length === 5 && [p.dobro, p.zatika].every(x => x.length >= 3 && x.length <= 5),
    `${p.dobro.length}/${p.zatika.length}/${p.priloznosti.length}`);
  t(`${ime}: odstavek z imenom, 3–6 stavkov`, p.odstavek.startsWith(`V podjetju Test ${ime} d.o.o.`) && stavki(p.odstavek) >= 3 && stavki(p.odstavek) <= 6, p.odstavek);
  const vse = [...p.dobro, ...p.zatika, ...p.priloznosti];
  t(`${ime}: nobena točka dvakrat`, new Set(vse).size === vse.length);
  if (rez.proces) {
    const koren = rez.proces.naziv.toLowerCase().slice(0, 5);
    const n = [p.odstavek, ...vse].filter(s => s.toLowerCase().includes(koren)).length;
    t(`${ime}: področje "${rez.proces.naziv}" največ dvakrat`, n <= 2, `${n}x`);
    t(`${ime}: priporočeni prvi projekt ni v seznamih`, !vse.some(s => s.includes(rez.proces.priporocilo)));
  }
  t(`${ime}: noben stavek ni samo besedilo odgovora`, !vse.some(s => OPCIJE.has(s.replace(/\.$/, '').toLowerCase())));
  t(`${ime}: brez starega odmeva ovire`, !p.odstavek.includes('Kot največjo oviro ste navedli'));
  if (['AI začetnik', 'AI raziskovalec'].includes(rez.stopnja.naziv)) t(`${ime}: nizka stopnja ne trdi, da AI že teče pri delu`, !p.odstavek.includes('Uporaba je prehitela organizacijo'));
  t(`${ime}: brez števk`, !/\d/.test([p.odstavek, ...vse].join(' ')), [p.odstavek, ...vse].join(' ').match(/.{0,20}\d.{0,20}/)?.[0]);
}
const vzorec = sestaviPredlogo(izracunajScore(PROFILI.raziskovalec_prodaja), 'Vzorec d.o.o.', PROFILI.raziskovalec_prodaja);
console.log('\n  Vzorec (raziskovalec, prodaja):\n  ' + vzorec.odstavek + '\n  DOBRO: ' + vzorec.dobro.join(' | ') + '\n  ZATIKA: ' + vzorec.zatika.join(' | ') + '\n  MOŽNOSTI: ' + vzorec.priloznosti.join(' | '));

console.log('\n5. Preverjanje AI besedila');
const dober = {
  odstavek: 'V podjetju Primer AI uporabljajo posamezniki, skupnih pravil pa še ni. Največ časa gre v pripravo ponudb in odgovore strankam. Odziv na povpraševanja je počasen, kar pomeni izgubljene priložnosti. Želite ukrepati v kratkem, ovira pa je, da ne veste, kje začeti. Dober prvi korak je en proces z jasnim ciljem.',
  dobro: ['Zaposleni AI že preizkušajo pri pisanju besedil.', 'Dobro veste, katera opravila vzamejo največ časa.', 'Pripravljeni ste ukrepati v kratkem obdobju.', 'Na vodstveni ravni je odločitev za AI že sprejeta.', 'Imate odprt odnos do novih orodij v ekipi.'],
  zatika: ['Ni dogovorjenih pravil za varno rabo podatkov.', 'Nihče ni zadolžen za razvoj uporabe umetne inteligence.', 'Odziv na nova povpraševanja traja predolgo.', 'Izkušnje posameznikov se ne prenašajo na sodelavce.', 'Učinka uporabe zaenkrat nihče ne meri.'],
  moznosti: ['Osnutke odgovorov na povpraševanja lahko pripravi pomočnik.', 'Poročila za vodstvo se lahko sestavijo samodejno.', 'Primerjavo ponudb dobaviteljev lahko prevzame orodje.', 'Zapisniki sestankov z nalogami nastanejo brez ročnega dela.', 'Pogosta vprašanja strank dobijo odgovor tudi zvečer.'],
};
const r = preveriBesedilo(JSON.stringify(dober), 'Primer');
t('5+5+5 sprejeto, z moznosti', r && r.moznosti.length === 5 && r.dobro.length === 5, JSON.stringify(r)?.slice(0, 120));
t('le 3 točke zavrnjeno', preveriBesedilo(JSON.stringify({ ...dober, dobro: dober.dobro.slice(0, 3) })) === null);
t('številka zavrnjena', preveriBesedilo(JSON.stringify({ ...dober, zatika: [...dober.zatika.slice(0, 4), 'Za ponudbe porabite 10 ur na teden.'] })) === null);
t('ista misel dvakrat zavrnjena', preveriBesedilo(JSON.stringify({ ...dober, moznosti: [...dober.moznosti.slice(0, 4), 'Ni dogovorjenih pravil za varno rabo podatkov v podjetju.'] })) === null);
t('kratek odstavek zavrnjen', preveriBesedilo(JSON.stringify({ ...dober, odstavek: 'Kratko. Prekratko.' })) === null);
t('smeti zavrnjene', preveriBesedilo('ni json') === null && preveriBesedilo(null) === null);

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
