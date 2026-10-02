// AI Business Score v2 (questions from Matjaž's Word, one follow-up block per area): pure tests,
// no database, no server, no AI call.
//
//  1. Question set: 16 common questions + 6 blocks of 3, all from the Word, 4.3 gone.
//  2. Public JSON: no points, area hints only where branching needs them.
//  3. Branching: explicit area, "Interno znanje", "Operativa"/"Ne vem" fallback, no signal.
//  4. Validation: required set follows the branch, other blocks dropped, v1 page still accepted.
//  5. Scoring: all 7 paths, chosen area wins, interest raises readiness, maturity equals v1.
//  6. Levers, facts, template text and AI input on v2 answers.
//
// Run: node test/score-v2.test.mjs
import { VPRASANJA, POGLOBLJENI, SCORE_VERSION } from '../src/score/vprasanja-v2.js';
import { VPRASANJA as V1 } from '../src/score/vprasanja-v1.js';
import { javnaVprasanja } from '../src/score/javna.js';
import { validirajOddajo, besedilaOdgovorov } from '../src/score/oddaja.js';
import { izracunajScore } from '../src/score/izracunaj.js';
import { izracunajVzvode } from '../src/score/vzvodi.js';
import { izracunano, stavekPodrocja, primerjavaNalog, cilj, podrocjeSklopa } from '../src/score/dejstva.js';
import { sestaviPredlogo } from '../src/score/predloga.js';
import { sestaviVhod, oceniBesedilo } from '../src/score/besedilo.js';
import { vidnaVprasanja, izbranoPodrocje } from '../public/score/razvejitev.js';

let ok = 0, fail = 0;
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

const JAVNO = javnaVprasanja();
const PODR = JAVNO.podrocja;
const vidni = (o) => vidnaVprasanja(JAVNO.vprasanja, o, PODR).map(q => q.id);

// Common answers; each path adds proces90 + its block.
const JEDRO = {
  uporaba: 'posamezniki', naloge: ['pisanje_poste', 'prevajanje'], sistematicnost: 'vsak_po_svoje',
  odgovorna_oseba: 'neformalno', razumevanje: 'povprecno', pravila: 'potrebovali', ovira: 'kje_zaceti',
  izguba_casa: ['nabava', 'porocila', 'ponudbe'], stroski: ['nabava', 'zaloge'],
  cilj: 'stroski', hitrost: 'cim_prej', pomoc: 'agent_nabava', interpretacija: 'pogovor',
  panoga: 'proizvodnja', vloga: 'direktor',
};
const SKLOP = {
  nabava: { nabavne_cene: 'obcasno', nabava_ure: '6-10', nabava_agent: 'cim_prej' },
  prodaja: { odziv: '2-3dni', ponudbe_ponavljajoce: 'veliko', prodaja_pomocnik: 'zelo' },
  marketing: { marketing_izziv: 'cas', vsebine_pogostost: 'tedensko', marketing_sistem: 'da' },
  administracija: { admin_opravila: ['zapisniki', 'iskanje'], baza_znanja: 'tezko', znanje_pomocnik: 'da' },
  vodstvo: { informacije_hitrost: 'pocasi', kpi_porocila: 'neuporabna', direktor_pomocnik: 'zelo' },
  podpora: { vprasanja_pogostost: 'veckrat_dnevno', komunikacija_cas: 'ponavljajoca', podpora_pomocnik: 'mogoce' },
};
const pot = (podrocje) => ({ ...JEDRO, proces90: podrocje, ...SKLOP[podrocje] });
const kontakt = { ime: 'Ana', priimek: 'Novak', email: 'ana@primer.si', telefon: '041 123 456', podjetje: 'Kovinar', velikost: '51-100' };

