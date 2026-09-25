// AI Business Score v1: question set and point table.
//
// Source: SharePoint "Vprašalnik Business score.docx" (Word numbering kept in `word`),
// weights and rules: "Logika točkovanja in poročilo.docx". The document defines weights and
// lead rules but NOT points per answer; the numbers below are our v1 assumption and must be
// approved by Matjaž before launch. Changing any point or option id = new SCORE_VERSION.
//
// Option ids are stable ASCII slugs: they are stored in responses.raw_data and sent nowhere
// else, so texts may be reworded without touching stored answers.

export const SCORE_VERSION = 'v1';

// Process areas used for the "strongest process" signal. Order = tie-break by business impact
// (document: nabava, prodaja, administracija, vodstvo, podpora, marketing).
export const PODROCJA = ['nabava', 'prodaja', 'administracija', 'vodstvo', 'podpora', 'marketing'];

export const PODROCJE_NAZIV = {
  nabava: 'Nabava',
  prodaja: 'Prodaja',
  administracija: 'Administracija in interno znanje',
  vodstvo: 'Vodstvo in odločanje',
  podpora: 'Podpora strankam in gostom',
  marketing: 'Marketing',
};

// Contact step (asked first). Only `velikost` is scored.
export const VELIKOST = [
  { id: '1-5', text: '1–5', fin: 0 },
  { id: '6-20', text: '6–20', fin: 1 },
  { id: '21-50', text: '21–50', fin: 2 },
  { id: '51-100', text: '51–100', fin: 3 },
  { id: '100+', text: 'več kot 100', fin: 4 },
];

