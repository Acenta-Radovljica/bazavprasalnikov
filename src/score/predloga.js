// AI Business Score: deterministic report text, used when the AI text is not (yet) available.
//
// v2 (1. 10. 2026, Matjaž: "the report only repeats what I ticked, things repeat"). Rules:
// - the paragraph interprets the COMBINATION of answers; it does not list them back;
// - each topic appears once in the whole text (one key per topic, tracked in `rabljeno`);
// - "priloznosti" are process opportunities only: the maturity steps are in "Kako do višje
//   ocene" (vzvodi.js) and the first project is in the opportunity card + scenario, so neither
//   is repeated here, and the strongest area itself is left out of the list;
// - no numbers, no promises, nothing beyond what the respondent answered.

const AREA = {          // topic key -> process area (for leaving out the strongest area)
  ponudbe: 'prodaja', povprasevanja: 'prodaja', followup: 'prodaja',
  nabava: 'nabava',
  administracija: 'administracija', dokumenti: 'administracija', iskanje: 'administracija',
  porocila: 'vodstvo', sestanki: 'vodstvo', nacrtovanje: 'vodstvo',
  podpora: 'podpora', marketing: 'marketing',
};

// Process opportunities, one sentence per topic.
const PRILOZNOST = {
  povprasevanja: 'AI lahko pripravi osnutek odgovora na vsako novo povpraševanje, prodajalec ga le pregleda in pošlje.',
  ponudbe: 'Osnutke ponudb lahko AI sestavi iz vaših cenikov in preteklih ponudb.',
  followup: 'AI lahko spremlja odprte ponudbe in vas opomni, kdaj je čas za ponovni stik s stranko.',
  nabava: 'AI lahko ponudbe dobaviteljev zbere in primerja v eni tabeli, preden se odločite.',
  administracija: 'Ponavljajoče se vnose lahko AI pripravi iz dokumentov in e-pošte, zaposleni jih le potrdi.',
  dokumenti: 'AI lahko iz pogodb in drugih dokumentov izlušči ključne podatke in roke.',
  iskanje: 'AI pomočnik, ki pozna vaše dokumente, odgovori na interna vprašanja brez iskanja po mapah.',
  porocila: 'Poročila lahko AI sestavi iz podatkov, ki jih že imate, vi jih le preverite.',
  sestanki: 'AI lahko pripravi povzetek sestanka z nalogami in odgovornimi.',
  nacrtovanje: 'AI lahko pripravi predlog plana ali urnika iz podatkov, ki jih že zbirate.',
  podpora: 'Na pogosta vprašanja strank ali gostov lahko AI odgovori sam, zahtevnejša preda zaposlenemu.',
  marketing: 'AI lahko pripravi osnutke objav in sporočil v vašem tonu, marketing jih le uredi.',
};
// Answer option -> topic key, for the three "where does it hurt" questions.
const TEMA = {
  izguba_casa: { administracija: 'administracija', porocila: 'porocila', iskanje_informacij: 'iskanje', ponudbe: 'ponudbe', povprasevanja: 'povprasevanja', marketing: 'marketing', followup: 'followup', nabava: 'nabava', interna_komunikacija: 'sestanki', sestanki: 'sestanki', dokumenti: 'dokumenti', podpora: 'podpora', nacrtovanje: 'nacrtovanje' },
  stroski: { nabava: 'nabava', rocna_administracija: 'administracija', interna_komunikacija: 'sestanki', ponudbe: 'ponudbe', odzivnost: 'povprasevanja', leadi: 'followup', marketing: 'marketing', porocila: 'porocila', podvajanje: 'administracija', znanje: 'iskanje', zaloge: 'nacrtovanje' },
  potencial: { nabava: 'nabava', prodaja: 'ponudbe', marketing: 'marketing', administracija: 'administracija', vodstvo: 'porocila', podpora: 'podpora', znanje: 'iskanje', finance: 'administracija', projekti: 'nacrtovanje', recepcija: 'podpora', operativa: 'nacrtovanje' },
};

