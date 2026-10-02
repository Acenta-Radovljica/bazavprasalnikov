// AI Business Score: pure, deterministic scoring. No I/O, no AI.
//
// Input: answers keyed by question id (single choice = option id string, multi = array of ids),
// plus `velikost` from the contact step, and the score version the answers belong to. Unknown or
// missing answers score 0 and never throw. Output is stored as-is in score_results.rezultat
// together with the version.
//
// v1 (29. 9.) and v2 (2. 10., questions from Matjaž's Word with one follow-up block per area)
// share maturity, financial potential, the level ladder and the lead rules; they differ in how
// process potential, readiness and the strongest area are counted. Old rows keep being scored
// (and their levers recomputed) with the version they were submitted under.

import * as V1 from './vprasanja-v1.js';
import * as V2 from './vprasanja-v2.js';
import { izbranoPodrocje } from '../../public/score/razvejitev.js';
import { javnaPodrocjaV2 } from './javna.js';

// Weights from the scoring document.
export const UTEZI = { zrelost: 0.25, potencial: 0.35, pripravljenost: 0.25, financni: 0.15 };
export const TRENUTNA_VERZIJA = V2.SCORE_VERSION;

const { VELIKOST, STOPNJE, PODROCJA, PODROCJE_NAZIV, PRIPOROCILO_PROCES } = V1;
const Q1 = Object.fromEntries(V1.VPRASANJA.map(q => [q.id, q]));
const Q2 = Object.fromEntries(V2.VPRASANJA.map(q => [q.id, q]));