// Point keys per option: zre (maturity 0–4), pot (process potential), prip (readiness 0–4),
// fin (financial potential), sig (process area signal).
export const VPRASANJA = [
  {
    id: 'panoga', word: '1.2', tip: 'ena', text: 'V kateri panogi deluje vaše podjetje?',
    moznosti: [
      { id: 'turizem', text: 'Turizem, hotelirstvo, kampi', fin: 2 },
      { id: 'dmo', text: 'Destinacijska organizacija (DMO)', fin: 1 },
      { id: 'dmc', text: 'DMC ali turistična agencija', fin: 1 },
      { id: 'proizvodnja', text: 'Proizvodnja', fin: 2 },
      { id: 'trgovina', text: 'Trgovina ali distribucija', fin: 2 },
      { id: 'storitve', text: 'Storitvena dejavnost', fin: 1 },
      { id: 'gradbenistvo', text: 'Gradbeništvo ali projektiva', fin: 2 },
      { id: 'zdravstvo', text: 'Zdravstvo ali wellness', fin: 1 },
      { id: 'izobrazevanje', text: 'Izobraževanje', fin: 1 },
      { id: 'drugo', text: 'Drugo', fin: 1 },
    ],
  },
  {
    id: 'vloga', word: '1.3', tip: 'ena', text: 'Kakšna je vaša vloga v podjetju?',
    moznosti: [
      { id: 'lastnik', text: 'Lastnik', fin: 2, odlocevalec: true },
      { id: 'direktor', text: 'Direktor', fin: 2, odlocevalec: true },
      { id: 'vodja_marketinga', text: 'Vodja marketinga', fin: 1 },
      { id: 'vodja_prodaje', text: 'Vodja prodaje', fin: 1 },
      { id: 'vodja_operacij', text: 'Vodja operacij', fin: 1 },
      { id: 'vodja_administracije', text: 'Vodja administracije ali podpore', fin: 1 },
      { id: 'zaposleni', text: 'Zaposleni', fin: 0 },
      { id: 'drugo', text: 'Drugo', fin: 0 },
    ],
  },
  {
    id: 'uporaba', word: '2.1', tip: 'ena', text: 'Kako danes uporabljate umetno inteligenco v podjetju?',
    moznosti: [
      { id: 'ne', text: 'Sploh je ne uporabljamo', zre: 0 },
      { id: 'posamezniki', text: 'Posamezniki jo občasno uporabljajo', zre: 1 },
      { id: 'vec_zaposlenih', text: 'Več zaposlenih jo redno uporablja', zre: 2 },
      { id: 'oddelki', text: 'Uporabljamo jo v posameznih oddelkih', zre: 3 },
      { id: 'procesi', text: 'AI je že del naših poslovnih procesov', zre: 4 },
    ],
  },
  {
    id: 'sistematicnost', word: '2.4', tip: 'ena', text: 'Kako sistematična je uporaba AI v vašem podjetju?',
    moznosti: [
      { id: 'ni', text: 'Ni sistematična', zre: 0 },
      { id: 'vsak_po_svoje', text: 'Vsak jo uporablja po svoje', zre: 1 },
      { id: 'priporocila', text: 'Imamo nekaj internih priporočil', zre: 2 },
      { id: 'po_oddelkih', text: 'Imamo dogovorjene načine uporabe po oddelkih', zre: 3 },
      { id: 'strategija', text: 'Imamo jasno AI strategijo, procese in odgovornosti', zre: 4 },
    ],
  },
  {
    id: 'odgovorna_oseba', word: '2.5', tip: 'ena', text: 'Ali imate v podjetju osebo, odgovorno za razvoj uporabe AI?',
    moznosti: [
      { id: 'ne', text: 'Ne', zre: 0 },
      { id: 'neformalno', text: 'Neformalno, nekdo se s tem ukvarja občasno', zre: 1 },
      { id: 'brez_odgovornosti', text: 'Da, vendar brez jasne odgovornosti', zre: 2 },
      { id: 'da', text: 'Da, imamo odgovorno osebo', zre: 3 },
      { id: 'ekipa', text: 'Da, imamo ekipo ali formalno AI funkcijo', zre: 4 },
    ],
  },
  {
    id: 'razumevanje', word: '3.1', tip: 'ena', text: 'Kako dobro zaposleni razumejo, kako jim lahko AI pomaga pri delu?',
    moznosti: [
      { id: 'zelo_slabo', text: 'Zelo slabo', zre: 0 },
      { id: 'slabo', text: 'Slabo', zre: 1 },
      { id: 'povprecno', text: 'Povprečno', zre: 2 },
      { id: 'dobro', text: 'Dobro', zre: 3 },
      { id: 'zelo_dobro', text: 'Zelo dobro', zre: 4 },
    ],
  },
  {
    id: 'pravila', word: '3.3', tip: 'ena', text: 'Ali imate pravila za varno uporabo AI?',
    moznosti: [
      { id: 'ne', text: 'Ne', zre: 0 },
      { id: 'potrebovali', text: 'Ne, a bi jih potrebovali', zre: 0 },
      { id: 'osnovna', text: 'Imamo osnovna priporočila', zre: 2 },
      { id: 'interna', text: 'Imamo interna pravila', zre: 3 },
      { id: 'politika', text: 'Imamo jasno politiko uporabe AI in varovanja podatkov', zre: 4 },
    ],
  },
  {
    id: 'izguba_casa', word: '4.1', tip: 'vec', max: 3, text: 'Kje v podjetju danes izgubite največ časa?',
    moznosti: [
      { id: 'administracija', text: 'Administracija', sig: 'administracija' },
      { id: 'porocila', text: 'Priprava poročil', sig: 'administracija' },
      { id: 'iskanje_informacij', text: 'Iskanje informacij', sig: 'administracija' },
      { id: 'ponudbe', text: 'Priprava ponudb', sig: 'prodaja' },
      { id: 'povprasevanja', text: 'Odgovarjanje na povpraševanja', sig: 'prodaja' },
      { id: 'marketing', text: 'Marketing in priprava vsebin', sig: 'marketing' },
      { id: 'followup', text: 'Prodaja in sledenje strankam', sig: 'prodaja' },
      { id: 'nabava', text: 'Nabava in primerjava ponudb', sig: 'nabava' },
      { id: 'interna_komunikacija', text: 'Interna komunikacija', sig: 'administracija' },
      { id: 'sestanki', text: 'Organizacija sestankov', sig: 'vodstvo' },
      { id: 'dokumenti', text: 'Delo z dokumenti', sig: 'administracija' },
      { id: 'podpora', text: 'Podpora strankam', sig: 'podpora' },
      { id: 'nacrtovanje', text: 'Operativno načrtovanje', sig: 'vodstvo' },
      { id: 'ne_vem', text: 'Ne vem', nevtralno: true },
    ],
  },
  {
    id: 'stroski', word: '4.2', tip: 'vec', max: 3, text: 'Kateri proces vam danes povzroča največ nepotrebnih stroškov?',
    moznosti: [
      { id: 'nabava', text: 'Nabava', sig: 'nabava' },
      { id: 'rocna_administracija', text: 'Ročna administracija', sig: 'administracija' },
      { id: 'interna_komunikacija', text: 'Slabo urejena interna komunikacija', sig: 'administracija' },
      { id: 'ponudbe', text: 'Preveč časa za pripravo ponudb', sig: 'prodaja' },
      { id: 'odzivnost', text: 'Prepočasno odzivanje na povpraševanja', sig: 'prodaja' },
      { id: 'leadi', text: 'Slabo izkoriščene prodajne priložnosti', sig: 'prodaja' },
      { id: 'marketing', text: 'Nekonsistenten marketing', sig: 'marketing' },
      { id: 'porocila', text: 'Preveč ročnega dela pri poročilih', sig: 'vodstvo' },
      { id: 'podvajanje', text: 'Podvajanje dela', sig: 'administracija' },
      { id: 'znanje', text: 'Slabo upravljanje znanja', sig: 'administracija' },
      { id: 'zaloge', text: 'Slabo načrtovanje zalog ali virov', sig: 'nabava' },
      { id: 'ne_vem', text: 'Ne vem', nevtralno: true },
    ],
  },
  {
    id: 'potencial', word: '4.3', tip: 'vec', max: 3, text: 'Kje vidite največji potencial za izboljšave z AI?',
    moznosti: [
      { id: 'nabava', text: 'Nabava', sig: 'nabava' },
      { id: 'prodaja', text: 'Prodaja', sig: 'prodaja' },
      { id: 'marketing', text: 'Marketing', sig: 'marketing' },
      { id: 'administracija', text: 'Administracija', sig: 'administracija' },
      { id: 'vodstvo', text: 'Vodstvo in odločanje', sig: 'vodstvo' },
      { id: 'podpora', text: 'Podpora strankam', sig: 'podpora' },
      { id: 'znanje', text: 'Interno znanje', sig: 'administracija' },
      { id: 'finance', text: 'Računovodstvo in finance', sig: 'administracija' },
      { id: 'kadri', text: 'Kadri', sig: 'administracija' },
      { id: 'projekti', text: 'Projektno vodenje', sig: 'vodstvo' },
      { id: 'recepcija', text: 'Recepcija, komunikacija z gosti', sig: 'podpora' },
      { id: 'operativa', text: 'Operativa', sig: 'vodstvo' },
      { id: 'ne_vem', text: 'Ne vem', nevtralno: true },
    ],
  },
  {
    id: 'odziv', word: '6.1', tip: 'ena', text: 'Kako hitro običajno odgovorite na novo povpraševanje?',
    // Slower response = larger sales opportunity.
    moznosti: [
      { id: 'ure', text: 'V nekaj urah', pot: 0 },
      { id: '24h', text: 'V 24 urah', pot: 1 },
      { id: '2-3dni', text: 'V 2–3 dneh', pot: 3, sig: 'prodaja' },
      { id: 'vec_3dni', text: 'V več kot 3 dneh', pot: 4, sig: 'prodaja' },
      { id: 'ni_definirano', text: 'Ni jasno določeno', pot: 3, sig: 'prodaja' },
    ],
  },
  {
    id: 'nabavne_cene', word: '5.1', tip: 'ena', text: 'Kako danes preverjate, ali kupujete po dobrih cenah?',
    // Less systematic = larger procurement opportunity.
    moznosti: [
      { id: 'ne_preverjamo', text: 'Tega ne preverjamo sistematično', pot: 4, sig: 'nabava' },
      { id: 'obcasno', text: 'Občasno ročno preverimo ponudbe', pot: 3, sig: 'nabava' },
      { id: 'redno', text: 'Redno primerjamo več ponudnikov', pot: 2 },
      { id: 'sistem', text: 'Imamo urejen sistem primerjave ponudb', pot: 1 },
      { id: 'avtomatizirano', text: 'Imamo avtomatiziran ali podatkovno podprt proces', pot: 0 },
    ],
  },
  {
    id: 'ovira', word: '3.2', tip: 'ena', text: 'Kaj je trenutno največja ovira pri uporabi AI v vašem podjetju?',
    // Not scored: used only for report text.
    moznosti: [
      { id: 'znanje', text: 'Pomanjkanje znanja' },
      { id: 'strah', text: 'Strah zaposlenih' },
      { id: 'cas', text: 'Pomanjkanje časa' },
      { id: 'kje_zaceti', text: 'Ne vemo, kje začeti' },
      { id: 'poslovni_primer', text: 'Nimamo jasnega poslovnega primera' },
      { id: 'varnost', text: 'Skrbi nas varnost podatkov' },
      { id: 'partner', text: 'Nimamo pravega partnerja' },
      { id: 'vodstvo', text: 'Vodstvo se še ni odločilo' },
      { id: 'drugo', text: 'Drugo' },
    ],
  },
  {
    id: 'hitrost', word: '11.3', tip: 'ena', text: 'Kako hitro bi želeli narediti naslednji korak?',
    moznosti: [
      { id: 'raziskujemo', text: 'Samo informativno raziskujemo', prip: 0, fin: 0 },
      { id: '3-6m', text: 'V naslednjih 3–6 mesecih', prip: 1, fin: 1 },
      { id: '1-3m', text: 'V naslednjih 1–3 mesecih', prip: 3, fin: 2, akcija: true },
      { id: 'cim_prej', text: 'Čim prej', prip: 4, fin: 2, akcija: true },
      { id: 'pogovor', text: 'Najprej želimo 30-minutni pogovor', prip: 4, fin: 2, akcija: true },
    ],
  },
  {
    id: 'pomoc', word: '11.4', tip: 'ena', text: 'Kaj bi vam najbolj pomagalo pri naslednjem koraku?',
    moznosti: [
      { id: 'delavnica', text: 'AI delavnica za zaposlene', prip: 2 },
      { id: 'diagnostika', text: 'AI diagnostika podjetja', prip: 3 },
      { id: 'roadmap', text: 'Načrt uvajanja AI (roadmap)', prip: 3 },
      { id: 'pilot', text: 'Pilotna uvedba v enem procesu', prip: 4 },
      { id: 'direktor', text: 'AI pomočnik za direktorja', prip: 3, sig: 'vodstvo' },
      { id: 'agent_nabava', text: 'AI agent za nabavo', prip: 3, sig: 'nabava' },
      { id: 'pomocnik_prodaja', text: 'AI pomočnik za prodajo', prip: 3, sig: 'prodaja' },
      { id: 'pomocnik_marketing', text: 'AI pomočnik za marketing', prip: 3, sig: 'marketing' },
      { id: 'retainer', text: 'Mesečna podpora pri AI', prip: 3 },
      { id: 'ne_vem', text: 'Ne vem, potrebujemo priporočilo', prip: 1 },
    ],
  },
  {
    id: 'interpretacija', word: '12.5', tip: 'ena', text: 'Ali želite, da vam pomagamo razložiti rezultat?',
    moznosti: [
      { id: 'ne', text: 'Ne', prip: 0 },
      { id: 'priporocilo', text: 'Da, pošljite mi osnovno priporočilo', prip: 1 },
      { id: 'pogovor', text: 'Da, želim 30-minutni pogovor', prip: 4, akcija: true },
      { id: 'diagnostika', text: 'Da, zanima nas AI diagnostika podjetja', prip: 4, akcija: true },
    ],
  },
];

