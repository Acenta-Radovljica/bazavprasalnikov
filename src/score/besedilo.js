// AI Business Score: AI-written report prose (Sonnet), strictly grounded in the computed result.
//
// v2 (1. 10. 2026, after Matjaž: "the report only repeats what I ticked, things repeat"):
// modelled on the ScoreApp/Panta Rei report: a diagnosis that CONNECTS the answers instead of
// listing them, plus three lists (good / stuck / opportunities).
// v3 (1. 10. 2026, plan-abs-porocilo-v3): one topic, one place. The model is told what the rest
// of the report already says (level description, the maturity steps, the first project) and the
// validator rejects a topic that shows up in more than one place, an echo of the answers ("ste
// označili") and invented comparisons ("redka", "nad povprečjem"). A rejected draft gets one
// inline retry with the reason, so the report page (which waits up to 60 s) usually gets AI text.
// Anything that still fails is discarded and the report keeps the template (predloga.js).
// v4 (2. 10. 2026, questions v2): the follow-up block gives the model facts about one area, the
// goal of the first project and where AI is used today. Numbers derived from the answers (yearly
// hours, dejstva.js) are listed in the input, so they pass the number check; nothing else does.

import { klicSonnet, sdkVklopljen } from '../ai/claude.js';
import { PODROCJE_NAZIV } from './vprasanja-v1.js';
import { besediloVprasanja } from './oddaja.js';
import { POGLOBLJENI } from './vprasanja-v2.js';

export const SYSTEM = `Si izkušen svetovalec za uvajanje umetne inteligence v mala in srednja podjetja pri agenciji Acenta.
Iz odgovorov na samooceno napišeš besedilo poročila, ki ga bo prebral direktor.
Direktor svoje odgovore pozna. Ne pripoveduj mu jih nazaj: povej mu, kaj pomenijo.

Kaj naredi poročilo dobro:
- Odstavek je diagnoza. Prvi stavek pove, kje je podjetje danes. Ostali stavki povežejo odgovore:
  kje je razkorak, kaj iz kombinacije sledi za podjetje in kaj se zgodi, če se nič ne spremeni.
- Vsaka alineja pove posledico ali naslednji korak, ne samo stanja.
  Slabo: "Cene pri nabavi se ne preverjajo sistematično."
  Dobro: "Ko cen ne primerjate, podražitev dobavitelja opazite šele, ko je že plačana."
- Tudi "dobro" ni odgovor nazaj, ampak kaj prednost omogoča.
  Slabo: "Na povpraševanja odgovorite v 24 urah."
  Dobro: "Hiter odziv strankam je prednost, ki jo AI lahko obdrži tudi, ko povpraševanj naraste."
- Odstavek ne priporoča prvega projekta in se z njim ne konča: ta je v poročilu takoj spodaj.
- V odstavku ne naštevaj vseh opravil, kjer izgubijo čas ali denar: izpostavi največ dve, ki
  največ povesta. Ostala so snov za alineje.
- Če so med odgovori podrobnejša vprašanja o enem področju (koliko časa, kako pogosto, kako hitro),
  jih v odstavku uporabi kot dokaz za posledico. Številke iz vrstice "Izračunano iz odgovorov"
  smeš navesti, samih oznak iz navodil (na primer "Izračunano iz odgovorov") pa nikoli.
  Če AI uporabljajo za druga opravila kot tista, kjer izgubijo največ časa, to povej. Glavni cilj
  prve uvedbe AI pove, kaj podjetju največ pomeni.
- Piši brezhibno slovensko: sklanjatev, spol in ujemanje (na primer "največje ozko grlo"), cele
  povedi z glagolom. Preden odgovoriš, besedilo še enkrat preberi kot lektor.
- Ena tema, en prostor. Vsako temo (na primer pravila, odgovorna oseba, posamezniki brez skupnega
  načina, pripravljenost za korak, negotovost, kje začeti, odziv na povpraševanja, nabava) omeniš
  v vsem besedilu enkrat: ali v odstavku ali v eni alineji, nikoli na obeh mestih.
- Konkretno za to podjetje, brez splošnih fraz.

Pravila:
- Slovenščina, vikanje, topel in stvaren ton. Brez žargona in anglicizmov.
- Opiraj se izključno na podane odgovore. O podjetju nič ne izmišljuj.
- Številk ne izmišljuj: uporabiš lahko samo tiste iz odgovorov ali iz vrstice "Izračunano iz
  odgovorov". Brez odstotkov, zneskov in obljubljenih prihrankov.
- Ne obljubljaj rezultatov. Ne omenjaj drugih podjetij, oseb, izdelkov, cen ali Acentinih storitev.
- Ne primerjaj z drugimi podjetji, panogo ali povprečjem in ne ocenjuj, kako pogosto je kaj
  ("običajno za", "redka kombinacija", "nad povprečjem", "kot večina"): teh podatkov nimaš.
- Ne piši "ste označili", "ste navedli", "ste izbrali", "ste povedali", "ste izpostavili",
  "navajate", "priznavate", "po vaših podatkih", "kot ste odgovorili".
- Dejstvo iz odgovorov povej kot stanje podjetja, ne kot nekaj, kar je kdo odgovoril.
  Slabo: "Navajate, da ponudbe pripravljate ročno." / "Kot ste sami ugotovili, ponudbe nastajajo ročno."
  Dobro: "Ponudbe nastajajo ročno, zato vsaka nova vzame čas, ki bi ga lahko namenili stranki."
- Ne trdi ničesar, česar odgovori ne povedo (na primer da so dokumenti zbrani na enem mestu).
- V besedilu ne uporabljaj dvojnega narekovaja ("); če kaj navajaš, uporabi »«.
- Ne uporabljaj pomišljajev (– ali —): misli loči s piko ali vejico.
- Kar je navedeno pod "Že v poročilu", je v drugem delu poročila. Teme korakov za višjo AI zrelost
  ne omenjaj v "zatika" in "moznosti" (tam bi bile ponovitev koraka); v "dobro" jo smeš, če je
  prednost, ki jo podjetje že ima. Področja prvega projekta ne omenjaj v nobeni alineji; v
  odstavku ga smeš omeniti enkrat. V "moznosti" predlagaj priložnosti na DRUGIH opravilih iz odgovorov.

Vrni IZKLJUČNO veljaven JSON brez dodatnega besedila:
{"odstavek": "...", "dobro": ["..."], "zatika": ["..."], "moznosti": ["..."]}
- odstavek: 4 do 6 stavkov.
- dobro: natanko 6 alinej. Kaj podjetje že dela prav in kaj mu to omogoča.
- zatika: natanko 6 alinej. Kje se ustavi in kaj to podjetje stane.
- moznosti: natanko 6 alinej. Katera opravila bi AI pri njih lahko prevzel ali podprl, kot predlog.
Vsaka alineja je en stavek, največ 22 besed.`;

