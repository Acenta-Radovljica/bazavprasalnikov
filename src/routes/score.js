// ── DEL 1: Imports ────────────────────────────────────────────────────────
// AI Business Score routes.
//   javniRouter  (no auth): /ai-business-score (landing + quiz), /ai-business-score/vprasanja.json,
//                           /r/:token (report page), /r/:token/podatki (report data)
//   adminRouter  (basic auth, mounted on /api/score): /export.csv
// Submissions themselves go through the existing POST /f/ai-business-score (form.js).
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dbQuery } from '../db.js';
import { javnaVprasanja, besedilaOdgovorov, SCORE_SLUG } from '../score/oddaja.js';
import { sestaviPredlogo } from '../score/predloga.js';
import { izracunajVzvode, povzetekOdgovorov } from '../score/vzvodi.js';
import { VELIKOST } from '../score/vprasanja-v1.js';
import { cilj } from '../score/dejstva.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'score');
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

// Report pages carry a company name and score: never indexed, never leaked via Referer,
// never cached by shared proxies.
function zasebneGlave(res) {
  res.set({
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'private, no-store',
  });
}

// ── DEL 3: Javne rute ─────────────────────────────────────────────────────
const javniRouter = express.Router();

javniRouter.get('/ai-business-score/vprasanja.json', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300').json(javnaVprasanja());
});
javniRouter.use('/ai-business-score', express.static(PUBLIC_DIR, { index: 'index.html', maxAge: '5m' }));

javniRouter.get('/r/:token', (req, res) => {
  zasebneGlave(res);
  if (!TOKEN_RE.test(req.params.token)) return res.status(404).send('Poročilo ne obstaja.');
  res.sendFile(join(PUBLIC_DIR, 'porocilo.html'));
});

// Minimised data for the public report: no raw answer ids, no lead class, no financial
// potential, no internal signals. Since 1. 10. no answer texts either: echoing them back was what
// made the report read as "only what I ticked" (Matjaž); only the "wants a talk" flag is sent.
javniRouter.get('/r/:token/podatki', async (req, res) => {
  zasebneGlave(res);
  if (!TOKEN_RE.test(req.params.token)) return res.status(404).json({ error: 'not_found' });
  const r = await dbQuery(
    `SELECT s.score_version, s.rezultat, s.besedilo, s.ai_status, s.revoked_at, s.created_at, r.raw_data
       FROM score_results s JOIN responses r ON r.id = s.response_id
      WHERE s.token = $1`,
    [req.params.token],
  );
  const v = r?.rows?.[0];
  if (!v) return res.status(404).json({ error: 'not_found' });
  if (v.revoked_at) return res.status(410).json({ error: 'revoked' });

  const rez = v.rezultat, raw = v.raw_data || {};
  // Levers first: the template leaves their topics out of "zatika" (one topic, one place).
  const vz = izracunajVzvode(raw.odgovori || {}, raw.velikost || null, 3, v.score_version);
  const predloga = sestaviPredlogo(rez, raw.podjetje, raw.odgovori || {}, vz.vzvodi);
  const ai = v.besedilo;
  // The AI text arrives ~20 s after the submission, the report opens after ~2 s: the page shows
  // the score at once and waits for the text while this says 'pripravlja'.
  const besediloStanje = ai ? 'ai' : (['pending', 'retry'].includes(v.ai_status) ? 'pripravlja' : 'predloga');
  res.json({
    podjetje: raw.podjetje || '',
    email: raw.email || '',
    datum: new Date(v.created_at).toLocaleDateString('sl-SI', { timeZone: 'Europe/Ljubljana' }),
    skupno: rez.skupno,
    dimenzije: { zrelost: rez.dimenzije.zrelost, potencial: rez.dimenzije.potencial, pripravljenost: rez.dimenzije.pripravljenost },
    stopnja: rez.stopnja,
    proces: rez.proces,
    // Recomputed on read from the stored answers with the current scorer (pure, cheap).
    ...vz,
    zeliPogovor: povzetekOdgovorov(raw.odgovori || {}).zeliPogovor,
    // v2: the goal of the first AI project, so the project card says what success is measured by.
    cilj: cilj(raw.odgovori || {}),
    // Booking link is not decided yet; without it the page shows only the phone number.
    rezervacija: /^https:\/\//.test(process.env.SCORE_BOOKING_URL || '') ? process.env.SCORE_BOOKING_URL : null,
    besediloStanje,
    besedilo: {
      odstavek: ai?.odstavek || predloga.odstavek,
      dobro: ai?.dobro || predloga.dobro,
      zatika: ai?.zatika || predloga.zatika,
      // AI v2 writes its own opportunities; older AI rows (v1, no "moznosti") use the template.
      priloznosti: ai?.moznosti || predloga.priloznosti,
    },
  });
});