console.log('\n1. Nabor vprašanj');
const ids = VPRASANJA.map(q => q.id);
t('verzija je v2', SCORE_VERSION === 'v2');
t('34 vprašanj brez podvojenih', ids.length === 34 && new Set(ids).size === 34, ids.length);
t('16 skupnih vprašanj', VPRASANJA.filter(q => !q.podrocje).length === 16);
t('6 sklopov po 3 vprašanja', Object.keys(POGLOBLJENI).length === 6 && Object.values(POGLOBLJENI).every(a => a.length === 3));
t('vsako vprašanje ima številko iz Worda', VPRASANJA.every(q => /^\d+\.\d+$/.test(q.word)), VPRASANJA.filter(q => !q.word).map(q => q.id));
t('4.3 »Kje vidite potencial« ni več', !ids.includes('potencial'));
t('nova vprašanja 2.3, 11.1, 11.2', ['naloge', 'proces90', 'cilj'].every(id => ids.includes(id)));
t('sklop sledi takoj vprašanju o 90 dneh', ids.indexOf('nabavne_cene') === ids.indexOf('proces90') + 1);
t('vrstni red jedra po planu', VPRASANJA.filter(q => !q.podrocje).map(q => q.id).join() ===
  'uporaba,naloge,sistematicnost,odgovorna_oseba,razumevanje,pravila,ovira,izguba_casa,stroski,proces90,cilj,hitrost,pomoc,interpretacija,panoga,vloga');
t('vprašanja zrelosti so ista kot v v1', ['uporaba', 'sistematicnost', 'odgovorna_oseba', 'razumevanje', 'pravila']
  .every(id => VPRASANJA.find(q => q.id === id) === V1.find(q => q.id === id)));
t('vsak sklop ima eno vprašanje o interesu', Object.values(POGLOBLJENI).every(a => a.filter(id => VPRASANJA.find(q => q.id === id).del === 'interes').length === 1));

console.log('\n2. Javni JSON');
const json = JSON.stringify(JAVNO);
t('brez točk in signalov', !/"(zre|pot|prip|fin|sig|akcija|odlocevalec)"/.test(json));
t('verzija v2 in vrstni red področij', JAVNO.verzija === 'v2' && PODR.join() === 'nabava,prodaja,administracija,vodstvo,podpora,marketing');
t('vprašanja sklopa imajo področje', JAVNO.vprasanja.filter(q => q.podrocje).length === 18);
t('»Interno znanje« vodi v administracijo', JAVNO.vprasanja.find(q => q.id === 'proces90').moznosti.find(o => o.id === 'znanje').podrocje === 'administracija');
t('»Operativa« in »Ne vem« nimata področja', ['operativa', 'ne_vem'].every(id => !JAVNO.vprasanja.find(q => q.id === 'proces90').moznosti.find(o => o.id === id).podrocje));
t('v1 JSON ostane brez področij', !JSON.stringify(javnaVprasanja('v1')).includes('podrocje'));

console.log('\n3. Razvejitev');
t('brez odgovora na 11.1: 16 vprašanj', vidni(JEDRO).length === 16);
for (const p of PODR) t(`${p}: 19 vprašanj, pravi sklop`, (() => { const v = vidni(pot(p)); return v.length === 19 && POGLOBLJENI[p].every(id => v.includes(id)); })());
t('»Interno znanje« dobi sklop administracije', izbranoPodrocje(JAVNO.vprasanja, { ...JEDRO, proces90: 'znanje' }, PODR) === 'administracija');
t('»Operativa«: področje z največ oznakami pri času in stroških', izbranoPodrocje(JAVNO.vprasanja,
  { ...JEDRO, proces90: 'operativa', izguba_casa: ['ponudbe', 'povprasevanja', 'nabava'], stroski: ['odzivnost'] }, PODR) === 'prodaja');
t('»Ne vem«: neodločeno odloči vrstni red (nabava pred prodajo)', izbranoPodrocje(JAVNO.vprasanja,
  { ...JEDRO, proces90: 'ne_vem', izguba_casa: ['ponudbe'], stroski: ['nabava'] }, PODR) === 'nabava');