// `zeDrugje`: what other parts of the report already say, so the model does not repeat it, plus
// numbers computed from the answers that it may use.
//   { opisStopnje, vzvodi: [{ korak }], izracunano: ['...'] }
export function sestaviVhod(rezultat, besedila, podjetje, zeDrugje = {}) {
  const d = rezultat.dimenzije;
  const raven = (v) => (v >= 67 ? 'visoka' : v >= 34 ? 'srednja' : 'nizka');
  const proces = rezultat.proces;
  const ze = [
    `- Opis stopnje: ${zeDrugje.opisStopnje || rezultat.stopnja.opis || rezultat.stopnja.naziv}`,
    ...(zeDrugje.vzvodi?.length ? [`- Koraki za višjo AI zrelost: ${zeDrugje.vzvodi.map(v => v.korak).join(' ')}`] : []),
    `- Prvi projekt: ${proces ? `${PODROCJE_NAZIV[proces.id] || proces.naziv}. ${proces.priporocilo}` : rezultat.stopnja.priporocilo}`,
  ];
  const vzTeme = (zeDrugje.vzvodi || []).map(v => IME_TEME[TEMA_VZVODA[v.id]]).filter(Boolean);
  // v1 answers also have 5.1 and 6.1, but as common questions: only v2 (has 11.1) has a block.
  const blok = !('proces90' in besedila) ? null : Object.entries(POGLOBLJENI).map(([podrocje, ids]) => ({ podrocje, ids }))
    .find(b => b.ids.some(k => k in besedila)) || null;
  const podr = proces && (IME_PODROCJA[TEMA_PODROCJA[proces.id]] || IME_PODROCJA_OSTALA[proces.id]);
  const prepovedi = [
    ...(vzTeme.length ? [`- V "zatika" in "moznosti" ne omenjaj: ${vzTeme.join(', ')}.`] : []),
    ...(podr ? [`- V nobeni alineji ne omenjaj: ${podr}.`] : []),
  ];
  return [
    `Podjetje: ${podjetje}`,
    `Stopnja AI zrelosti: ${rezultat.stopnja.naziv}`,
    `AI zrelost: ${raven(d.zrelost)}; potencial v procesih: ${raven(d.potencial)}; pripravljenost: ${raven(d.pripravljenost)}`,
    `Proces z največ priložnosti: ${proces ? PODROCJE_NAZIV[proces.id] : 'še ni jasen'}`,
    '',
    'Že v poročilu (v alinejah ne ponavljaj, v odstavku največ enkrat):',
    ...ze,
    ...prepovedi,
    '',
    ...(zeDrugje.izracunano?.length ? ['Izračunano iz odgovorov:', ...zeDrugje.izracunano.map(x => `- ${x}`), ''] : []),
    'Vprašanja in odgovori:',
    ...Object.entries(besedila).filter(([k]) => !blok?.ids.includes(k)).map(([k, v]) => `- ${besediloVprasanja[k] || k} ${v}`),
    // v2: the follow-up block is marked, so the paragraph uses it as evidence (in the first test
    // reports it was often left out). Kept under "Vprašanja in odgovori" for the validator.
    ...(blok ? ['', `Podrobneje o področju »${PODROCJE_NAZIV[blok.podrocje]}« (dokazi za odstavek):`,
      ...blok.ids.filter(k => k in besedila).map(k => `- ${besediloVprasanja[k] || k} ${besedila[k]}`)] : []),
  ].join('\n');
}

