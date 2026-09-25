// AI Business Score: pure, deterministic scoring. No I/O, no AI.
//
// Input: answers keyed by question id (single choice = option id string, multi = array of ids),
// plus `velikost` from the contact step. Unknown or missing answers score 0 and never throw.
// Output is stored as-is in score_results.rezultat together with SCORE_VERSION.

import {
  SCORE_VERSION, VPRASANJA, VELIKOST, STOPNJE, PODROCJA, PODROCJE_NAZIV, PRIPOROCILO_PROCES,
} from './vprasanja-v1.js';

// Weights from the scoring document.
export const UTEZI = { zrelost: 0.25, potencial: 0.35, pripravljenost: 0.25, financni: 0.15 };

const Q = Object.fromEntries(VPRASANJA.map(q => [q.id, q]));

// Selected option objects for a question, respecting the multi-select cap.
function izbrane(odgovori, qid) {
  const q = Q[qid];
  const v = odgovori?.[qid];
  if (!q || v === undefined || v === null || v === '') return [];
  const ids = Array.isArray(v) ? v : [v];
  const cap = q.tip === 'vec' ? (q.max || ids.length) : 1;
  const out = [];
  for (const id of ids) {
    const o = q.moznosti.find(m => m.id === String(id));
    if (o && !out.includes(o)) out.push(o);
    if (out.length >= cap) break;
  }
  return out;
}

const eno = (odgovori, qid) => izbrane(odgovori, qid)[0] || null;
const pct = (dobil, max) => (max > 0 ? Math.round((Math.min(dobil, max) / max) * 100) : 0);

export function izracunajScore(odgovori = {}) {
  const velikost = VELIKOST.find(v => v.id === String(odgovori.velikost ?? '')) || null;

  // Maturity: five 0–4 questions.
  const ZRE = ['uporaba', 'sistematicnost', 'odgovorna_oseba', 'razumevanje', 'pravila'];
  const zreTock = ZRE.reduce((s, id) => s + (eno(odgovori, id)?.zre ?? 0), 0);
  const zrelost = pct(zreTock, ZRE.length * 4);

  // Process signals per area.
  const signali = Object.fromEntries(PODROCJA.map(p => [p, 0]));
  const SIG_Q = ['izguba_casa', 'stroski', 'potencial', 'odziv', 'nabavne_cene', 'pomoc'];
  for (const id of SIG_Q) for (const o of izbrane(odgovori, id)) if (o.sig) signali[o.sig]++;

  // Process potential: pain selections (max 3 per multi question) + two 0–4 diagnostics.
  const MULTI = ['izguba_casa', 'stroski', 'potencial'];
  const bolecine = MULTI.reduce((s, id) => s + izbrane(odgovori, id).filter(o => !o.nevtralno).length, 0);
  const potTock = bolecine + (eno(odgovori, 'odziv')?.pot ?? 0) + (eno(odgovori, 'nabavne_cene')?.pot ?? 0);
  const potencial = pct(potTock, MULTI.length * 3 + 8);

  // Readiness: three 0–4 questions.
  const PRIP = ['hitrost', 'pomoc', 'interpretacija'];
  const pripTock = PRIP.reduce((s, id) => s + (eno(odgovori, id)?.prip ?? 0), 0);
  const pripravljenost = pct(pripTock, PRIP.length * 4);

  // Financial potential: size, industry, role, breadth of pain, timing.
  const podrocjaZBolecino = PODROCJA.filter(p => signali[p] > 0).length;
  const finTock = (velikost?.fin ?? 0)
    + (eno(odgovori, 'panoga')?.fin ?? 0)
    + (eno(odgovori, 'vloga')?.fin ?? 0)
    + Math.min(podrocjaZBolecino, 4)
    + (eno(odgovori, 'hitrost')?.fin ?? 0);
  const financni = pct(finTock, 4 + 2 + 2 + 4 + 2);

  const skupno = Math.round(
    zrelost * UTEZI.zrelost + potencial * UTEZI.potencial
    + pripravljenost * UTEZI.pripravljenost + financni * UTEZI.financni,
  );
  // Level describes AI maturity (document: ranges listed under "AI zrelost"), not the total:
  // a low-maturity company with big pain must not be told it is "above average".
  const stopnja = STOPNJE.find(s => zrelost <= s.do);

  // Strongest process: most signals, ties broken by PODROCJA order.
  const naj = PODROCJA.reduce((best, p) => (signali[p] > (best ? signali[best] : 0) ? p : best), null);

  // Lead class (document "Interna prodajna klasifikacija leadov").
  const odlocevalec = !!eno(odgovori, 'vloga')?.odlocevalec;
  const vsaj6 = !!velikost && velikost.id !== '1-5';
  const imaSignal = podrocjaZBolecino > 0;
  const akcija = !!eno(odgovori, 'hitrost')?.akcija || !!eno(odgovori, 'interpretacija')?.akcija;
  const samoRaziskuje = eno(odgovori, 'hitrost')?.id === 'raziskujemo';
  // Document: A needs "visok potencial v nabavi, prodaji, administraciji ali vodstvu".
  const kljucniProces = ['nabava', 'prodaja', 'administracija', 'vodstvo'].includes(naj);
  let lead = 'B';
  const razlogi = [];
  if (odlocevalec && vsaj6 && kljucniProces && akcija) {
    lead = 'A';
    razlogi.push('odločevalec', 'podjetje 6+ zaposlenih', `bolečina: ${PODROCJE_NAZIV[naj]}`, 'želi ukrepati ali pogovor');
  } else if (samoRaziskuje && (!odlocevalec || (!vsaj6 && !imaSignal))) {
    lead = 'C';
    razlogi.push('samo raziskuje', odlocevalec ? 'majhno podjetje brez jasne bolečine' : 'ni odločevalec');
  } else {
    if (!odlocevalec) razlogi.push('ni odločevalec');
    if (!vsaj6) razlogi.push('1–5 zaposlenih');
    if (!imaSignal) razlogi.push('ni jasne procesne bolečine');
    else if (!kljucniProces) razlogi.push(`največji potencial je ${PODROCJE_NAZIV[naj].toLowerCase()}, ne nabava, prodaja, administracija ali vodstvo`);
    if (!akcija) razlogi.push('ni izražene nujnosti');
  }

  return {
    score_version: SCORE_VERSION,
    skupno,
    dimenzije: { zrelost, potencial, pripravljenost, financni },
    stopnja: { naziv: stopnja.naziv, opis: stopnja.opis, priporocilo: stopnja.priporocilo },
    proces: naj ? { id: naj, naziv: PODROCJE_NAZIV[naj], priporocilo: PRIPOROCILO_PROCES[naj] } : null,
    signali,
    lead: { razred: lead, razlogi },
    ovira: eno(odgovori, 'ovira')?.text ?? null,
  };
}
