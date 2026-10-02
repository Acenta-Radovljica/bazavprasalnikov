// AI Business Score: the public (point-free) view of a question set, for the browser and for
// the branching rule (public/score/razvejitev.js), which reads exactly this shape on both sides.
//
// The browser never gets points, lead rules or financial weights. For v2 it does get which area
// a question or answer belongs to: the quiz needs it to show the right follow-up block, and it
// says nothing about scoring.

import * as V1 from './vprasanja-v1.js';
import * as V2 from './vprasanja-v2.js';

const SIGNAL_V_JAVNO = new Set(['izguba_casa', 'stroski']);   // fallback when 11.1 names no area

function javnoVprasanje(q, v2) {
  return {
    id: q.id, tip: q.tip, max: q.max ?? null, text: q.text,
    ...(v2 && q.podrocje ? { podrocje: q.podrocje } : {}),
    moznosti: q.moznosti.map(o => {
      const podrocje = !v2 ? null : q.id === 'proces90' ? o.podrocje : SIGNAL_V_JAVNO.has(q.id) ? o.sig : null;
      return { id: o.id, text: o.text, ...(o.nevtralno ? { nevtralno: true } : {}), ...(podrocje ? { podrocje } : {}) };
    }),
  };
}

const V2_JAVNO = V2.VPRASANJA.map(q => javnoVprasanje(q, true));
const V1_JAVNO = V1.VPRASANJA.map(q => javnoVprasanje(q, false));

// The v2 public questions (shared, do not mutate).
export const javnaPodrocjaV2 = () => V2_JAVNO;

// GET /ai-business-score/vprasanja.json
export function javnaVprasanja(verzija = V2.SCORE_VERSION) {
  const v2 = verzija === V2.SCORE_VERSION;
  return {
    verzija: v2 ? V2.SCORE_VERSION : V1.SCORE_VERSION,
    velikost: V1.VELIKOST.map(({ id, text }) => ({ id, text })),
    vprasanja: v2 ? V2_JAVNO : V1_JAVNO,
    // Branching tie-break order and the area names for the progress bar (v2 only).
    ...(v2 ? { podrocja: V1.PODROCJA, podrocjeNaziv: V1.PODROCJE_NAZIV } : {}),
  };
}