t('»Ne vem« brez oznak: brez sklopa, 16 vprašanj', vidni({ ...JEDRO, proces90: 'ne_vem', izguba_casa: ['ne_vem'], stroski: ['ne_vem'] }).length === 16);

console.log('\n4. Preverjanje oddaje');
const ok2 = validirajOddajo({ ...kontakt, odgovori: { ...pot('nabava'), ...SKLOP.marketing } });
t('celotna v2 oddaja je sprejeta kot v2', ok2.ok && ok2.verzija === 'v2', JSON.stringify(ok2).slice(0, 120));
t('odgovori drugega sklopa so zavrženi', ok2.ok && !('marketing_izziv' in ok2.odgovori) && ok2.odgovori.nabava_ure === '6-10');
const brez = { ...pot('nabava') }; delete brez.nabava_ure;
const r = validirajOddajo({ ...kontakt, odgovori: brez });
t('manjkajoče vprašanje sklopa vrne to polje', !r.ok && r.field === 'nabava_ure', JSON.stringify(r));
const brez90 = { ...pot('nabava') }; delete brez90.proces90;
t('brez 11.1 vrne polje proces90', validirajOddajo({ ...kontakt, odgovori: brez90 }).field === 'proces90');
const V1ODG = {
  panoga: 'proizvodnja', vloga: 'direktor', uporaba: 'posamezniki', sistematicnost: 'vsak_po_svoje',
  odgovorna_oseba: 'neformalno', razumevanje: 'povprecno', pravila: 'potrebovali',
  izguba_casa: ['nabava', 'porocila', 'ponudbe'], stroski: ['nabava', 'zaloge', 'rocna_administracija'],
  potencial: ['nabava', 'administracija'], odziv: '24h', nabavne_cene: 'ne_preverjamo', ovira: 'kje_zaceti',
  hitrost: 'cim_prej', pomoc: 'agent_nabava', interpretacija: 'pogovor',
};
const r1 = validirajOddajo({ ...kontakt, odgovori: V1ODG });
t('stran, odprta pred deployem (v1), je še sprejeta kot v1', r1.ok && r1.verzija === 'v1');
t('neveljaven odgovor v sklopu je zavrnjen', !validirajOddajo({ ...kontakt, odgovori: { ...pot('nabava'), nabava_ure: 'veliko' } }).ok);
t('besedila odgovorov vključujejo nova vprašanja', besedilaOdgovorov(pot('nabava')).naloge === 'Pisanje e-pošte; Prevajanje' && besedilaOdgovorov(pot('nabava')).nabava_ure === '6–10 ur');