// Five levels from the scoring document, thresholds on the MATURITY dimension (0–100).
export const STOPNJE = [
  { do: 20, naziv: 'AI začetnik', priporocilo: 'AI delavnica in osnovna AI diagnostika',
    opis: 'Vaše podjetje je v začetni fazi uporabe umetne inteligence. To ni slabost: pomeni, da imate še veliko neizkoriščenega potenciala. Najbolj smiseln prvi korak je izobraževanje ključnih zaposlenih in izbor enega poslovnega procesa, kjer lahko AI hitro pokaže učinek.' },
  { do: 40, naziv: 'AI raziskovalec', priporocilo: 'AI diagnostika in 90-dnevni načrt',
    opis: 'AI v podjetju že uporabljate, vendar uporaba še ni sistemska. Posamezniki verjetno že dosegajo manjše prihranke, podjetje kot celota pa še nima jasnega načrta. Največ potenciala je v tem, da izberete en proces, določite cilj in preverite, ali AI ustvari merljiv učinek.' },
  { do: 60, naziv: 'AI uporabnik', priporocilo: 'Načrt uvajanja AI in pilotna uvedba v enem procesu',
    opis: 'Imate dobre osnove za uporabo AI. Naslednji korak ni več samo uporaba orodij, ampak vključitev AI v procese. Največji učinek boste dosegli tam, kjer se naloge ponavljajo, nastajajo stroški ali se izgubljajo prodajne priložnosti.' },
  { do: 80, naziv: 'AI pospeševalec', priporocilo: 'Uvedba AI in mesečna podpora',
    opis: 'Pri uporabi AI ste nad povprečjem. Smiselno je razmišljati o naprednejših pomočnikih, agentih in avtomatizacijah ter AI povezati z merljivimi kazalniki: prihranek časa, nižji stroški, hitrejši odziv ali rast prihodkov.' },
  { do: 100, naziv: 'AI-first kandidat', priporocilo: 'Strateški AI program in mesečna podpora',
    opis: 'Imate zelo dobro osnovo za sistemsko uporabo AI. Priložnost ni več v posameznih orodjih, ampak v načinu dela, kjer ima vsak oddelek svojega AI pomočnika, odločanje podpirajo podatki, procesi so avtomatizirani, znanje je urejeno in pravila uporabe so jasna.' },
];

// Recommended first project per strongest process (document, "Procesni signali").
export const PRIPOROCILO_PROCES = {
  nabava: 'AI agent za nabavo ali pilotni projekt v nabavi',
  prodaja: 'AI pomočnik za prodajo in pripravo ponudb',
  administracija: 'AI pomočnik za administracijo in interno znanje',
  vodstvo: 'AI pomočnik za direktorja',
  podpora: 'AI pomočnik za podporo strankam ali gostom',
  marketing: 'AI sistem za marketing in pripravo vsebin',
};