// Word stems for a cheap "same thought twice" check (first 5 letters of words with 4+ letters).
const STOP = new Set(['vaše', 'vaši', 'vašem', 'vašega', 'lahko', 'zato', 'tudi', 'že', 'še', 'kjer', 'pri', 'ali', 'kot', 'ker', 'samo', 'bolj', 'naše']);
const koreni = (s) => new Set(s.toLowerCase().match(/[a-zčšž]{4,}/g)?.filter(w => !STOP.has(w)).map(w => w.slice(0, 5)) || []);
function podobno(a, b) {
  const x = koreni(a), y = koreni(b);
  if (!x.size || !y.size) return false;
  let skupaj = 0; for (const w of x) if (y.has(w)) skupaj++;
  return skupaj / Math.min(x.size, y.size) >= 0.7;
}

// Topics that must appear in one place only (paragraph OR one bullet). Stems, not words, so
// Slovenian cases match ("pravil", "pravila", "pravilih"), but only at the START of a word:
// "opravila" must not count as "pravila".
const naZacetku = (src) => new RegExp(`(?<![a-zčšž])(?:${src})`, 'i');
export const TEME = {
  pravila: naZacetku('pravil(?!n)|smernic|politik[aeiou] (uporabe|varn)'),
  oseba: naZacetku('odgovorn[a-zčšž]* oseb|zadolžen|skrbni[kc]'),
  izobrazevanje: naZacetku('izobraž|delavnic|usposablj'),
  posamezniki: naZacetku('posamezni|lastni presoji|vsak po svoje|brez skupnega'),
  pripravljenost: naZacetku('pripravljen|čim prej|ukrepati|hitr[a-zčšž]* (naslednji )?korak'),
  // v4: "you do not know where" in any wording is one topic (7 test reports, 2. 10.: four bullets in
  // a row said it four ways).
  kje_zaceti: naZacetku('kje (sploh )?začeti|negotovost|ne veste|ni (še )?jasno, (kje|kateri)|brez (jasne slike|vpogleda)'),
  odziv: naZacetku('povpraševanj'),
  nabava: naZacetku('nabav|dobavitelj'),
  zaloge: naZacetku('zalog'),
  // v4 (questions v2): the facts of the follow-up blocks and the "AI is used elsewhere" gap. Each
  // showed up in the paragraph AND again in a bullet in the first 7 test reports (2. 10.).
  ponudbe: naZacetku('ponudb'),
  informacije: naZacetku('kazalnik|informacij[a-zčšž]* za odloč|do (jasnih )?informacij'),
  vprasanja: naZacetku('ponavljajoč[a-zčšž]* (se )?vprašanj|ista vprašanj|pogost[a-zčšž]* vprašanj'),
  iskanje: naZacetku('iskanj[a-zčšž]* (informacij|navodil|dokument|odgovor)|baz[a-zčšž]* znanja|intern[a-zčšž]* znanj'),
  vsebine: naZacetku('vsebin'),
  // The time and cost answers: the paragraph listed them all and "zatika" repeated each one.
  porocila: naZacetku('poročil'),
  dokumenti: naZacetku('dokument'),
  sestanki: naZacetku('sestan'),
  podvajanje: naZacetku('podvaj'),
  podpora: naZacetku('podpor[a-zčšž]* (strank|gost)'),
  nacrtovanje: naZacetku('načrtovanj'),
  nekonsistentno: naZacetku('nekonsistent|neenot'),
  vrzel: naZacetku('ne (pa )?(še )?tam, kjer|ne (pa )?(še )?(za|pri|v) (procese|procesih|opravila|opravilih)|na (drugih )?opravilih(, ki niso| kot)|za druga opravila|drugje, kot'),
};
// The v4 topics guard paragraph <-> "dobro"/"zatika". Two proposals that both touch documents or
// offers are different solutions, not a repeat, so "moznosti" are not checked on them.
const SAMO_ODSTAVEK_SEZNAMI = new Set(['ponudbe', 'informacije', 'vprasanja', 'iskanje', 'vsebine',
  'porocila', 'dokumenti', 'sestanki', 'podvajanje', 'podpora', 'nacrtovanje', 'nekonsistentno']);