console.log('\n5. Točkovanje');
const rez = Object.fromEntries(PODR.map(p => [p, izracunajScore({ ...pot(p), velikost: '51-100' }, 'v2')]));
t('vseh 6 poti da rezultat v2', PODR.every(p => rez[p].score_version === 'v2' && rez[p].skupno >= 0 && rez[p].skupno <= 100));
t('izbrano področje je prvi projekt (6 od 6)', PODR.every(p => rez[p].proces?.id === p), PODR.map(p => `${p}->${rez[p].proces?.id}`).join(' '));
const zv1 = izracunajScore({ ...V1ODG, velikost: '51-100' }, 'v1').dimenzije.zrelost;
t('zrelost je ista kot v v1 za iste odgovore', PODR.every(p => rez[p].dimenzije.zrelost === zv1), `${zv1} vs ${rez.nabava.dimenzije.zrelost}`);
t('privzeta verzija ostane v1 (stare vrstice)', JSON.stringify(izracunajScore({ ...V1ODG, velikost: '51-100' })) === JSON.stringify(izracunajScore({ ...V1ODG, velikost: '51-100' }, 'v1')));
t('direktor, 51–100, nabava, čim prej: lead A', rez.nabava.lead.razred === 'A', rez.nabava.lead.razlogi.join(', '));
const blag = izracunajScore({ ...pot('nabava'), nabavne_cene: 'avtomatizirano', nabava_ure: 'manj_2', velikost: '51-100' }, 'v2');
t('manj bolečine v sklopu = nižji potencial', blag.dimenzije.potencial < rez.nabava.dimenzije.potencial, `${blag.dimenzije.potencial} vs ${rez.nabava.dimenzije.potencial}`);
const interesNe = izracunajScore({ ...pot('nabava'), nabava_agent: 'ne', velikost: '51-100' }, 'v2');
t('interes »čim prej« dvigne pripravljenost', rez.nabava.dimenzije.pripravljenost > interesNe.dimenzije.pripravljenost);
const zacasno = { ...JEDRO, hitrost: '3-6m', interpretacija: 'ne', proces90: 'nabava', ...SKLOP.nabava };
t('interes »čim prej« šteje kot želja po ukrepanju', izracunajScore({ ...zacasno, velikost: '51-100' }, 'v2').lead.razred === 'A');
const brezSklopa = izracunajScore({ ...JEDRO, proces90: 'ne_vem', izguba_casa: ['ne_vem'], stroski: ['ne_vem'], pomoc: 'ne_vem', velikost: '1-5' }, 'v2');
t('brez sklopa in brez bolečin: potencial 0, brez procesa', brezSklopa.dimenzije.potencial === 0 && brezSklopa.proces === null);
const adm = izracunajScore({ ...pot('administracija'), admin_opravila: ['drugo'], velikost: '51-100' }, 'v2');
t('»Drugo« pri administrativnih opravilih ne šteje kot bolečina', adm.dimenzije.potencial < rez.administracija.dimenzije.potencial);
t('isti vhod, isti izhod', JSON.stringify(izracunajScore({ ...pot('prodaja') }, 'v2')) === JSON.stringify(izracunajScore({ ...pot('prodaja') }, 'v2')));

console.log('\n6. Koraki, dejstva, besedilo');
const vz = izracunajVzvode(pot('nabava'), '51-100', 3, 'v2');
t('koraki za višjo zrelost delujejo na v2', vz.vzvodi.length === 3 && vz.skupaj.skupno > rez.nabava.skupno);
t('nabava 6–10 ur: 72 do 120 ur na leto', izracunano(pot('nabava'))[0]?.includes('72 do 120 ur na leto'), izracunano(pot('nabava'))[0]);
t('več kot 20 ur: več kot 240 ur na leto', izracunano({ ...pot('nabava'), nabava_ure: 'vec_20' })[0]?.includes('več kot 240 ur na leto'));
t('drugo področje: brez izračunanih številk', izracunano(pot('marketing')).length === 0);
t('v1 odgovori: brez sklopa in brez dejstev', podrocjeSklopa(V1ODG) === null && stavekPodrocja(V1ODG) === null);
t('vsako področje ima stavek posledice', PODR.every(p => stavekPodrocja(pot(p))?.stavek), PODR.filter(p => !stavekPodrocja(pot(p))).join());
t('AI za e-pošto, čas gre v nabavo: vrzel', primerjavaNalog(pot('nabava')) === 'vrzel');
t('AI pri nabavi, čas gre v nabavo: ujemanje', primerjavaNalog({ ...pot('nabava'), naloge: ['nabava'] }) === 'ujemanje');
t('cilj z malo začetnico', cilj(pot('nabava')) === 'znižanje stroškov');

