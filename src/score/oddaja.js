// AI Business Score: server-side validation of a public submission, and the public
// (point-free) view of the question set for the browser.
//
// The browser never gets the point table: lead rules and financial points are internal.

import { VPRASANJA, VELIKOST } from './vprasanja-v1.js';

export const SCORE_SLUG = 'ai-business-score';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Question set without points, for GET /ai-business-score/vprasanja.json.
export function javnaVprasanja() {
  return {
    velikost: VELIKOST.map(({ id, text }) => ({ id, text })),
    vprasanja: VPRASANJA.map(q => ({
      id: q.id, tip: q.tip, max: q.max ?? null, text: q.text,
      moznosti: q.moznosti.map(o => ({ id: o.id, text: o.text, ...(o.nevtralno ? { nevtralno: true } : {}) })),
    })),
  };
}

// Returns { ok: true, kontakt, odgovori, marketing } or { ok: false, error, field }.
// `odgovori` contains only known question ids with valid option ids (normalised).
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
  if (!VELIKOST.some(v => v.id === kontakt.velikost)) return { ok: false, error: 'invalid_field', field: 'velikost' };

  const vhod = payload.odgovori && typeof payload.odgovori === 'object' ? payload.odgovori : {};
  const odgovori = {};
  for (const q of VPRASANJA) {
    const v = vhod[q.id];
    const ids = q.moznosti.map(o => o.id);
    if (q.tip === 'vec') {
      const arr = Array.isArray(v) ? [...new Set(v.map(String))] : [];
      if (!arr.length || arr.length > q.max || !arr.every(id => ids.includes(id))) {
        return { ok: false, error: 'invalid_answer', field: q.id };
      }
      odgovori[q.id] = arr;
    } else {
      if (typeof v !== 'string' || !ids.includes(v)) return { ok: false, error: 'invalid_answer', field: q.id };
      odgovori[q.id] = v;
    }
  }

  const marketing = payload.marketing_consent === true || payload.marketing_consent === 'on';
  return { ok: true, kontakt, odgovori, marketing };
}

// Human-readable answer text (for AI prompt and CSV), keyed by question id.
export function besedilaOdgovorov(odgovori) {
  const out = {};
  for (const q of VPRASANJA) {
    const v = odgovori?.[q.id];
    if (v === undefined) continue;
    const ids = Array.isArray(v) ? v : [v];
    out[q.id] = ids.map(id => q.moznosti.find(o => o.id === id)?.text).filter(Boolean).join('; ');
  }
  return out;
}
