// "Kako napredni so": the level of AI knowledge before the workshop.
//
// Computed without AI from the pre-workshop survey (slug pred-delavnico):
// four self-ratings from 1 (slabo) to 4 (zelo dobro), how often they use AI,
// and which tools they mention. The company page shows it on the card
// "Pregled pred delavnico"; the themes "Kaj jim vzame najvec casa" come from
// the server (src/ai/generate_pred_teme.js).
//
// A plain ES module without the DOM, so the tests load it directly.

export const RAVEN_SLUG = 'pred-delavnico';

// Question ids of the survey (sql/004_pred_delavnico.sql).
export const PODROCJA = [
  { id: 'q4_razumevanje', naziv: 'Razumevanje AI' },
  { id: 'q5_orodja_znanje', naziv: 'Poznavanje orodij' },
  { id: 'q6_prompti', naziv: 'Pisanje promptov' },
  { id: 'q7_omejitve', naziv: 'Tveganja in omejitve' },
];
const POGOSTOST_ID = 'q1_pogostost';
const ORODJA_ID = 'q13_orodja_poznana';

// The stored answer starts with the first word, the rest of the option text
// (»Pogosto (večkrat na teden)«) differs only in brackets and dashes.
export const POGOSTOST = [
  { zacetek: 'vsak dan', naziv: 'Vsak dan' },
  { zacetek: 'pogosto', naziv: 'Večkrat na teden' },
  { zacetek: 'občasno', naziv: 'Občasno' },
  { zacetek: 'redko', naziv: 'Redko' },
  { zacetek: 'nikoli', naziv: 'Nikoli' },
];

// Tools by the way people write them (»Chat GPT«, »Gimini«, »anthropic-claude«).
export const ORODJA = [
  { naziv: 'ChatGPT', vzorec: /chat\s*-?\s*gpt|\bgpt\b|openai/i },
  { naziv: 'Copilot', vzorec: /co-?\s?pilot/i },
  { naziv: 'Gemini', vzorec: /gemini|gimini|\bbard\b/i },
  { naziv: 'Claude', vzorec: /claude|anthropic/i },
  { naziv: 'DeepSeek', vzorec: /deep\s*seek/i },
  { naziv: 'Perplexity', vzorec: /perplexity/i },
  { naziv: 'Canva', vzorec: /canva/i },
  { naziv: 'CapCut', vzorec: /cap\s*cut/i },
  { naziv: 'DeepL', vzorec: /deep\s*l\b/i },
  { naziv: 'Midjourney', vzorec: /mid\s*journey/i },
  { naziv: 'Grammarly', vzorec: /grammarly/i },
  { naziv: 'Notion', vzorec: /notion/i },
];

// Level by the average shown on the page (rounded to one decimal), so the
// number and the label never disagree.
export const STOPNJE = [
  { od: 3.5, naziv: 'Napredna raven', ton: 'success' },
  { od: 3.0, naziv: 'Dobra raven', ton: 'info' },
  { od: 2.0, naziv: 'Osnovna raven', ton: 'warning' },
  { od: 0, naziv: 'Začetna raven', ton: 'danger' },
];

const zaokrozi = (x) => Math.round(x * 10) / 10;
export const decimalno = (x) => zaokrozi(x).toFixed(1).replace('.', ',');

function ocena(v) {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return n >= 1 && n <= 4 ? n : null;
}

// odgovori: rows of the company page ({ q_slug, raw_data }). Only the
// pre-workshop survey counts. Returns null when nobody rated themselves.
export function ravenZnanja(odgovori) {
  const vrstice = (odgovori || []).filter(o => o && o.q_slug === RAVEN_SLUG);
  const raw = vrstice.map(o => (o.raw_data && typeof o.raw_data === 'object' ? o.raw_data : {}));

  const vse = [];
  const podrocja = PODROCJA.map(p => {
    const vrednosti = raw.map(r => ocena(r[p.id])).filter(v => v !== null);
    vse.push(...vrednosti);
    return {
      id: p.id,
      naziv: p.naziv,
      st: vrednosti.length,
      povprecje: vrednosti.length ? zaokrozi(vrednosti.reduce((a, b) => a + b, 0) / vrednosti.length) : null,
    };
  });
  if (!vse.length) return null;

  const povprecje = zaokrozi(vse.reduce((a, b) => a + b, 0) / vse.length);
  const stopnja = STOPNJE.find(s => povprecje >= s.od);
  const ocenjena = podrocja.filter(p => p.povprecje !== null);
  const najnizje = Math.min(...ocenjena.map(p => p.povprecje));
  const najsibkejsa = ocenjena.length > 1 && ocenjena.some(p => p.povprecje > najnizje)
    ? ocenjena.filter(p => p.povprecje === najnizje).map(p => p.naziv)
    : [];

  const pogostost = POGOSTOST.map(p => ({
    naziv: p.naziv,
    st: raw.filter(r => String(r[POGOSTOST_ID] || '').trim().toLowerCase().startsWith(p.zacetek)).length,
  }));

  // One mention per person, however often the name repeats.
  const orodja = ORODJA
    .map(o => ({ naziv: o.naziv, st: raw.filter(r => o.vzorec.test(String(r[ORODJA_ID] || ''))).length }))
    .filter(o => o.st > 0)
    .sort((a, b) => b.st - a.st);

  return {
    udelezencev: vrstice.length,
    ocenilo: raw.filter(r => PODROCJA.some(p => ocena(r[p.id]) !== null)).length,
    povprecje,
    stopnja: stopnja.naziv,
    ton: stopnja.ton,
    podrocja,
    najsibkejsa,
    pogostost,
    orodja,
  };
}

// "Najšibkejše področje: tveganja in omejitve." with Slovenian dual/plural.
export function besediloNajsibkejsih(imena) {
  if (!imena?.length) return '';
  const mala = imena.map(i => i.charAt(0).toLowerCase() + i.slice(1));
  const seznam = mala.length > 1 ? `${mala.slice(0, -1).join(', ')} in ${mala.at(-1)}` : mala[0];
  const uvod = mala.length === 1 ? 'Najšibkejše področje' : mala.length === 2 ? 'Najšibkejši področji' : 'Najšibkejša področja';
  return `${uvod}: ${seznam}.`;
}