// Human names of the topics, for the explicit "do not mention" lines in the model input.
const IME_TEME = { pravila: 'pravila za uporabo AI', oseba: 'odgovorna oseba za AI', izobrazevanje: 'izobraževanje zaposlenih' };
const IME_PODROCJA = { nabava: 'nabava, dobavitelji in njihove cene', odziv: 'povpraševanja in odziv nanje' };
// Prompt-only names of the other first-project areas (the validator has no topic for them).
const IME_PODROCJA_OSTALA = {
  marketing: 'marketing in priprava vsebin',
  administracija: 'administracija in iskanje internih informacij',
  vodstvo: 'poročila in informacije za odločanje vodstva',
  podpora: 'podpora strankam in ponavljajoča se vprašanja',
};
// A maturity step shown in "Kako do višje ocene" -> its topic (kept out of the bullets).
const TEMA_VZVODA = { pravila: 'pravila', odgovorna_oseba: 'oseba', razumevanje: 'izobrazevanje' };
// First-project area -> topic (kept out of the bullets; the project card and closing own it).
const TEMA_PODROCJA = { nabava: 'nabava', prodaja: 'odziv' };

// v4: also the echo verbs the first v2 test reports used ("ste izpostavili", "navajate", ...).
const ODMEV = /\bste (označili|navedli|izbrali|povedali|odgovorili|izpostavili|opredelili|omenili|prepoznali)\b|\bkot ste\b|\b(navajate|priznavate)\b|po vaših (podatkih|besedah|odgovorih)/i;
const PRIMERJAVA = /pogost[aoi]? (pri|med|v) podjetj|med podjetj|običajn[aoi]? (za|pri)|nenavadn[aoi]? za|v povprečju|nad povprečj|pod povprečj|kot večina|tipičn[aoi]? za|\bredk[aoie]\w*|dragocen|izjemn|edinstven/i;

