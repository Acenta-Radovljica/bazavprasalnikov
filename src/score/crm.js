// AI Business Score -> monday CRM board Leads (Maja, 13. 10. 2026: every submission lands on
// Leads, Vir leada "Email marketing", Prodajalec Matjaž, the report link in the item's update).
//
// Sent to the Acenta OS receiver that already takes the acenta.si forms
// (os.deploy.acenta.si/api/hooks/web-lead), so one place holds the monday token and column ids;
// this app only knows the URL and the shared secret (env WEB_LEAD_URL, WEB_LEAD_SECRET).
// The receiver answers 200 with { ok:false } when monday fails, so `ok` decides, not the status.
// Pure apart from posljiLead(); the outbox (outbox.js) retries.

import { besedilaOdgovorov } from './oddaja.js';
import { VELIKOST, PODROCJE_NAZIV } from './vprasanja-v1.js';

const TIMEOUT_MS = 20_000;

export const imaCrm = () => !!(process.env.WEB_LEAD_URL && (process.env.WEB_LEAD_SECRET || '').length >= 16);

// Fields in the order the salesperson reads them. Keys are the labels shown in the update.
export function sestaviLead({ raw = {}, rezultat = {}, reportUrl, marketing }) {
  const b = besedilaOdgovorov(raw.odgovori || {});
  const velikost = VELIKOST.find(v => v.id === raw.velikost)?.text;
  const proces = rezultat.proces ? (PODROCJE_NAZIV[rezultat.proces.id] || rezultat.proces.naziv) : null;
  const polja = {
    name: [raw.ime, raw.priimek].filter(Boolean).join(' '),
    email: raw.email,
    telefon: raw.telefon,
    podjetje: raw.podjetje,
    'Velikost podjetja': velikost ? `${velikost} zaposlenih` : null,
    Panoga: b.panoga,
    Vloga: b.vloga,
    Rezultat: Number.isFinite(rezultat.skupno) ? `${rezultat.skupno} od 100, ${rezultat.stopnja?.naziv ?? ''}`.replace(/, $/, '') : null,
    'Razred leada': rezultat.lead?.razred ? `${rezultat.lead.razred}${rezultat.lead.razlogi?.length ? ` (${rezultat.lead.razlogi.join(', ')})` : ''}` : null,
    'Prvi projekt': proces,
    'Glavni cilj': b.cilj,
    'Kako hitro': b.hitrost,
    'Kaj bi pomagalo': b.pomoc,
    'Razlaga rezultata': b.interpretacija,
    'Novice in povabila': marketing ? 'da' : 'ne',
    'Poročilo': reportUrl,
  };
  return Object.fromEntries(Object.entries(polja).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}

// The receiver's URL with the source and the salesperson (fixed lists on the OS side).
export function crmUrl(base = process.env.WEB_LEAD_URL) {
  const u = new URL(base);
  u.search = new URLSearchParams({ src: 'AI Business Score', svc: 'AI', vir: 'email_marketing', prodajalec: 'matjaz' }).toString();
  return u.toString();
}

// -> { ok: true, itemId } | { ok: false, error, retry, config }  (`config`: wrong secret or URL,
// waits like a missing key instead of burning attempts)
export async function posljiLead(lead) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(crmUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WEB_LEAD_SECRET}` },
      body: JSON.stringify(lead),
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 404) return { ok: false, error: `http_${res.status}`, retry: true, config: true };
    if (!res.ok) return { ok: false, error: `http_${res.status}`, retry: true };
    const d = await res.json().catch(() => ({}));
    if (d.ok && d.itemId) return { ok: true, itemId: String(d.itemId) };
    // no_contact cannot get better on a retry; monday_failed / not_connected / rate_limited can.
    return { ok: false, error: d.error || 'neznan odgovor', retry: d.error !== 'no_contact' };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message, retry: true };
  } finally {
    clearTimeout(t);
  }
}