// Level -> one sentence that continues "V podjetju X ..." (the long level text is NOT repeated here).
const KJE = {
  'AI začetnik': 'umetna inteligenca še ni del vsakdanjega dela, zato je pred vami največ lahko dosegljivih korakov.',
  'AI raziskovalec': 'AI že uporabljate, a uporaba sloni na posameznikih in še ni povezana v skupen način dela.',
  'AI uporabnik': 'je AI že v redni uporabi, naslednji izziv pa je, da postane del procesov.',
  'AI pospeševalec': 'AI uporabljate sistematično, zato so na vrsti naprednejši pomočniki in avtomatizacije.',
  'AI-first kandidat': 'je AI že del načina dela, priložnost je v povezovanju oddelkov in podatkov.',
};
const OVIRA = {
  znanje: 'Kot oviro vidite znanje, ki pa se najhitreje gradi na primerih iz vašega dela.',
  strah: 'Zadržki zaposlenih so razumljivi, zato naj prvi projekt njihovo delo olajša, ne nadomesti.',
  cas: 'Ker vam za uvajanje primanjkuje časa, mora biti prvi korak majhen in hitro koristen.',
  kje_zaceti: 'Ne veste, kje začeti, zato vam bo najbolj koristil jasen izbor prvega procesa.',
  poslovni_primer: 'Brez jasnega poslovnega primera je vlaganje težko upravičiti, zato potrebujete merljiv cilj.',
  varnost: 'Skrb za varnost podatkov je upravičena in se uredi s pravili ter izbiro orodij.',
  partner: 'Brez pravega partnerja je uvajanje počasnejše, ker se vsega učite sami.',
  vodstvo: 'Dokler se vodstvo ne odloči, pobude ostajajo na ravni posameznikov.',
};

const eno = (o, id) => (Array.isArray(o?.[id]) ? o[id][0] : o?.[id]) ?? null;
const vec = (o, id) => (Array.isArray(o?.[id]) ? o[id] : o?.[id] ? [o[id]] : []).filter(x => x !== 'ne_vem');