// Exported for tests. Returns { besedilo, izpusceno } or { razlog }.
// v3 repair, not reject (measured 1. 10.: rejecting the whole draft for one bad bullet sent 7 of 8
// test reports to the template): a bullet that repeats a topic, carries a number, an echo or an
// invented comparison is DROPPED; the draft is rejected only when the paragraph itself is bad or
// a list ends up too short. `izpusceno` lists what was dropped and why (logged by the worker).
// kontekst: { vzvodi: ['pravila', ...] (ids shown in "Kako do višje ocene"), procesId,
//   priporocilo, rezerva: { dobro, zatika, moznosti } (template lists for topping up) }
// v4: the model writes 6 per list and the first 5 that survive are kept. With the stricter topics
// (2. 10.) most rejections were "only 2 bullets left after dropping repeats"; one spare bullet per
// list keeps the first draft usable without letting a repeat through.
const MEJE = { dobro: [3, 5], zatika: [3, 5], moznosti: [4, 5] };
export function oceniBesedilo(text, podjetje = '', vir = '', kontekst = {}) {
  if (typeof text !== 'string') return { razlog: 'ni besedila' };
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return { razlog: 'odgovor ni JSON' };
  let o;
  try { o = JSON.parse(text.slice(a, b + 1)); } catch { return { razlog: 'odgovor ni veljaven JSON' }; }

  const ok = (s, max) => typeof s === 'string' && s.trim().length > 10 && s.length <= max;
  if (!ok(o.odstavek, 1400) || o.odstavek.length < 200) return { razlog: 'odstavek je prekratek ali predolg' };
  const stavkov = (o.odstavek.match(/[.!?](\s|$)/g) || []).length;
  if (stavkov < 4 || stavkov > 7) return { razlog: `odstavek ima ${stavkov} stavkov, mora jih imeti 4 do 6` };
  for (const k of Object.keys(MEJE)) if (!Array.isArray(o[k])) return { razlog: `manjka seznam "${k}"` };

  // No numbers, percentages or money unless the digits are in the company name or the answers.
  const dovoljeno = new Set(((podjetje + ' ' + vir).match(/\d+/g) || []));
  const odgovori = (vir.split('Vprašanja in odgovori:')[1] ?? vir).toLowerCase();
  // Returns why a sentence may not stand, or null.
  const napaka = (s) => {
    if (/[%€$]|\bEUR\b|evr/i.test(s)) return 'odstotki ali zneski';
    // Labels of the model input must never reach the customer (seen 2. 10.: a paragraph quoting
    // "Izračunano iz odgovorov: ...").
    if (/izračunano iz odgovor|podrobneje o področju|že v poročilu|vprašanja in odgovori/i.test(s)) return 'notranja oznaka iz navodil';
    if ((s.match(/\d+/g) || []).some(n => !dovoljeno.has(n))) return 'številke';
    // Comparisons and rarity claims would be invented: we have no benchmark data. A word that is
    // part of the answers themselves (e.g. an option "redko") is allowed.
    const prim = s.match(new RegExp(PRIMERJAVA.source, 'gi'))?.find(m => !odgovori.includes(m.toLowerCase()));
    if (prim) return `primerjava brez podatkov ("${prim}")`;
    if (ODMEV.test(s)) return `odmev odgovorov ("${s.match(ODMEV)[0]}")`;
    return null;
  };
  // The recommended first project is in the project card right below: never in the text.
  const prip = String(kontekst.priporocilo || '').toLowerCase().slice(0, 28);
  const napakaPrip = (x) => (prip.length > 10 && x.toLowerCase().includes(prip) ? 'ponovi priporočeni prvi projekt' : null);
  const nOd = napaka(o.odstavek) || napakaPrip(o.odstavek);
  if (nOd) return { razlog: `odstavek: ${nOd}; povej, kaj odgovori pomenijo` };

  // One topic, one place. The paragraph claims its topics first, then "dobro" and "zatika" in
  // reading order. "moznosti" are proposals: one that solves a problem named above is not a
  // repetition, so they are only checked against each other (and against the bans below).
  const zasedeno = new Map(Object.entries(TEME).filter(([, re]) => re.test(o.odstavek)).map(([t]) => [t, 'odstavek']));
  const zasedenoM = new Map(), vsiM = [];
  // A lever topic repeats the step as a problem or an opportunity; as a strength the company
  // already has ("dobro") it is progress, not repetition. The first-project area is owned by the
  // project card: no bullet at all.
  const vzvodTeme = new Set((kontekst.vzvodi || []).map(id => TEMA_VZVODA[id]).filter(Boolean));
  const podrocje = TEMA_PODROCJA[kontekst.procesId];
  const izpusceno = [], dopolnjeno = [], ostane = { dobro: [], zatika: [], moznosti: [] }, vsi = [];
  // Takes the bullet into list k, or returns why it may not stand.
  const sprejmi = (k, s, mesto) => {
    const [zas, kup] = k === 'moznosti' ? [zasedenoM, vsiM] : [zasedeno, vsi];
    if (!ok(s, 240)) return 'prazna ali predolga';
    const n = napaka(s) || napakaPrip(s);
    if (n) return n;
    const teme = Object.entries(TEME).filter(([t, re]) => re.test(s) && !(k === 'moznosti' && SAMO_ODSTAVEK_SEZNAMI.has(t))).map(([t]) => t);
    const prep = teme.find(t => t === podrocje || (k !== 'dobro' && vzvodTeme.has(t)));
    if (prep) return `tema "${prep}" je že drugje v poročilu`;
    const dvojna = teme.find(t => zas.has(t));
    if (dvojna) return `tema "${dvojna}" že v ${zas.get(dvojna)}`;
    const podoben = kup.find(x => podobno(x, s));
    if (podoben) return `ista misel kot "${podoben}"`;
    teme.forEach(t => zas.set(t, mesto));
    kup.push(s);
    ostane[k].push(s.trim());
    return null;
  };
  for (const k of Object.keys(MEJE)) {
    o[k].forEach((s, i) => { const r = sprejmi(k, s, `${k} ${i + 1}`); if (r) izpusceno.push(`${k} ${i + 1}: ${r}`); });
  }
  // v4: a list left too short after dropping repeats is topped up from the template's own list
  // (kontekst.rezerva), bullet by bullet under the same checks, only up to the minimum. Measured
  // 2. 10.: without it 4 of 7 first drafts were rejected for "only 2 left", and the retry pushed
  // the report past the page's 90 s wait.
  for (const [k, [min]] of Object.entries(MEJE)) {
    for (const s of kontekst.rezerva?.[k] || []) {
      if (ostane[k].length >= min) break;
      if (!sprejmi(k, s, `${k} (predloga)`)) dopolnjeno.push(`${k}: ${s.slice(0, 40)}…`);
    }
  }
  for (const [k, [min, max]] of Object.entries(MEJE)) {
    ostane[k] = ostane[k].slice(0, max);
    if (ostane[k].length < min) {
      return { razlog: `v "${k}" ostane le ${ostane[k].length} uporabnih alinej (${izpusceno.filter(x => x.startsWith(k)).join('; ') || 'premalo alinej'})` };
    }
  }
  return { besedilo: { odstavek: o.odstavek.trim(), ...ostane }, izpusceno, dopolnjeno };
}