// ── DEL 4: Admin (basic auth) ─────────────────────────────────────────────
const adminRouter = express.Router();

// CSV for Excel (Slovenian locale): UTF-8 with BOM, ';' separator, CRLF.
const celica = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const ISO_DAN = /^\d{4}-\d{2}-\d{2}$/;

adminRouter.get('/export.csv', async (req, res) => {
  const od = ISO_DAN.test(req.query.od || '') ? req.query.od : '2000-01-01';
  const doDan = ISO_DAN.test(req.query.do || '') ? req.query.do : '2999-12-31';
  const r = await dbQuery(
    `SELECT s.created_at, s.rezultat, s.marketing_soglasje, s.ml_status, s.token, r.raw_data
       FROM score_results s
       JOIN responses r ON r.id = s.response_id
       JOIN questionnaires q ON q.id = r.questionnaire_id AND q.slug = $3
      WHERE s.created_at >= $1::date AND s.created_at < ($2::date + 1)
      ORDER BY s.created_at`,
    [od, doDan, SCORE_SLUG],
  );
  if (!r) return res.status(500).json({ error: 'db_error' });

  const glava = ['Datum', 'Ime', 'Priimek', 'E-pošta', 'Telefon', 'Podjetje', 'Zaposleni',
    'AI Business Score', 'Stopnja', 'Proces', 'Lead', 'Razlog', 'Marketinško soglasje',
    'Največja ovira', 'Kako hitro', 'Kaj bi pomagalo', 'Proces v 90 dneh', 'Glavni cilj', 'MailerLite', 'Poročilo'];
  const base = (process.env.PUBLIC_BASE_URL || 'https://nacrt.deploy.acenta.si').replace(/\/$/, '');
  const vrstice = r.rows.map(v => {
    const raw = v.raw_data || {}, z = v.rezultat, t = besedilaOdgovorov(raw.odgovori);
    return [
      new Date(v.created_at).toLocaleString('sl-SI', { timeZone: 'Europe/Ljubljana' }),
      raw.ime, raw.priimek, raw.email, raw.telefon, raw.podjetje,
      VELIKOST.find(x => x.id === raw.velikost)?.text ?? raw.velikost,
      z.skupno, z.stopnja?.naziv, z.proces?.naziv ?? '', z.lead?.razred, (z.lead?.razlogi || []).join(', '),
      v.marketing_soglasje ? 'da' : 'ne',
      t.ovira, t.hitrost, t.pomoc, t.proces90, t.cilj, v.ml_status, `${base}/r/${v.token}`,
    ].map(celica).join(';');
  });
  const ime = `ai-business-score_${od === '2000-01-01' ? 'vse' : od}_${doDan === '2999-12-31' ? 'danes' : doDan}.csv`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${ime}"`, 'Cache-Control': 'no-store' });
  res.send('﻿' + [glava.map(celica).join(';'), ...vrstice].join('\r\n') + '\r\n');
});

// ── DEL 5: Named exports ─────────────────────────────────────────────────
export { javniRouter, adminRouter };
