// AI Business Score v2: question set and point table (2. 10. 2026).
//
// Matjaž (1. 10.): "check the Panta Rei report and correct ours, including the questions".
// Every question here is from his Word "Vprašalnik Business score" (Word numbering in `word`);
// none is invented. Changes from v1:
// - new for everyone: 2.3 what AI is used for, 11.1 one process in the next 90 days, 11.2 goal
//   of the first AI project;
// - 4.3 "where do you see potential" is out (third near-identical list); 11.1 replaces it;
// - one follow-up block of 3 questions (Word sections 5 to 10) for the area picked at 11.1,
//   so 5.1 (purchase prices) and 6.1 (response time) are now asked only in their own block.
// Maturity questions, level thresholds and dimension weights are unchanged, so levels stay
// comparable with v1. Points on the new answers are our proposal, to be confirmed by Matjaž
// (as in v1). Changing any point or option id = new SCORE_VERSION.
//
// Option ids are stable ASCII slugs stored in responses.raw_data.

import {
  VPRASANJA as V1, VELIKOST, STOPNJE, PODROCJA, PODROCJE_NAZIV, PRIPOROCILO_PROCES,
} from './vprasanja-v1.js';

export { VELIKOST, STOPNJE, PODROCJA, PODROCJE_NAZIV, PRIPOROCILO_PROCES };
export const SCORE_VERSION = 'v2';

const v1 = (id) => V1.find(q => q.id === id);

// Area follow-up "would an AI assistant help you" (Word 5.4, 6.4, 7.3, 8.3, 9.4, 10.3): same
// answers everywhere; readiness 0–4, and "yes" or stronger is a signal for the area.
const INTERES = [
  { id: 'ne', text: 'Ne', prip: 0 },
  { id: 'mogoce', text: 'Mogoče', prip: 1 },
  { id: 'da', text: 'Da', prip: 2 },
  { id: 'zelo', text: 'Da, zelo', prip: 3 },
  { id: 'cim_prej', text: 'To bi želeli preizkusiti čim prej', prip: 4, akcija: true },
];
const interes = (id, word, podrocje, text) => ({ id, word, tip: 'ena', podrocje, del: 'interes', text, moznosti: INTERES });