// Kept for callers and tests: the cleaned object or null.
export function preveriBesedilo(text, podjetje = '', vir = '', kontekst = {}) {
  return oceniBesedilo(text, podjetje, vir, kontekst).besedilo || null;
}

// AI is available through the subscription (CLAUDE_SDK=1, Agent SDK) or the metered API key.
export const imaAI = () => sdkVklopljen() || (!!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('vstavi'));

const POSKUSOV = 2;   // inline: first draft + one retry with the rejection reason

// Returns { besedilo, poskusov, razlogi, izpusceno, sekund } (besedilo null when no key, API
// error or invalid output). Default (medium) effort: 'low' was ~5 s faster but made grammar
// slips in 2 of 3 test reports (1. 10. 2026); the page waits up to 90 s.
export async function generirajBesedilo(rezultat, besedila, podjetje, zeDrugje = {}) {
  if (!imaAI()) return { besedilo: null, poskusov: 0, razlogi: ['ni ključa'] };
  const vhod = sestaviVhod(rezultat, besedila, podjetje, zeDrugje);
  const kontekst = { vzvodi: (zeDrugje.vzvodi || []).map(v => v.id), procesId: rezultat.proces?.id,
    priporocilo: rezultat.proces?.priporocilo || rezultat.stopnja.priporocilo, rezerva: zeDrugje.rezerva };
  const razlogi = [], t0 = Date.now();
  const sekund = () => Math.round((Date.now() - t0) / 100) / 10;
  for (let i = 1; i <= POSKUSOV; i++) {
    const user = razlogi.length
      ? `${vhod}\n\nPrejšnji osnutek je bil zavrnjen: ${razlogi.at(-1)}. Napiši celotno besedilo znova in to popravi.`
      : vhod;
    const text = await klicSonnet({ system: SYSTEM, user, maxTokens: 1600 });
    const r = oceniBesedilo(text, podjetje, vhod, kontekst);
    if (r.besedilo) return { besedilo: r.besedilo, poskusov: i, razlogi, izpusceno: r.izpusceno, dopolnjeno: r.dopolnjeno, sekund: sekund() };
    razlogi.push(r.razlog);
  }
  return { besedilo: null, poskusov: POSKUSOV, razlogi, izpusceno: [], sekund: sekund() };
}
