// AI Business Score report text v3 (1. 10. 2026, after Matjaž: "only what I ticked, things repeat";
// v3 = "one topic, one place", plan-abs-porocilo-v3).
//
// Assertions:
//  1. Template (predloga.js) for four very different profiles: "priloznosti" has 5 points, "dobro"
//     and "zatika" 3–5; the paragraph starts with the company and has 3–6 sentences.
//  2. No repetition: no point twice, the strongest area named at most twice in the whole text,
//     the recommended first project never inside the lists.
//  3. No echo: no point is just an answer option text; the old "Kot največjo oviro ste navedli" is gone.
//  4. No digits anywhere (no invented numbers).
//  5. The template passes the same validator as the AI text (with the levers and first project).
//  6. AI validator (besedilo.js): 5+5+5 and 3+3+5 accepted. A bad BULLET (number, repeated thought,
//     topic already in the paragraph, lever topic in zatika/moznosti, first-project area, echo) is
//     dropped and the rest kept; a bad paragraph, junk, or a list left too short rejects the draft.
//     "opravila" is not "pravila".
//
// Run: node test/porocilo-besedilo.test.mjs   (no server, no DB, no AI)
import { sestaviPredlogo } from '../src/score/predloga.js';
import { preveriBesedilo, oceniBesedilo, TEME } from '../src/score/besedilo.js';
import { izracunajScore } from '../src/score/izracunaj.js';
import { izracunajVzvode } from '../src/score/vzvodi.js';
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

console.log('\n1–5. Predloga za štiri različne profile');
for (const [ime, odg] of Object.entries(PROFILI)) {
  const { velikost, ...odgovori } = odg;
  const rez = izracunajScore(odg);
  const vz = izracunajVzvode(odgovori, velikost).vzvodi;
  const p = sestaviPredlogo(rez, `Test ${ime} d.o.o.`, odgovori, vz);
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
  t(`${ime}: brez starega odmeva ovire in odgovorov`, !p.odstavek.includes('Kot največjo oviro ste navedli') && !/vaših odgovorov|ste označili/.test(p.odstavek));
  if (['AI začetnik', 'AI raziskovalec'].includes(rez.stopnja.naziv)) t(`${ime}: nizka stopnja ne trdi, da AI že teče pri delu`, !p.odstavek.includes('Uporaba je prehitela organizacijo'));
  t(`${ime}: brez števk`, !/\d/.test([p.odstavek, ...vse].join(' ')), [p.odstavek, ...vse].join(' ').match(/.{0,20}\d.{0,20}/)?.[0]);
  const o = oceniBesedilo(JSON.stringify({ ...p, moznosti: p.priloznosti }), `Test ${ime} d.o.o.`, '', { vzvodi: vz.map(v => v.id), procesId: rez.proces?.id });
  t(`${ime}: predloga prestane isto preverjanje kot AI besedilo`, !!o.besedilo, o.razlog);
}
const vzOdg = (({ velikost, ...x }) => x)(PROFILI.raziskovalec_prodaja);
const vzorec = sestaviPredlogo(izracunajScore(PROFILI.raziskovalec_prodaja), 'Vzorec d.o.o.', vzOdg, izracunajVzvode(vzOdg, '21-50').vzvodi);
console.log('\n  Vzorec (raziskovalec, prodaja):\n  ' + vzorec.odstavek + '\n  DOBRO: ' + vzorec.dobro.join(' | ') + '\n  ZATIKA: ' + vzorec.zatika.join(' | ') + '\n  MOŽNOSTI: ' + vzorec.priloznosti.join(' | '));

