// AI Business Score v1: golden tests for the pure scoring function.
//
// Assertions:
//  1. Six golden profiles give the expected total, level, strongest process and lead class.
//  2. Total is always 0–100 and every dimension is 0–100.
//  3. Empty / garbage input never throws and scores 0 with lead B or C.
//  4. Multi-select cap: a 4th option in a "max 3" question is ignored.
//  5. Level follows the maturity dimension, not the total.
//  6. Lead A only when the strongest process is procurement, sales, admin or management.
//  7. Deterministic: same input, same output.
//
// Run: node test/score.test.mjs   (no server, no DB)
import { izracunajScore } from '../src/score/izracunaj.js';
import { VPRASANJA, VELIKOST } from '../src/score/vprasanja-v1.js';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

export const PROFILI = {
  // Sole trader, no AI, just curious.
  zacetnik: {
    velikost: '1-5', panoga: 'storitve', vloga: 'lastnik', uporaba: 'ne', sistematicnost: 'ni',
    odgovorna_oseba: 'ne', razumevanje: 'slabo', pravila: 'ne', izguba_casa: ['ne_vem'],
    stroski: ['ne_vem'], potencial: ['ne_vem'], odziv: 'ure', nabavne_cene: 'redno',
    ovira: 'znanje', hitrost: 'raziskujemo', pomoc: 'ne_vem', interpretacija: 'ne',
  },
  // Manufacturing director, procurement pain, wants to act now.
  direktor_nabava: {
    velikost: '51-100', panoga: 'proizvodnja', vloga: 'direktor', uporaba: 'posamezniki',
    sistematicnost: 'vsak_po_svoje', odgovorna_oseba: 'neformalno', razumevanje: 'povprecno',
    pravila: 'potrebovali', izguba_casa: ['nabava', 'porocila', 'ponudbe'],
    stroski: ['nabava', 'zaloge', 'rocna_administracija'], potencial: ['nabava', 'administracija'],
    odziv: '24h', nabavne_cene: 'ne_preverjamo', ovira: 'kje_zaceti', hitrost: 'cim_prej',
    pomoc: 'agent_nabava', interpretacija: 'pogovor',
  },
  // Hotel marketing lead, no timeline, not a decision maker.
  hotel_marketing: {
    velikost: '21-50', panoga: 'turizem', vloga: 'vodja_marketinga', uporaba: 'vec_zaposlenih',
    sistematicnost: 'priporocila', odgovorna_oseba: 'brez_odgovornosti', razumevanje: 'dobro',
    pravila: 'osnovna', izguba_casa: ['marketing', 'povprasevanja'], stroski: ['marketing'],
    potencial: ['marketing', 'recepcija'], odziv: '24h', nabavne_cene: 'redno', ovira: 'cas',
    hitrost: '3-6m', pomoc: 'pomocnik_marketing', interpretacija: 'priporocilo',
  },
  // Large, mature, systematic company.
  ai_first: {
    velikost: '100+', panoga: 'trgovina', vloga: 'direktor', uporaba: 'procesi',
    sistematicnost: 'strategija', odgovorna_oseba: 'ekipa', razumevanje: 'zelo_dobro',
    pravila: 'politika', izguba_casa: ['porocila'], stroski: ['porocila'], potencial: ['vodstvo'],
    odziv: 'ure', nabavne_cene: 'avtomatizirano', ovira: 'partner', hitrost: '1-3m',
    pomoc: 'retainer', interpretacija: 'diagnostika',
  },
  // Employee just exploring.
  zaposleni_raziskuje: {
    velikost: '6-20', panoga: 'drugo', vloga: 'zaposleni', uporaba: 'posamezniki',
    sistematicnost: 'vsak_po_svoje', odgovorna_oseba: 'ne', razumevanje: 'povprecno', pravila: 'ne',
    izguba_casa: ['administracija'], stroski: ['ne_vem'], potencial: ['administracija'],
    odziv: '24h', nabavne_cene: 'obcasno', ovira: 'znanje', hitrost: 'raziskujemo',
    pomoc: 'delavnica', interpretacija: 'priporocilo',
  },
  // Sales pain, slow response, owner of a mid company, wants a call.
  prodaja_pocasna: {
    velikost: '6-20', panoga: 'gradbenistvo', vloga: 'lastnik', uporaba: 'posamezniki',
    sistematicnost: 'ni', odgovorna_oseba: 'ne', razumevanje: 'slabo', pravila: 'ne',
    izguba_casa: ['ponudbe', 'povprasevanja', 'followup'], stroski: ['ponudbe', 'odzivnost', 'leadi'],
    potencial: ['prodaja'], odziv: 'vec_3dni', nabavne_cene: 'redno', ovira: 'kje_zaceti',
    hitrost: 'pogovor', pomoc: 'pomocnik_prodaja', interpretacija: 'pogovor',
  },
};

// Golden expectations (v1 point table). Changing points = new SCORE_VERSION + update here.
const PRICAKOVANO = {
  zacetnik:            { skupno: 11, stopnja: 'AI začetnik',       proces: null,             lead: 'C' },
  direktor_nabava:     { skupno: 69, stopnja: 'AI raziskovalec',   proces: 'nabava',         lead: 'A' },
  hotel_marketing:     { skupno: 50, stopnja: 'AI uporabnik',      proces: 'marketing',      lead: 'B' },
  ai_first:            { skupno: 65, stopnja: 'AI-first kandidat', proces: 'vodstvo',        lead: 'A' },
  zaposleni_raziskuje: { skupno: 28, stopnja: 'AI začetnik',       proces: 'administracija', lead: 'C' },
  prodaja_pocasna:     { skupno: 61, stopnja: 'AI začetnik',       proces: 'prodaja',        lead: 'A' },
};