// Selected option objects for a question, respecting the multi-select cap.
function izbrane(Q, odgovori, qid) {
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

const pct = (dobil, max) => (max > 0 ? Math.round((Math.min(dobil, max) / max) * 100) : 0);

// Maturity: five 0–4 questions (same ids and points in v1 and v2).
const ZRE = ['uporaba', 'sistematicnost', 'odgovorna_oseba', 'razumevanje', 'pravila'];

// ── v1: three "where does it hurt" lists + response time + purchase prices for everyone ──
function delniV1(odgovori) {
  const eno = (qid) => izbrane(Q1, odgovori, qid)[0] || null;
  const signali = Object.fromEntries(PODROCJA.map(p => [p, 0]));
  for (const id of ['izguba_casa', 'stroski', 'potencial', 'odziv', 'nabavne_cene', 'pomoc']) {
    for (const o of izbrane(Q1, odgovori, id)) if (o.sig) signali[o.sig]++;
  }
  // Process potential: pain selections (max 3 per multi question) + two 0–4 diagnostics.
  const MULTI = ['izguba_casa', 'stroski', 'potencial'];
  const bolecine = MULTI.reduce((s, id) => s + izbrane(Q1, odgovori, id).filter(o => !o.nevtralno).length, 0);
  const potTock = bolecine + (eno('odziv')?.pot ?? 0) + (eno('nabavne_cene')?.pot ?? 0);
  const potencial = pct(potTock, MULTI.length * 3 + 8);
  // Readiness: three 0–4 questions.
  const PRIP = ['hitrost', 'pomoc', 'interpretacija'];
  const pripravljenost = pct(PRIP.reduce((s, id) => s + (eno(id)?.prip ?? 0), 0), PRIP.length * 4);
  const akcija = !!eno('hitrost')?.akcija || !!eno('interpretacija')?.akcija;
  return { eno, signali, potencial, pripravljenost, akcija };
}

// ── v2: time + cost lists, then the follow-up block of the chosen area ──
// Multi-select diagnostic (admin tasks): how many tasks are named -> 0–4.
const VEC_V_TOCKE = [0, 2, 3, 4];
function delniV2(odgovori) {
  const eno = (qid) => izbrane(Q2, odgovori, qid)[0] || null;
  const signali = Object.fromEntries(PODROCJA.map(p => [p, 0]));
  const podrocje = izbranoPodrocje(javnaPodrocjaV2(), odgovori, PODROCJA);
  const sklop = podrocje ? V2.POGLOBLJENI[podrocje].map(id => Q2[id]) : [];

  for (const id of ['izguba_casa', 'stroski', 'pomoc']) {
    for (const o of izbrane(Q2, odgovori, id)) if (o.sig) signali[o.sig]++;
  }
  // The area named for the next 90 days is the clearest signal the respondent gives.
  const izbira = eno('proces90');
  if (izbira?.podrocje) signali[izbira.podrocje] += 2;

  // Process potential: pain selections from time + cost (max 6) + the block's two diagnostics.
  const bolecine = ['izguba_casa', 'stroski'].reduce((s, id) => s + izbrane(Q2, odgovori, id).filter(o => !o.nevtralno).length, 0);
  let potTock = bolecine, potMax = 6;
  let prip = ['hitrost', 'pomoc', 'interpretacija'].reduce((s, id) => s + (eno(id)?.prip ?? 0), 0), pripMax = 12;
  let akcija = !!eno('hitrost')?.akcija || !!eno('interpretacija')?.akcija;
  for (const q of sklop) {
    const izb = izbrane(Q2, odgovori, q.id);
    if (q.del === 'interes') {
      const o = izb[0];
      prip += o?.prip ?? 0; pripMax += 4;
      if ((o?.prip ?? 0) >= 2) signali[q.podrocje]++;
      if (o?.akcija) akcija = true;
      continue;
    }
    potMax += 4;
    if (q.tip === 'vec') {
      const n = izb.filter(o => o.sig).length;
      potTock += VEC_V_TOCKE[Math.min(n, 3)];
      if (n) signali[q.podrocje]++;
    } else {
      potTock += izb[0]?.pot ?? 0;
      if (izb[0]?.sig) signali[izb[0].sig]++;
    }
  }
  return {
    eno, signali, akcija,
    potencial: pct(potTock, potMax),
    pripravljenost: pct(prip, pripMax),
    // The area named for the next 90 days IS the first project (approved plan, 2. 10.): the
    // follow-up block was about it, so the project card and the facts talk about the same area.
    izbrano: izbira?.podrocje || null,
  };
}

export function izracunajScore(odgovori = {}, verzija = 'v1') {
  const v2 = verzija === 'v2';
  const { eno, signali, potencial, pripravljenost, akcija, izbrano } = v2 ? delniV2(odgovori) : delniV1(odgovori);
  const velikost = VELIKOST.find(v => v.id === String(odgovori.velikost ?? '')) || null;

  const zreTock = ZRE.reduce((s, id) => s + (eno(id)?.zre ?? 0), 0);
  const zrelost = pct(zreTock, ZRE.length * 4);

  // Financial potential: size, industry, role, breadth of pain, timing.
  const podrocjaZBolecino = PODROCJA.filter(p => signali[p] > 0).length;
  const finTock = (velikost?.fin ?? 0)
    + (eno('panoga')?.fin ?? 0)
    + (eno('vloga')?.fin ?? 0)
    + Math.min(podrocjaZBolecino, 4)
    + (eno('hitrost')?.fin ?? 0);
  const financni = pct(finTock, 4 + 2 + 2 + 4 + 2);

  const skupno = Math.round(
    zrelost * UTEZI.zrelost + potencial * UTEZI.potencial
    + pripravljenost * UTEZI.pripravljenost + financni * UTEZI.financni,
  );
  // Level describes AI maturity (document: ranges listed under "AI zrelost"), not the total:
  // a low-maturity company with big pain must not be told it is "above average".
  const stopnja = STOPNJE.find(s => zrelost <= s.do);

  // Strongest process: the area picked for the next 90 days (v2), otherwise most signals, ties
  // broken by PODROCJA order.
  const naj = izbrano || PODROCJA.reduce((best, p) => (signali[p] > (best ? signali[best] : 0) ? p : best), null);

  // Lead class (document "Interna prodajna klasifikacija leadov").
  const odlocevalec = !!eno('vloga')?.odlocevalec;
  const vsaj6 = !!velikost && velikost.id !== '1-5';
  const imaSignal = podrocjaZBolecino > 0;
  const samoRaziskuje = eno('hitrost')?.id === 'raziskujemo';
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
    score_version: v2 ? V2.SCORE_VERSION : V1.SCORE_VERSION,
    skupno,
    dimenzije: { zrelost, potencial, pripravljenost, financni },
    stopnja: { naziv: stopnja.naziv, opis: stopnja.opis, priporocilo: stopnja.priporocilo },
    proces: naj ? { id: naj, naziv: PODROCJE_NAZIV[naj], priporocilo: PRIPOROCILO_PROCES[naj] } : null,
    signali,
    lead: { razred: lead, razlogi },
    ovira: eno('ovira')?.text ?? null,
  };
}