// Follow-up blocks: two diagnostic questions (pot 0–4) and one interest question per area.
const SKLOPI = {
  nabava: [
    { ...v1('nabavne_cene'), podrocje: 'nabava' },
    {
      id: 'nabava_ure', word: '5.2', tip: 'ena', podrocje: 'nabava',
      text: 'Koliko časa mesečno porabite za iskanje ponudnikov, primerjavo cen ali preverjanje alternativ?',
      moznosti: [
        { id: 'manj_2', text: 'Manj kot 2 uri', pot: 0 },
        { id: '2-5', text: '2–5 ur', pot: 1 },
        { id: '6-10', text: '6–10 ur', pot: 2, sig: 'nabava' },
        { id: '11-20', text: '11–20 ur', pot: 3, sig: 'nabava' },
        { id: 'vec_20', text: 'Več kot 20 ur', pot: 4, sig: 'nabava' },
        { id: 'ne_vem', text: 'Ne vem', pot: 2 },
      ],
    },
    interes('nabava_agent', '5.4', 'nabava', 'Ali bi vam koristil AI agent, ki bi pomagal iskati alternativne ponudnike, primerjati cene in pripravljati povpraševanja?'),
  ],
  prodaja: [
    { ...v1('odziv'), podrocje: 'prodaja' },
    {
      id: 'ponudbe_ponavljajoce', word: '6.3', tip: 'ena', podrocje: 'prodaja',
      text: 'Ali imate ponavljajoče se vrste ponudb, ki bi jih lahko delno avtomatizirali?',
      moznosti: [
        { id: 'ne', text: 'Ne', pot: 0 },
        { id: 'mogoce', text: 'Mogoče', pot: 1 },
        { id: 'nekaj', text: 'Da, nekaj', pot: 3, sig: 'prodaja' },
        { id: 'veliko', text: 'Da, veliko', pot: 4, sig: 'prodaja' },
        { id: 'ne_vem', text: 'Ne vem', pot: 1 },
      ],
    },
    interes('prodaja_pomocnik', '6.4', 'prodaja', 'Ali bi vam koristil AI pomočnik za pripravo ponudb, prodajnih argumentov in sporočil za sledenje strankam?'),
  ],
  marketing: [
    {
      id: 'marketing_izziv', word: '7.1', tip: 'ena', podrocje: 'marketing',
      text: 'Kateri je vaš največji izziv pri marketingu?',
      moznosti: [
        { id: 'cas', text: 'Premalo časa za vsebine', pot: 4, sig: 'marketing' },
        { id: 'ideje', text: 'Premalo idej', pot: 3, sig: 'marketing' },
        { id: 'nekonsistentno', text: 'Nekonsistentna komunikacija', pot: 3, sig: 'marketing' },
        { id: 'podatki', text: 'Slaba uporaba podatkov', pot: 3, sig: 'marketing' },
        { id: 'merjenje', text: 'Premalo merjenja rezultatov', pot: 2 },
        { id: 'povprasevanja', text: 'Premalo povpraševanj', pot: 3, sig: 'marketing' },
        { id: 'rocno', text: 'Preveč ročnega dela', pot: 4, sig: 'marketing' },
        { id: 'strategija', text: 'Nimamo jasne strategije', pot: 2 },
        { id: 'ni_prioriteta', text: 'Marketing ni trenutna prioriteta', pot: 0 },
      ],
    },
    {
      id: 'vsebine_pogostost', word: '7.2', tip: 'ena', podrocje: 'marketing',
      text: 'Kako pogosto pripravljate vsebine za splet, e-pošto, družbena omrežja ali prodajna gradiva?',
      moznosti: [
        { id: 'skoraj_nikoli', text: 'Skoraj nikoli', pot: 0 },
        { id: 'obcasno', text: 'Občasno', pot: 1 },
        { id: 'mesecno', text: 'Mesečno', pot: 2 },
        { id: 'tedensko', text: 'Tedensko', pot: 3, sig: 'marketing' },
        { id: 'veckrat_tedensko', text: 'Večkrat tedensko', pot: 4, sig: 'marketing' },
      ],
    },
    interes('marketing_sistem', '7.3', 'marketing', 'Ali bi vam koristil AI sistem za vsebinske načrte, osnutke objav in e-poštne kampanje?'),
  ],
  administracija: [
    {
      id: 'admin_opravila', word: '8.1', tip: 'vec', max: 3, podrocje: 'administracija',
      text: 'Katera administrativna opravila vam vzamejo največ časa?',
      // Multi: pot comes from how many are named (0–3 -> 0, 2, 3, 4), see izracunaj.js.
      moznosti: [
        { id: 'zapisniki', text: 'Zapisniki sestankov', sig: 'administracija' },
        { id: 'povzetki', text: 'Povzetki dokumentov', sig: 'administracija' },
        { id: 'porocila', text: 'Priprava poročil', sig: 'administracija' },
        { id: 'navodila', text: 'Priprava internih navodil', sig: 'administracija' },
        { id: 'iskanje', text: 'Iskanje informacij', sig: 'administracija' },
        { id: 'dokumenti', text: 'Urejanje dokumentov', sig: 'administracija' },
        { id: 'vprasanja', text: 'Odgovarjanje na ponavljajoča se vprašanja', sig: 'administracija' },
        { id: 'termini', text: 'Usklajevanje terminov', sig: 'administracija' },
        { id: 'komunikacija', text: 'Komunikacija med oddelki', sig: 'administracija' },
        { id: 'drugo', text: 'Drugo' },   // no signal: not a nameable task, but combinable
      ],
    },
    {
      id: 'baza_znanja', word: '8.2', tip: 'ena', podrocje: 'administracija',
      text: 'Ali imate v podjetju urejeno interno bazo znanja?',
      moznosti: [
        { id: 'ne', text: 'Ne', pot: 4, sig: 'administracija' },
        { id: 'delno', text: 'Delno', pot: 3, sig: 'administracija' },
        { id: 'tezko', text: 'Imamo dokumente, vendar jih je težko uporabljati', pot: 3, sig: 'administracija' },
        { id: 'urejeno', text: 'Imamo urejeno bazo znanja', pot: 1 },
        { id: 'ai', text: 'Imamo sistem, kjer AI pomaga iskati odgovore', pot: 0 },
      ],
    },
    interes('znanje_pomocnik', '8.3', 'administracija', 'Ali bi vam koristil AI pomočnik, ki bi zaposlenim pomagal hitro najti interne informacije, dokumente in navodila?'),
  ],
  vodstvo: [
    {
      id: 'informacije_hitrost', word: '9.2', tip: 'ena', podrocje: 'vodstvo',
      text: 'Kako hitro danes pridete do jasnih informacij za odločanje?',
      moznosti: [
        { id: 'zelo_pocasi', text: 'Zelo počasi', pot: 4, sig: 'vodstvo' },
        { id: 'pocasi', text: 'Počasi', pot: 3, sig: 'vodstvo' },
        { id: 'srednje', text: 'Srednje hitro', pot: 2 },
        { id: 'hitro', text: 'Hitro', pot: 1 },
        { id: 'zelo_hitro', text: 'Zelo hitro', pot: 0 },
      ],
    },
    {
      id: 'kpi_porocila', word: '9.3', tip: 'ena', podrocje: 'vodstvo',
      text: 'Ali imate redna poročila s ključnimi kazalniki?',
      moznosti: [
        { id: 'ne', text: 'Ne', pot: 4, sig: 'vodstvo' },
        { id: 'delno', text: 'Delno', pot: 3, sig: 'vodstvo' },
        { id: 'neuporabna', text: 'Da, vendar niso dovolj uporabna', pot: 3, sig: 'vodstvo' },
        { id: 'kakovostna', text: 'Da, imamo kakovostna poročila', pot: 1 },
        { id: 'analiza', text: 'Da, imamo poročila in redno vodstveno analizo', pot: 0 },
      ],
    },
    interes('direktor_pomocnik', '9.4', 'vodstvo', 'Ali bi vam koristil AI pomočnik za direktorja, ki bi pomagal pri analizi poročil, pripravi sestankov in odločitev?'),
  ],
  podpora: [
    {
      id: 'vprasanja_pogostost', word: '10.1', tip: 'ena', podrocje: 'podpora',
      text: 'Kako pogosto dobivate ponavljajoča se vprašanja strank, gostov ali partnerjev?',
      moznosti: [
        { id: 'skoraj_nikoli', text: 'Skoraj nikoli', pot: 0 },
        { id: 'obcasno', text: 'Občasno', pot: 1 },
        { id: 'tedensko', text: 'Tedensko', pot: 2 },
        { id: 'dnevno', text: 'Dnevno', pot: 3, sig: 'podpora' },
        { id: 'veckrat_dnevno', text: 'Večkrat dnevno', pot: 4, sig: 'podpora' },
      ],
    },
    {
      id: 'komunikacija_cas', word: '10.2', tip: 'ena', podrocje: 'podpora',
      text: 'Kje izgubljate največ časa pri komunikaciji s strankami?',
      moznosti: [
        { id: 'ponavljajoca', text: 'Odgovarjanje na ponavljajoča se vprašanja', pot: 4, sig: 'podpora' },
        { id: 'personalizirani', text: 'Priprava personaliziranih odgovorov', pot: 3, sig: 'podpora' },
        { id: 'iskanje', text: 'Iskanje informacij', pot: 3, sig: 'podpora' },
        { id: 'pocasno', text: 'Prepočasno odzivanje', pot: 3, sig: 'podpora' },
        { id: 'kanali', text: 'Preveč kanalov komunikacije', pot: 2 },
        { id: 'ni_tezav', text: 'Nimamo težav s tem', pot: 0 },
      ],
    },
    interes('podpora_pomocnik', '10.3', 'podpora', 'Ali bi vam koristil AI pomočnik za podporo strankam, gostom ali partnerjem?'),
  ],
};
export const POGLOBLJENI = Object.fromEntries(Object.entries(SKLOPI).map(([p, qs]) => [p, qs.map(q => q.id)]));

