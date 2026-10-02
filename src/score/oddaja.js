// AI Business Score: server-side validation of a public submission, and the public
// (point-free) view of the question set for the browser.
//
// The browser never gets the point table: lead rules and financial points are internal.
// v2 (2. 10. 2026): the required questions depend on the answers (one follow-up block for the
// area picked at "one process in 90 days"); the same rule runs in the browser
// (public/score/razvejitev.js), so both sides always agree on what is required. A v1 submission
// (a tab opened before the v2 deploy) is still accepted and scored as v1.

import * as V1 from './vprasanja-v1.js';
import * as V2 from './vprasanja-v2.js';
import { javnaVprasanja, javnaPodrocjaV2 } from './javna.js';
import { vidnaVprasanja } from '../../public/score/razvejitev.js';

export { javnaVprasanja };
export const SCORE_SLUG = 'ai-business-score';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Validates the given questions; returns { odgovori } or { error, field } for the first bad one.
// Answers to questions not in `vprasanja` are dropped (e.g. another area's follow-up block).
function preveriOdgovore(vprasanja, vhod) {
  const odgovori = {};
  for (const q of vprasanja) {
    const v = vhod[q.id];
    const ids = q.moznosti.map(o => o.id);
    if (q.tip === 'vec') {
      const arr = Array.isArray(v) ? [...new Set(v.map(String))] : [];
      if (!arr.length || arr.length > q.max || !arr.every(id => ids.includes(id))) {
        return { error: 'invalid_answer', field: q.id };
      }
      odgovori[q.id] = arr;
    } else {
      if (typeof v !== 'string' || !ids.includes(v)) return { error: 'invalid_answer', field: q.id };
      odgovori[q.id] = v;
    }
  }
  return { odgovori };
}

// Returns { ok: true, kontakt, odgovori, marketing, verzija } or { ok: false, error, field }.
// `odgovori` contains only the questions the respondent was shown, with valid option ids.
export function validirajOddajo(payload = {}) {
  const kontakt = {
    ime: str(payload.ime, 80),
    priimek: str(payload.priimek, 80),
    email: str(payload.email, 160).toLowerCase(),
    telefon: str(payload.telefon, 40),
    podjetje: str(payload.podjetje, 160),
    velikost: str(payload.velikost, 10),
  };
  for (const f of ['ime', 'priimek', 'podjetje']) {
    if (!kontakt[f]) return { ok: false, error: 'missing_required_field', field: f };
  }
  if (!EMAIL_RE.test(kontakt.email)) return { ok: false, error: 'invalid_field', field: 'email' };
  if (kontakt.telefon.replace(/\D/g, '').length < 8) return { ok: false, error: 'invalid_field', field: 'telefon' };
  if (!V1.VELIKOST.some(v => v.id === kontakt.velikost)) return { ok: false, error: 'invalid_field', field: 'velikost' };

  const vhod = payload.odgovori && typeof payload.odgovori === 'object' ? payload.odgovori : {};
  const marketing = payload.marketing_consent === true || payload.marketing_consent === 'on';

  // v2: the visible set is decided by the public rule, the option ids by the full definitions.
  const vidni = new Set(vidnaVprasanja(javnaPodrocjaV2(), vhod, V1.PODROCJA).map(q => q.id));
  const r2 = preveriOdgovore(V2.VPRASANJA.filter(q => vidni.has(q.id)), vhod);
  if (r2.odgovori) return { ok: true, kontakt, odgovori: r2.odgovori, marketing, verzija: V2.SCORE_VERSION };

  // A page loaded before the v2 deploy sends the v1 set (it has v1's "potencial" list).
  if ('potencial' in vhod && !('proces90' in vhod)) {
    const r1 = preveriOdgovore(V1.VPRASANJA, vhod);
    if (r1.odgovori) return { ok: true, kontakt, odgovori: r1.odgovori, marketing, verzija: V1.SCORE_VERSION };
    return { ok: false, error: r1.error, field: r1.field };
  }
  return { ok: false, error: r2.error, field: r2.field };
}

// Every question either version can have, for answer texts (v2 order, then v1-only ones).
const VSA = [...V2.VPRASANJA, ...V1.VPRASANJA.filter(q => !V2.VPRASANJA.some(x => x.id === q.id))];
export const besediloVprasanja = Object.fromEntries(VSA.map(q => [q.id, q.text]));

// Human-readable answer text (for AI prompt and CSV), keyed by question id.
export function besedilaOdgovorov(odgovori) {
  const out = {};
  for (const q of VSA) {
    const v = odgovori?.[q.id];
    if (v === undefined) continue;
    const ids = Array.isArray(v) ? v : [v];
    out[q.id] = ids.map(id => q.moznosti.find(o => o.id === id)?.text).filter(Boolean).join('; ');
  }
  return out;
}