export function sestaviPredlogo(rezultat, podjetje = '', odgovori = {}) {
  const { dimenzije: d, stopnja, proces } = rezultat;
  const kdo = podjetje ? `V podjetju ${podjetje}` : 'V vašem podjetju';
  const rabljeno = new Set();
  const a = (id) => eno(odgovori, id);

  const uporablja = ['posamezniki', 'vec_zaposlenih', 'oddelki', 'procesi'].includes(a('uporaba'));
  const brezPravil = ['ne', 'potrebovali'].includes(a('pravila'));
  const brezOsebe = ['ne', 'neformalno'].includes(a('odgovorna_oseba'));
  const pocasenOdziv = ['2-3dni', 'vec_3dni', 'ni_definirano'].includes(a('odziv'));
  const slabaNabava = ['ne_preverjamo', 'obcasno'].includes(a('nabavne_cene'));
  const akcija = ['1-3m', 'cim_prej', 'pogovor'].includes(a('hitrost'));
  const bolecine = vec(odgovori, 'izguba_casa').length + vec(odgovori, 'stroski').length;

  // ── Paragraph: where you are, the gap that stands out, the area, the obstacle, the way forward ──
  const st = [`${kdo} ${KJE[stopnja.naziv] || 'je AI v začetni fazi.'}`];
  if (stopnja.naziv === 'AI raziskovalec') rabljeno.add('sistematicnost');   // "ni povezana v skupen način dela"
  if (stopnja.naziv === 'AI uporabnik') rabljeno.add('vgradnja');           // "da postane del procesov"
  // Only from 'AI uporabnik' up: lower levels already say AI is not yet a shared way of working.
  if (uporablja && (brezPravil || brezOsebe) && !['AI začetnik', 'AI raziskovalec'].includes(stopnja.naziv)) {
    st.push('Uporaba je prehitela organizacijo: AI se pri delu že uporablja, način dela okoli njega pa še ni dogovorjen.');
    rabljeno.add('sistematicnost');
  } else if (d.zrelost >= 50 && d.potencial >= 50) {
    st.push('Kljub dobri osnovi vam še vedno veliko časa vzamejo opravila, ki bi jih AI lahko prevzel.');
    rabljeno.add('ponavljanje');
  } else if (d.zrelost < 50 && d.potencial >= 50) {
    st.push('Hkrati ste prepoznali več opravil, ki vam jemljejo čas, zato bo korist prvih korakov hitro vidna.');
    rabljeno.add('ponavljanje'); rabljeno.add('poznavanje');
  } else if (!bolecine) {
    st.push('Iz odgovorov še ne izstopa opravilo, ki bi vam vzelo izrazito veliko časa.');
  }
  if (proces) st.push(`Največ priložnosti vidimo na področju „${proces.naziv.toLowerCase()}“, kjer se je zbralo največ vaših odgovorov o izgubljenem času in stroških.`);
  if (OVIRA[a('ovira')]) { st.push(OVIRA[a('ovira')]); rabljeno.add('ovira'); }
  st.push(akcija
    ? 'Ker želite ukrepati v kratkem, ni razloga, da bi s prvim korakom čakali.'
    : 'Ker zaenkrat raziskujete, je dober prvi korak kratek pregled, kje bi AI pri vas koristil najprej.');
  if (akcija) rabljeno.add('hitrost');
  const odstavek = st.join(' ');

  // ── What you do well ──
  const dobro = [];
  const doda = (arr, key, s) => { if (s && !rabljeno.has(key) && arr.length < 5) { arr.push(s); rabljeno.add(key); } };
  doda(dobro, 'uporaba', {
    posamezniki: 'Nekateri zaposleni AI že preizkušajo, zato imate prve izkušnje, na katerih lahko gradite.',
    vec_zaposlenih: 'Več zaposlenih AI uporablja redno, kar je dobra osnova za skupen način dela.',
    oddelki: 'AI je že del dela v posameznih oddelkih.',
    procesi: 'AI je pri vas že vgrajen v poslovne procese.',
  }[a('uporaba')]);
  doda(dobro, 'sistematicnost', {
    priporocila: 'Imate prva interna priporočila za uporabo, kar olajša širjenje na druge.',
    po_oddelkih: 'Načine uporabe AI imate dogovorjene po oddelkih.',
    strategija: 'Imate jasno AI strategijo z dogovorjenimi procesi in odgovornostmi.',
  }[a('sistematicnost')]);
  doda(dobro, 'oseba', ['da', 'ekipa'].includes(a('odgovorna_oseba')) ? 'Za razvoj uporabe AI imate odgovorno osebo ali ekipo.' : null);
  doda(dobro, 'razumevanje', ['dobro', 'zelo_dobro'].includes(a('razumevanje')) ? 'Zaposleni dobro razumejo, kako jim AI lahko pomaga pri delu.' : null);
  doda(dobro, 'pravila', ['osnovna', 'interna', 'politika'].includes(a('pravila')) ? 'Imate pravila za varno uporabo AI in podatkov.' : null);
  doda(dobro, 'odziv', { ure: 'Na nova povpraševanja odgovarjate hitro, kar je pri prodaji velika prednost.', '24h': 'Na nova povpraševanja odgovorite v enem dnevu.' }[a('odziv')]);
  doda(dobro, 'nabava', ['redno', 'sistem', 'avtomatizirano'].includes(a('nabavne_cene')) ? 'Ponudbe dobaviteljev redno primerjate.' : null);
  doda(dobro, 'hitrost', akcija ? 'Pripravljeni ste ukrepati v kratkem, kar močno olajša uvajanje.' : null);
  doda(dobro, 'odlocevalec', ['lastnik', 'direktor'].includes(a('vloga')) ? 'Oceno je izpolnil nekdo, ki o naslednjem koraku tudi odloča, kar skrajša pot do projekta.' : null);
  doda(dobro, 'pomoc', a('pomoc') && a('pomoc') !== 'ne_vem' ? 'Že veste, kakšno pomoč potrebujete pri naslednjem koraku, kar olajša načrt.' : null);
  doda(dobro, 'poznavanje', bolecine ? 'Dobro veste, katera opravila vam vzamejo največ časa, kar je najboljše izhodišče za prvi projekt.' : null);
  if (dobro.length < 3) doda(dobro, 'prvi', 'Z izpolnjeno oceno ste naredili prvi korak: veste, kje ste danes.');

  // ── Where it gets stuck (diagnosis; the actions are in "Kako do višje ocene") ──
  const zatika = [];
  doda(zatika, 'pravila', brezPravil ? 'Brez pravil za varno uporabo obstaja tveganje, da občutljivi podatki končajo v javnih orodjih.' : null);
  doda(zatika, 'oseba', brezOsebe ? 'Nihče ni zadolžen za razvoj uporabe AI, zato pobude hitro zastanejo.' : (a('odgovorna_oseba') === 'brez_odgovornosti' ? 'Oseba za AI obstaja, a brez jasne odgovornosti in cilja.' : null));
  doda(zatika, 'odziv', pocasenOdziv ? 'Odziv na nova povpraševanja je počasen ali ni določen, kar pomeni izgubljene priložnosti.' : null);
  doda(zatika, 'nabava', slabaNabava ? 'Cen dobaviteljev ne primerjate sistematično, zato so prihranki pri nabavi neizkoriščeni.' : null);
  doda(zatika, 'sistematicnost', ['ni', 'vsak_po_svoje'].includes(a('sistematicnost')) ? 'Ni dogovorjenega načina uporabe, zato so rezultati odvisni od tega, kdo dela.' : null);
  doda(zatika, 'uporaba', { ne: 'AI v podjetju še ne uporabljate, zato zaposleni nimajo izkušenj, na katerih bi gradili.', oddelki: 'Oddelki AI uporabljajo vsak po svoje, izkušnje se med njimi ne delijo.' }[a('uporaba')]);
  doda(zatika, 'razumevanje', ['zelo_slabo', 'slabo'].includes(a('razumevanje')) ? 'Zaposleni še ne vidijo, kako bi jim AI pomagal pri njihovem delu.' : null);
  doda(zatika, 'casneznan', vec(odgovori, 'izguba_casa').length === 0 && Array.isArray(odgovori.izguba_casa) ? 'Ni jasno, kje se izgublja največ časa, zato je težko izbrati, kje začeti.' : null);
  doda(zatika, 'ovira', OVIRA[a('ovira')]);
  doda(zatika, 'razumevanje', a('razumevanje') === 'povprecno' ? 'Razumevanje AI med zaposlenimi je povprečno, zato uporaba ostaja pri preprostih opravilih.' : null);
  doda(zatika, 'vgradnja', a('uporaba') !== 'procesi' ? 'AI še ni vgrajen v procese, zato je korist odvisna od tega, ali se ga kdo spomni uporabiti.' : null);
  doda(zatika, 'deljenje', a('uporaba') !== 'procesi' && a('sistematicnost') !== 'strategija' ? 'Izkušnje posameznikov z AI se še ne zbirajo, zato se dobre rešitve ne razširijo.' : null);
  doda(zatika, 'cilji', 'Uporaba AI še ni povezana z merljivimi cilji, zato je učinek težko pokazati.');
  doda(zatika, 'povezovanje', d.zrelost >= 75 ? 'Naslednji izziv ni več uporaba, ampak povezovanje AI z vašimi sistemi in podatki.' : null);
  doda(zatika, 'zamik', a('hitrost') === '3-6m' ? 'Naslednji korak načrtujete čez nekaj mesecev, orodja pa se medtem hitro razvijajo.' : null);
  doda(zatika, 'ponavljanje', d.potencial >= 50 ? 'Precej časa gre v ponavljajoča se opravila, ki bi jih lahko prevzela orodja.' : null);

  // ── Opportunities: process topics from their own answers, strongest area left out ──
  const priloznosti = [];
  const teme = [];
  if (pocasenOdziv) teme.push('povprasevanja');
  for (const id of ['izguba_casa', 'stroski', 'potencial']) for (const o of vec(odgovori, id)) if (TEMA[id][o]) teme.push(TEMA[id][o]);
  if (slabaNabava) teme.push('nabava');
  for (const t of teme) {
    if (proces && AREA[t] === proces.id) continue;
    doda(priloznosti, 'p-' + t, PRILOZNOST[t]);
  }
  doda(priloznosti, 'p-prenos', 'Ko prvi projekt deluje, isti pristop prenesite na naslednje opravilo, ki vam jemlje čas.');
  doda(priloznosti, 'p-povzetki', 'Daljše dokumente in e-poštne niti lahko AI povzame v nekaj vrsticah, preden jih preberete.');
  if (!rabljeno.has('p-podpora')) doda(priloznosti, 'p-posta', 'AI lahko razvrsti dohodno e-pošto in pripravi osnutke odgovorov na vprašanja, ki se ponavljajo.');
  if (!['p-ponudbe', 'p-marketing', 'p-povprasevanja'].some(k => rabljeno.has(k))) doda(priloznosti, 'p-osnutki', 'Prve osnutke besedil, kot so ponudbe, odgovori in objave, lahko pripravi AI, zaposleni jih le uredijo.');
  if (!rabljeno.has('deljenje')) doda(priloznosti, 'p-znanje', 'Dobre primere uporabe zberite na enem mestu, da jih lahko uporabljajo vsi zaposleni.');

  return { odstavek, dobro, zatika, priloznosti };
}