// Order is the order on screen (approved plan, 2. 10. 2026). The follow-up block sits right
// after `proces90`; the browser shows only the block of the chosen area (public/score/razvejitev.js).
export const VPRASANJA = [
  v1('uporaba'),
  {
    id: 'naloge', word: '2.3', tip: 'vec', max: 3,
    text: 'Za kaj AI trenutno največ uporabljate?',
    // Not scored: the report compares where AI is used with where time is lost.
    moznosti: [
      { id: 'pisanje_poste', text: 'Pisanje e-pošte' },
      { id: 'vsebine', text: 'Priprava vsebin', podr: 'marketing' },
      { id: 'prevajanje', text: 'Prevajanje' },
      { id: 'ideje', text: 'Iskanje idej' },
      { id: 'analiza', text: 'Analiza podatkov', podr: 'vodstvo' },
      { id: 'porocila', text: 'Priprava poročil', podr: 'vodstvo' },
      { id: 'prodaja', text: 'Pomoč pri prodaji', podr: 'prodaja' },
      { id: 'marketing', text: 'Pomoč pri marketingu', podr: 'marketing' },
      { id: 'administracija', text: 'Pomoč pri administraciji', podr: 'administracija' },
      { id: 'nabava', text: 'Pomoč pri nabavi', podr: 'nabava' },
      { id: 'odlocanje', text: 'Pomoč pri odločanju', podr: 'vodstvo' },
      { id: 'ne_uporabljamo', text: 'AI ne uporabljamo', nevtralno: true },
    ],
  },
  v1('sistematicnost'),
  v1('odgovorna_oseba'),
  v1('razumevanje'),
  v1('pravila'),
  v1('ovira'),
  v1('izguba_casa'),
  v1('stroski'),
  {
    id: 'proces90', word: '11.1', tip: 'ena',
    text: 'Če bi lahko z AI v naslednjih 90 dneh izboljšali en proces, kateri bi bil najpomembnejši?',
    // `podrocje` picks the follow-up block and adds 2 signals to that area (izracunaj.js).
    moznosti: [
      { id: 'nabava', text: 'Nabava', podrocje: 'nabava' },
      { id: 'prodaja', text: 'Prodaja', podrocje: 'prodaja' },
      { id: 'marketing', text: 'Marketing', podrocje: 'marketing' },
      { id: 'administracija', text: 'Administracija', podrocje: 'administracija' },
      { id: 'vodstvo', text: 'Vodstvo', podrocje: 'vodstvo' },
      { id: 'podpora', text: 'Podpora strankam', podrocje: 'podpora' },
      { id: 'znanje', text: 'Interno znanje', podrocje: 'administracija' },
      { id: 'operativa', text: 'Operativa' },
      { id: 'ne_vem', text: 'Ne vem, potrebujemo pomoč pri izbiri' },
    ],
  },
  ...Object.values(SKLOPI).flat(),
  {
    id: 'cilj', word: '11.2', tip: 'ena',
    text: 'Kaj bi moral biti glavni cilj prve uvedbe AI?',
    // Not scored: the report measures the first project against this goal.
    moznosti: [
      { id: 'cas', text: 'Prihranek časa' },
      { id: 'stroski', text: 'Znižanje stroškov' },
      { id: 'prodaja', text: 'Več prodaje' },
      { id: 'odlocanje', text: 'Hitrejše odločanje' },
      { id: 'izkusnja', text: 'Boljša uporabniška izkušnja' },
      { id: 'napake', text: 'Manj napak' },
      { id: 'produktivnost', text: 'Večja produktivnost zaposlenih' },
      { id: 'znanje', text: 'Boljša organizacija znanja' },
    ],
  },
  v1('hitrost'),
  v1('pomoc'),
  v1('interpretacija'),
  v1('panoga'),
  v1('vloga'),
];