const IZPIS = process.argv.includes('--izpis');
console.log('\n1. Golden profili');
for (const [ime, odg] of Object.entries(PROFILI)) {
  const r = izracunajScore(odg);
  const p = PRICAKOVANO[ime];
  if (IZPIS) console.log(`     ${ime}: skupno=${r.skupno} dim=${JSON.stringify(r.dimenzije)} stopnja=${r.stopnja.naziv} proces=${r.proces?.id} lead=${r.lead.razred} (${r.lead.razlogi.join(', ')})`);
  if (p.skupno !== null) t(`${ime}: skupno ${p.skupno}`, r.skupno === p.skupno, `dobil ${r.skupno}`);
  if (p.stopnja !== null) t(`${ime}: stopnja ${p.stopnja}`, r.stopnja.naziv === p.stopnja, `dobil ${r.stopnja.naziv}`);
  t(`${ime}: proces ${p.proces}`, (r.proces?.id ?? null) === p.proces, `dobil ${r.proces?.id}`);
  t(`${ime}: lead ${p.lead}`, r.lead.razred === p.lead, `dobil ${r.lead.razred} (${r.lead.razlogi})`);
}

console.log('\n2. Meje 0–100 (vse možne skrajnosti)');
const najnizje = { velikost: VELIKOST[0].id }, najvisje = { velikost: VELIKOST.at(-1).id };
for (const q of VPRASANJA) {
  if (q.tip === 'vec') {
    najnizje[q.id] = [q.moznosti.find(o => o.nevtralno)?.id ?? q.moznosti[0].id];
    najvisje[q.id] = q.moznosti.filter(o => !o.nevtralno).slice(0, q.max).map(o => o.id);
  } else {
    const kljuc = o => (o.zre ?? 0) + (o.pot ?? 0) + (o.prip ?? 0) + (o.fin ?? 0);
    const urejene = [...q.moznosti].sort((a, b) => kljuc(a) - kljuc(b));
    najnizje[q.id] = urejene[0].id; najvisje[q.id] = urejene.at(-1).id;
  }
}
for (const [ime, odg] of [['najnizje', najnizje], ['najvisje', najvisje]]) {
  const r = izracunajScore(odg);
  const vse = [r.skupno, ...Object.values(r.dimenzije)];
  t(`${ime}: vse vrednosti 0–100 (${r.skupno})`, vse.every(v => Number.isInteger(v) && v >= 0 && v <= 100), JSON.stringify(r.dimenzije));
}
t('najvisje: skupno = 100', izracunajScore(najvisje).skupno === 100, `dobil ${izracunajScore(najvisje).skupno}`);
t('najnizje: skupno <= 5 (panoga ima vedno vsaj 1 točko)', izracunajScore(najnizje).skupno <= 5, `dobil ${izracunajScore(najnizje).skupno}`);

console.log('\n3. Prazen in pokvarjen vhod');
for (const [ime, vhod] of [['prazno', {}], ['undefined', undefined], ['smeti', { uporaba: 'xxx', izguba_casa: 'nabava', velikost: 7, vloga: null }]]) {
  let r, napaka = null;
  try { r = izracunajScore(vhod); } catch (e) { napaka = e; }
  t(`${ime}: ne vrže`, !napaka, napaka?.message);
  if (r) t(`${ime}: lead B ali C`, ['B', 'C'].includes(r.lead.razred), r.lead.razred);
}
t('smeti: nizek niz za vec-vprasanje se steje kot ena izbira',
  izracunajScore({ izguba_casa: 'nabava' }).signali.nabava === 1);

console.log('\n4. Omejitev "do 3"');
const stiri = izracunajScore({ izguba_casa: ['nabava', 'ponudbe', 'marketing', 'podpora'] });
t('4. izbira se ne šteje', stiri.signali.podpora === 0, JSON.stringify(stiri.signali));

console.log('\n5. Stopnja sledi zrelosti, ne skupni oceni');
// Regression: a director with 25 % maturity but big pain scored 69 total and was told
// "AI pospeševalec: nad povprečjem". The level must describe maturity.
const dn = izracunajScore(PROFILI.direktor_nabava);
t('visoka skupna ocena + nizka zrelost = nizka stopnja',
  dn.skupno > 60 && dn.dimenzije.zrelost <= 40 && dn.stopnja.naziv === 'AI raziskovalec',
  `${dn.skupno} / ${dn.dimenzije.zrelost} / ${dn.stopnja.naziv}`);

console.log('\n6. Lead A samo za nabavo, prodajo, administracijo ali vodstvo');
// Same decision-maker with urgency, but the strongest process is marketing -> B, not A.
const mkt = izracunajScore({ ...PROFILI.hotel_marketing, vloga: 'direktor', hitrost: 'cim_prej' });
t('direktor + nujnost + marketing = B', mkt.proces.id === 'marketing' && mkt.lead.razred === 'B',
  `${mkt.proces.id} ${mkt.lead.razred} ${mkt.lead.razlogi}`);

console.log('\n7. Determinističnost');
t('isti vhod, isti izhod', JSON.stringify(izracunajScore(PROFILI.direktor_nabava)) === JSON.stringify(izracunajScore(PROFILI.direktor_nabava)));

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
