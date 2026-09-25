// AI Business Score -> MailerLite subscriber upsert.
//
// Field keys below are the PROPOSED contract (plan 3.3). They are frozen only after they are
// created in the real MailerLite account and exported to docs/MAILERLITE_POLJA.md; Maja builds
// automations on them, so renaming later breaks her flows.
//
// Env: MAILERLITE_API_KEY, MAILERLITE_GROUP_ID, optional MAILERLITE_API_URL (tests use a mock).

const API = () => (process.env.MAILERLITE_API_URL || 'https://connect.mailerlite.com').replace(/\/$/, '');
export const imaMailerLite = () => !!process.env.MAILERLITE_API_KEY && !!process.env.MAILERLITE_GROUP_ID;

export function sestaviSubscriber({ kontakt, rezultat, reportUrl, marketing, datum }) {
  return {
    email: kontakt.email,
    fields: {
      name: kontakt.ime,
      last_name: kontakt.priimek,
      phone: kontakt.telefon,
      company: kontakt.podjetje,
      abs_score: rezultat.skupno,
      abs_stopnja: rezultat.stopnja.naziv,
      abs_proces: rezultat.proces?.naziv ?? '',
      abs_priporocilo: rezultat.proces?.priporocilo ?? rezultat.stopnja.priporocilo,
      abs_lead: rezultat.lead.razred,
      abs_report_url: reportUrl,
      abs_datum: datum,               // YYYY-MM-DD
      abs_marketing: marketing ? 'da' : 'ne',
    },
    groups: [String(process.env.MAILERLITE_GROUP_ID)],
  };
}

// Returns { ok } | { ok: false, retry: boolean, error }.
// 4xx (except 408/429) is a data problem: retrying would only repeat it.
export async function upsertSubscriber(sub) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${API()}/api/subscribers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MAILERLITE_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(sub),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true };
    const body = (await res.text().catch(() => '')).slice(0, 300);
    const retry = res.status >= 500 || res.status === 408 || res.status === 429;
    return { ok: false, retry, error: `HTTP ${res.status} ${body}` };
  } catch (e) {
    return { ok: false, retry: true, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
}