const ECHO = /\bste (označili|navedli|izbrali|povedali|odgovorili)\b/i;
for (const p of PODR) {
  const vzp = izracunajVzvode(pot(p), '51-100', 3, 'v2');
  const pr = sestaviPredlogo(rez[p], 'Kovinar', pot(p), vzp.vzvodi);
  const vse = [pr.odstavek, ...pr.dobro, ...pr.zatika, ...pr.priloznosti].join(' ');
  t(`${p}: predloga ima stavek posledice in ne odmeva`, pr.odstavek.includes(stavekPodrocja(pot(p)).stavek) && !ECHO.test(vse));
  t(`${p}: seznami imajo vsaj 3 alineje`, pr.dobro.length >= 3 && pr.zatika.length >= 3 && pr.priloznosti.length >= 3,
    `${pr.dobro.length}/${pr.zatika.length}/${pr.priloznosti.length}`);
}
const prN = sestaviPredlogo(rez.nabava, 'Kovinar', pot('nabava'), vz.vzvodi);
t('nabava: stavek o nabavi le v odstavku, ne v »zatika«', !prN.zatika.some(s => /nabav|dobavitelj/i.test(s)), prN.zatika.join(' | '));
t('vrzel pri AI nalogah je v odstavku', prN.odstavek.includes('ne tam, kjer izgubite največ časa'));

const vhod = sestaviVhod(rez.nabava, besedilaOdgovorov(pot('nabava')), 'Kovinar', { opisStopnje: 'x', vzvodi: vz.vzvodi, izracunano: izracunano(pot('nabava')) });
t('AI vhod ima izračunane številke in besedila v2 vprašanj', vhod.includes('Izračunano iz odgovorov:') && vhod.includes('72 do 120') && vhod.includes('Za kaj AI trenutno največ uporabljate?'));
const osnutek = (odstavek) => JSON.stringify({
  odstavek,
  dobro: ['Zaposleni AI že preizkušajo, zato imajo prve izkušnje za nadaljnje delo.', 'Direktor odloča sam, kar skrajša pot od ideje do prvega preizkusa.', 'Dobro poznate opravila, ki vam jemljejo čas, kar olajša izbor začetka.'],
  zatika: ['Pravila za varno uporabo še niso zapisana, zato vsak ravna po svoje pri podatkih.', 'Uporaba sloni na posameznikih, zato se izkušnje ne prenesejo na ostale sodelavce.', 'Zaposleni še ne vidijo jasno, kako bi jim orodja pomagala pri vsakdanjem delu.'],
  moznosti: ['Poročila lahko AI sestavi iz podatkov, ki jih že zbirate v sistemih.', 'Osnutke ponudb lahko AI pripravi iz cenikov in preteklih dokumentov podjetja.', 'Zapiske sestankov lahko AI povzame v naloge z roki in odgovornimi osebami.', 'Pogodbe in dokumente lahko AI pregleda in izlušči ključne roke in obveznosti.'],
});
const dober = 'Podjetje Kovinar je pri AI na začetku poti, uporablja ga nekaj zaposlenih. Za iskanje ponudnikov in primerjavo cen gre 6 do 10 ur na mesec, to je 72 do 120 ur na leto. AI pa danes pomaga pri pisanju e-pošte in prevajanju, ne pri opravilih, ki vzamejo največ časa. Ker je glavni cilj nižji strošek, je smiselno začeti tam, kjer se čas in denar izgubljata. Brez tega bo uporaba ostala pri občasnih poskusih.';
t('številke iz »Izračunano« so dovoljene', !!oceniBesedilo(osnutek(dober), 'Kovinar', vhod).besedilo, oceniBesedilo(osnutek(dober), 'Kovinar', vhod).razlog);
t('izmišljena številka je zavrnjena', !oceniBesedilo(osnutek(dober.replace('72 do 120', '200 do 300')), 'Kovinar', vhod).besedilo);