console.log('\n6. Preverjanje AI besedila');
// Every topic in one place: "posamezniki", "odziv" and "pripravljenost" only in the paragraph,
// "pravila", "oseba" and "nabava" (dobavitelj) once in a bullet.
const dober = {
  odstavek: 'V podjetju Primer AI uporabljajo posamezniki, skupnega načina dela pa še ni. Največ časa gre v pripravo ponudb in v ročno administracijo, kar zavira prodajo. Ker se odziv na povpraševanja vleče več dni, ostanejo stranke dlje brez odgovora. Želite ukrepati v kratkem, zato je pravi trenutek za prvi projekt z jasnim ciljem.',
  dobro: ['Zaposleni AI že preizkušajo pri pisanju besedil, zato imate prve izkušnje.', 'Dobro veste, katera opravila vzamejo največ časa, kar olajša izbor projekta.', 'Na vodstveni ravni je odločitev za AI že sprejeta, kar skrajša pot.', 'Imate odprt odnos do novih orodij v ekipi, kar zmanjša odpor.', 'Oceno je izpolnil direktor, ki o naslednjem koraku tudi odloča.'],
  zatika: ['Ni dogovorjenih pravil za varno rabo podatkov, zato lahko občutljivi podatki uidejo.', 'Nihče ni zadolžen za razvoj uporabe umetne inteligence, zato pobude zastanejo.', 'Izkušnje se ne prenašajo na sodelavce, zato vsak začenja znova.', 'Učinka uporabe zaenkrat nihče ne meri, zato ga je težko pokazati.', 'Ponudbe nastajajo ročno, kar podaljša čas do odgovora strankam.'],
  moznosti: ['Osnutke odgovorov strankam lahko pripravi pomočnik iz vaših cenikov.', 'Poročila za vodstvo se lahko sestavijo samodejno iz obstoječih podatkov.', 'Primerjavo ponudb dobaviteljev lahko prevzame orodje.', 'Zapisniki sestankov z nalogami nastanejo brez ročnega dela.', 'Pogosta vprašanja strank dobijo odgovor tudi zvečer.'],
};
const J = (o) => JSON.stringify(o);
const oc = (o, vir = '', kontekst = {}) => oceniBesedilo(J(o), 'Primer', vir, kontekst);
const razlog = (o, vir = '', kontekst = {}) => oc(o, vir, kontekst).razlog || '';
// v3 repairs instead of rejecting: a bad bullet is dropped, the rest stays (if enough remain).
const izpusti = (ime, o, seznam, slab, kontekst = {}, vzorec = null) => {
  const x = oc(o, '', kontekst);
  t(ime, !!x.besedilo && !x.besedilo[seznam].includes(slab) && x.besedilo[seznam].length === o[seznam].length - 1
    && (!vzorec || x.izpusceno.some(z => vzorec.test(z))), x.razlog || JSON.stringify(x.izpusceno));
};
const r = preveriBesedilo(J(dober), 'Primer');
t('v3 besedilo 5+5+5 sprejeto brez izpustov', r && r.moznosti.length === 5 && r.dobro.length === 5 && oc(dober).izpusceno.length === 0, razlog(dober) || JSON.stringify(oc(dober).izpusceno));
t('3 + 3 + 5 sprejeto', !!preveriBesedilo(J({ ...dober, dobro: dober.dobro.slice(0, 3), zatika: dober.zatika.slice(0, 3) })), razlog({ ...dober, dobro: dober.dobro.slice(0, 3), zatika: dober.zatika.slice(0, 3) }));
t('le 2 točki zavrnjeno', preveriBesedilo(J({ ...dober, dobro: dober.dobro.slice(0, 2) })) === null);
const stevilka = 'Za ponudbe porabite deset ur na teden, kar je 10 ur.';
izpusti('alineja s številko izpuščena', { ...dober, zatika: [...dober.zatika.slice(0, 4), stevilka] }, 'zatika', stevilka, {}, /številke/);
const ponovi = 'Učinka uporabe AI zaenkrat nihče ne meri, zato ga je težko pokazati vodstvu.';
izpusti('ista misel dvakrat v oceni: druga izpuščena', { ...dober, zatika: [...dober.zatika.slice(0, 4), ponovi] }, 'zatika', ponovi, {}, /ista misel/);
const resitev = 'Učinek uporabe AI lahko orodje meri samodejno, zato ga je lažje pokazati.';
const xs = oc({ ...dober, moznosti: [...dober.moznosti.slice(0, 4), resitev] });
t('priložnost, ki reši problem iz "zatika", ostane (ni ponovitev)', !!xs.besedilo && xs.besedilo.moznosti.includes(resitev), xs.razlog || JSON.stringify(xs.izpusceno));
t('kratek odstavek zavrnjen', preveriBesedilo(J({ ...dober, odstavek: 'Kratko. Prekratko.' })) === null);
t('smeti zavrnjene', preveriBesedilo('ni json') === null && preveriBesedilo(null) === null);
const odz = 'Odziv na povpraševanja traja predolgo, zato stranke odidejo.';
izpusti('tema iz odstavka v alineji izpuščena (odziv)', { ...dober, zatika: [...dober.zatika.slice(0, 4), odz] }, 'zatika', odz, {}, /"odziv" že v odstavek/);
izpusti('tema koraka za višjo oceno v "zatika" izpuščena (pravila)', dober, 'zatika', dober.zatika[0], { vzvodi: ['pravila'] }, /"pravila" je že drugje/);
const prednost = { ...dober, dobro: [...dober.dobro.slice(0, 3), 'Imate osnovna pravila za varno rabo podatkov, kar zmanjša tveganje.'], zatika: ['Občutljivi podatki lahko uidejo v javna orodja, ker ni jasno, kaj je dovoljeno.', ...dober.zatika.slice(1)] };
const xp = oc(prednost, '', { vzvodi: ['pravila'] });
t('tema koraka kot prednost v "dobro" ostane', !!xp.besedilo && xp.besedilo.dobro.length === 4 && xp.izpusceno.length === 0, xp.razlog || JSON.stringify(xp.izpusceno));
izpusti('področje prvega projekta v alineji izpuščeno (nabava)', dober, 'moznosti', dober.moznosti[2], { procesId: 'nabava' }, /"nabava" je že drugje/);
const odmevS = 'Kot ste označili, zaposleni AI že preizkušajo pri pisanju.';
izpusti('odmev "ste označili" v alineji izpuščen', { ...dober, dobro: [odmevS, ...dober.dobro.slice(1)] }, 'dobro', odmevS, {}, /odmev/);
t('odmev v odstavku zavrnjen', /odstavek: odmev/.test(razlog({ ...dober, odstavek: 'Kot ste označili, ' + dober.odstavek })), razlog({ ...dober, odstavek: 'Kot ste označili, ' + dober.odstavek }));
const preveč = { ...dober, zatika: dober.zatika.slice(0, 3) };
t('ko izpust pusti premalo alinej, je besedilo zavrnjeno', /v "zatika" ostane le 2/.test(razlog(preveč, '', { vzvodi: ['pravila'] })), razlog(preveč, '', { vzvodi: ['pravila'] }));
const redka = { ...dober, odstavek: dober.odstavek + ' To je redka kombinacija za podjetje.' };
t('izmišljena primerjava "redka" v odstavku zavrnjena', /primerjava/.test(razlog(redka)), razlog(redka));
const redko = { ...dober, dobro: ['Čeprav AI uporabljate redko, imate prve izkušnje s pisanjem besedil.', ...dober.dobro.slice(1)] };
const xr = oc(redko, 'Vprašanja in odgovori:\n- Kako pogosto uporabljate AI? redko');
t('beseda iz odgovorov ("redko") dovoljena', !!xr.besedilo && xr.besedilo.dobro.length === 5, xr.razlog || JSON.stringify(xr.izpusceno));
t('"opravila" ni tema "pravila", "pravilih" je', !TEME.pravila.test('Dobro veste, katera opravila vzamejo čas.') && TEME.pravila.test('Po pravilih podjetja.'));

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
