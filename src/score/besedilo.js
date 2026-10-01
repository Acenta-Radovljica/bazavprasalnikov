// AI Business Score: AI-written report prose (Sonnet), strictly grounded in the computed result.
//
// v2 (1. 10. 2026, after Matjaž: "the report only repeats what I ticked, things repeat"):
// modelled on the ScoreApp/Panta Rei report: a 5–7 sentence diagnosis that CONNECTS the answers
// instead of listing them, and 5 + 5 + 5 distinct points (good / stuck / opportunities).
// The first project and the maturity steps are shown elsewhere in the report, so the model is
// told not to repeat them. Output is validated; anything that fails is discarded and the report
// keeps the deterministic template (predloga.js).

import { klicSonnet } from '../ai/claude.js';
import { PODROCJE_NAZIV, VPRASANJA } from './vprasanja-v1.js';

export const SYSTEM = `Si izkušen svetovalec za uvajanje umetne inteligence v mala in srednja podjetja pri agenciji Acenta.
Iz odgovorov na samooceno napišeš besedilo poročila, ki ga bo prebral direktor.

Kaj naredi poročilo dobro:
- Odgovorov NE naštevaj nazaj. Stanje opiši v največ enem stavku, ostali stavki razložijo, kaj ta
  kombinacija pomeni, kje je razkorak (na primer: AI uporabljajo posamezniki, pravil in odgovorne osebe
  pa ni) in kaj iz tega sledi za podjetje.
- Vsaka točka pove nekaj novega. Isto misel in isto področje omeniš največ enkrat v vsem besedilu.
- Konkretno za to podjetje, brez splošnih fraz.

Pravila:
- Slovenščina, vikanje, topel in stvaren ton. Brez žargona in anglicizmov.
- Opiraj se izključno na podane odgovore. O podjetju nič ne izmišljuj.
- Brez številk, odstotkov, zneskov in časovnih prihrankov.
- Ne obljubljaj rezultatov. Ne omenjaj drugih podjetij, oseb, izdelkov, cen ali Acentinih storitev.
- Ne primerjaj z drugimi podjetji, panogo ali povprečjem ("običajno za", "ne nenavadno za"): teh podatkov nimaš.
- Priporočeni prvi projekt (področje, ki je navedeno spodaj) in koraki za višjo AI zrelost (pravila,
  odgovorna oseba, izobraževanje) so že v drugem delu poročila. V "moznosti" ne predlagaj ničesar s
  področja prvega projekta in ne teh korakov: predlagaj priložnosti na DRUGIH opravilih iz odgovorov.

Vrni IZKLJUČNO veljaven JSON brez dodatnega besedila:
{"odstavek": "...", "dobro": ["..."], "zatika": ["..."], "moznosti": ["..."]}
- odstavek: 5 do 7 stavkov. Kje je podjetje danes in kaj iz odgovorov izstopa.
- dobro: natanko 5 alinej. Kaj podjetje že dela prav ali kaj je dobra osnova.
- zatika: natanko 5 alinej. Kje se ustavi in zakaj.
- moznosti: natanko 5 alinej. Katera opravila bi AI pri njih lahko prevzel ali podprl, kot predlog.
Vsaka alineja je en stavek, največ 22 besed.`;

const Q = Object.fromEntries(VPRASANJA.map(q => [q.id, q]));

export function sestaviVhod(rezultat, besedila, podjetje) {
  const d = rezultat.dimenzije;
  const raven = (v) => (v >= 67 ? 'visoka' : v >= 34 ? 'srednja' : 'nizka');
  return [
    `Podjetje: ${podjetje}`,
    `Stopnja AI zrelosti: ${rezultat.stopnja.naziv}`,
    `AI zrelost: ${raven(d.zrelost)}; potencial v procesih: ${raven(d.potencial)}; pripravljenost: ${raven(d.pripravljenost)}`,
    `Proces z največ priložnosti: ${rezultat.proces ? PODROCJE_NAZIV[rezultat.proces.id] : 'še ni jasen'}`,
    `Priporočeni prvi projekt (že v poročilu, ne ponavljaj): ${rezultat.proces ? rezultat.proces.priporocilo : rezultat.stopnja.priporocilo}`,
    '',
    'Vprašanja in odgovori:',
    ...Object.entries(besedila).map(([k, v]) => `- ${Q[k]?.text || k} ${v}`),
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

// Exported for tests. Returns the cleaned object or null.
export function preveriBesedilo(text, podjetje = '', vir = '') {
  if (typeof text !== 'string') return null;
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o;
  try { o = JSON.parse(text.slice(a, b + 1)); } catch { return null; }

  const ok = (s, max) => typeof s === 'string' && s.trim().length > 10 && s.length <= max;
  if (!ok(o.odstavek, 1400) || o.odstavek.length < 250) return null;
  const stavkov = (o.odstavek.match(/[.!?](\s|$)/g) || []).length;
  if (stavkov < 4 || stavkov > 8) return null;
  for (const k of ['dobro', 'zatika', 'moznosti']) {
    if (!Array.isArray(o[k]) || o[k].length < 4 || o[k].length > 5 || !o[k].every(s => ok(s, 240))) return null;
  }
  // No numbers, percentages or money unless the digits are in the company name or the answers.
  const dovoljeno = new Set(((podjetje + ' ' + vir).match(/\d+/g) || []));
  const vse = [o.odstavek, ...o.dobro, ...o.zatika, ...o.moznosti].join(' ');
  if (/[%€$]|\bEUR\b|evr/i.test(vse)) return null;
  if ((vse.match(/\d+/g) || []).some(n => !dovoljeno.has(n))) return null;
  // Comparisons with other companies would be invented: we have no benchmark data.
  if (/pogost[aoi]? (pri|med|v) podjetj|običajn[aoi]? (za|pri)|nenavadn[aoi]? za|v povprečju|kot večina|tipičn[aoi]? za/i.test(vse)) return null;
  // The same thought twice across the three lists = the repetition Matjaž complained about.
  const alineje = [...o.dobro, ...o.zatika, ...o.moznosti];
  for (let i = 0; i < alineje.length; i++) for (let j = i + 1; j < alineje.length; j++) if (podobno(alineje[i], alineje[j])) return null;

  const cisto = (arr) => arr.map(s => s.trim());
  return { odstavek: o.odstavek.trim(), dobro: cisto(o.dobro), zatika: cisto(o.zatika), moznosti: cisto(o.moznosti) };
}

export const imaAI = () => !!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('vstavi');

// Returns validated object or null (no key, API error, or invalid output).
export async function generirajBesedilo(rezultat, besedila, podjetje) {
  if (!imaAI()) return null;
  const vhod = sestaviVhod(rezultat, besedila, podjetje);
  const text = await klicSonnet({ system: SYSTEM, user: vhod, maxTokens: 1800 });
  return preveriBesedilo(text, podjetje, vhod);
}