console.log('\n7. Ena tema en prostor, brez odmeva (iz prvih 7 testnih poročil)');
t('AI vhod označi poglobljeni sklop', vhod.includes('Podrobneje o področju »Nabava«') && vhod.split('Podrobneje o področju')[1].includes('6–10 ur'));
t('v1 odgovori nimajo označenega sklopa', !sestaviVhod(izracunajScore(V1ODG), besedilaOdgovorov(V1ODG), 'X', {}).includes('Podrobneje o področju'));
const zOdst = (odst, zatika) => oceniBesedilo(JSON.stringify({ ...JSON.parse(osnutek(dober)), odstavek: odst, zatika }), 'Kovinar', vhod);
const Z3 = JSON.parse(osnutek(dober)).zatika;
const ponovi = (stavek) => zOdst(dober, [stavek, ...Z3]).izpusceno?.some(x => x.startsWith('zatika 1'));
t('»ponudbe« v odstavku in v alineji: alineja izpuščena', (() => {
  const o = dober.replace('Ker je glavni cilj', 'Priprava ponudb vzame veliko časa. Ker je glavni cilj').replace(' Brez tega bo uporaba ostala pri občasnih poskusih.', '');
  return zOdst(o, ['Vsako ponudbo pišete od začetka, kar pomeni izgubljen čas za prodajo.', ...Z3]).izpusceno?.some(x => x.startsWith('zatika 1'));
})());
t('vrzel (»ne tam, kjer«) v odstavku in alineji: alineja izpuščena', ponovi('AI uporabljate za prevajanje, ne pa tam, kjer izgubljate največ časa pri delu.'));
t('»ne veste« štirikrat = ena tema', (() => {
  const r4 = oceniBesedilo(JSON.stringify({ ...JSON.parse(osnutek(dober)), zatika: [
    'Ker ne veste, kje izgubite največ časa, ne morete presoditi, kje bi AI pomagal.',
    'Brez vpogleda v stroške procesov se ti stroški nabirajo neopazno naprej v podjetju.',
    'Dokler ni jasno, kateri proces bi prinesel največ, se odločitev o koraku odlaša.',
    ...Z3] }), 'Kovinar', vhod);
  return r4.izpusceno?.filter(x => x.includes('kje_zaceti')).length === 2;
})());
for (const echo of ['ste izpostavili interno znanje', 'Edina ovira, ki jo navajate, je partner', 'priznavate, da zaposleni slabo razumejo', 'po vaših podatkih gre 6 do 10 ur']) {
  t(`odmev v odstavku zavrnjen: »${echo.slice(0, 28)}…«`, /odmev/.test(zOdst(dober.replace('Brez tega bo', `Tu ${echo}. Brez tega bo`), Z3).razlog || ''));
}

t('notranja oznaka »Izračunano iz odgovorov« v odstavku je zavrnjena',
  /notranja oznaka/.test(zOdst(dober.replace('Brez tega bo', 'Izračunano iz odgovorov: odziv traja dva dni. Brez tega bo'), Z3).razlog || ''));
t('vrzel z »ne pa za procese, kjer« je ista tema', ponovi('AI se uporablja za prevajanje, ne pa za procese, kjer se izgublja največ časa.'));

console.log('\n8. Dopolnitev kratkega seznama iz predloge');
const kratko = JSON.stringify({ ...JSON.parse(osnutek(dober)), zatika: [Z3[0], 'Ker ne veste, kje začeti, se trud razprši na več strani hkrati.'] });
const brezRez = oceniBesedilo(kratko, 'Kovinar', vhod);
t('brez rezerve: kratek seznam zavrnjen', !brezRez.besedilo && /zatika/.test(brezRez.razlog || ''));
const rez2 = oceniBesedilo(kratko, 'Kovinar', vhod, { rezerva: { zatika: [
  'Ker ne veste, kje začeti, odločitev o koraku stoji.',                      // same topic as above: skipped
  'Učinka uporabe zaenkrat nihče ne meri, zato ga je težko pokazati vodstvu.',
  'Izkušnje z orodji se ne zbirajo na enem mestu, zato se dobre rešitve ne širijo.',
] } });
t('z rezervo: dopolnjeno do 3, ponovljena tema preskočena', rez2.besedilo?.zatika.length === 3 && rez2.dopolnjeno?.length === 1 && !rez2.besedilo.zatika.some(s => s.startsWith('Ker ne veste, kje začeti, odločitev')),
  JSON.stringify(rez2.besedilo?.zatika || rez2.razlog));

console.log(`\n${ok} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
