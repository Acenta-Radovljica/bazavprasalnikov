// AI Business Score: AI-written report prose (Haiku), strictly grounded in the computed result.
//
// Only the paragraph and the "good / stuck" lists are AI. Recommendations stay deterministic
// (predloga.js), so the model cannot promise a product or a result. Output is validated;
// anything that fails validation is discarded and the report keeps the template text.

import { klicHaiku } from '../ai/claude.js';
import { PODROCJE_NAZIV } from './vprasanja-v1.js';

const SYSTEM = `Si svetovalec za uporabo umetne inteligence v podjetjih pri agenciji Acenta.
Iz rezultatov samoocene napišeš kratko, konkretno besedilo za poročilo direktorju.

Pravila:
- Slovenščina, vikanje, topel in stvaren ton. Brez tehničnega žargona in anglicizmov.
- Opiraj se IZKLJUČNO na podane odgovore in rezultate. Nič ne izmišljuj.
- NE navajaj nobenih številk, odstotkov, zneskov ali časovnih prihrankov.
- NE obljubljaj rezultatov. NE omenjaj drugih podjetij, strank ali imen.
- NE priporočaj izdelkov ali storitev (to je v drugem delu poročila).

Vrni IZKLJUČNO veljaven JSON brez dodatnega besedila:
{"odstavek": "3–4 stavki", "dobro": ["...", "...", "..."], "zatika": ["...", "...", "..."]}
Vsaka alineja je en stavek, največ 20 besed.`;

function sestaviVhod(rezultat, besedila, podjetje) {
  const d = rezultat.dimenzije;
  const raven = (v) => (v >= 67 ? 'visoka' : v >= 34 ? 'srednja' : 'nizka');
  return [
    `Podjetje: ${podjetje}`,
    `Stopnja AI zrelosti: ${rezultat.stopnja.naziv}`,
    `AI zrelost: ${raven(d.zrelost)}; potencial v procesih: ${raven(d.potencial)}; pripravljenost: ${raven(d.pripravljenost)}`,
    `Proces z največ priložnosti: ${rezultat.proces ? PODROCJE_NAZIV[rezultat.proces.id] : 'še ni jasen'}`,
    '',
    'Odgovori:',
    ...Object.entries(besedila).map(([k, v]) => `- ${k}: ${v}`),
  ].join('\n');
}

// Exported for tests. Returns the cleaned object or null.
export function preveriBesedilo(text, podjetje = '') {
  if (typeof text !== 'string') return null;
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o;
  try { o = JSON.parse(text.slice(a, b + 1)); } catch { return null; }

  const ok = (s, max) => typeof s === 'string' && s.trim().length > 10 && s.length <= max;
  if (!ok(o.odstavek, 900)) return null;
  for (const k of ['dobro', 'zatika']) {
    if (!Array.isArray(o[k]) || o[k].length < 1 || o[k].length > 3 || !o[k].every(s => ok(s, 220))) return null;
  }
  // No numbers, percentages or money unless the digits are part of the company name.
  const dovoljeno = new Set((podjetje.match(/\d+/g) || []));
  const vse = [o.odstavek, ...o.dobro, ...o.zatika].join(' ');
  if (/[%€$]|\bEUR\b|evr/i.test(vse)) return null;
  if ((vse.match(/\d+/g) || []).some(n => !dovoljeno.has(n))) return null;

  return { odstavek: o.odstavek.trim(), dobro: o.dobro.map(s => s.trim()), zatika: o.zatika.map(s => s.trim()) };
}

export const imaAI = () => !!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('vstavi');

// Returns validated object or null (no key, API error, or invalid output).
export async function generirajBesedilo(rezultat, besedila, podjetje) {
  if (!imaAI()) return null;
  const text = await klicHaiku({ system: SYSTEM, user: sestaviVhod(rezultat, besedila, podjetje), maxTokens: 700 });
  return preveriBesedilo(text, podjetje);
}
