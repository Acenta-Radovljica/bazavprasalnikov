// AI Business Score outbox worker: MailerLite upsert and AI prose, driven by rows in
// score_results (not process memory), so a deploy or crash never loses work.
//
// Claim: rows with an unfinished step whose next_attempt_at is due and that are not locked
// (a lock older than 5 min counts as free: the process that held it died). FOR UPDATE SKIP
// LOCKED keeps two workers from taking the same row.
//
// MailerLite runs first: the score e-mail must not wait for the AI text.

import { dbQuery } from '../db.js';
import { besedilaOdgovorov } from './oddaja.js';
import { generirajBesedilo, imaAI } from './besedilo.js';
import { imaMailerLite, sestaviSubscriber, upsertSubscriber } from './mailerlite.js';

const ML_BACKOFF_MIN = [1, 5, 30, 120, 720];  // then 'failed'
const AI_MAX = 3;
const BREZ_KLJUCA_MIN = 60;                    // MailerLite key missing: look again in an hour

const javniUrl = (token) => `${(process.env.PUBLIC_BASE_URL || 'https://nacrt.deploy.acenta.si').replace(/\/$/, '')}/r/${token}`;

async function prevzemi(limit = 10) {
  const r = await dbQuery(
    `UPDATE score_results SET locked_at = NOW()
      WHERE id IN (
        SELECT id FROM score_results
         WHERE (ai_status IN ('pending','retry') OR ml_status IN ('pending','retry'))
           AND next_attempt_at <= NOW()
           AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
         ORDER BY id LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING id, token, rezultat, marketing_soglasje, ai_status, ml_status, attempts_ai, attempts_ml, created_at,
                (SELECT raw_data FROM responses WHERE responses.id = score_results.response_id) AS raw`,
    [limit],
  );
  return r?.rows ?? [];
}

async function obdelajVrstico(v) {
  const raw = v.raw || {};
  const kontakt = { ime: raw.ime, priimek: raw.priimek, email: raw.email, telefon: raw.telefon, podjetje: raw.podjetje };
  const upd = { ml_status: v.ml_status, attempts_ml: v.attempts_ml, ai_status: v.ai_status, attempts_ai: v.attempts_ai, besedilo: undefined };
  const napake = [];
  const naslednji = [];  // minutes until the next needed attempt

  // 1) MailerLite
  if (['pending', 'retry'].includes(v.ml_status)) {
    if (!imaMailerLite()) {
      napake.push('MailerLite ni nastavljen (MAILERLITE_API_KEY / MAILERLITE_GROUP_ID)');
      naslednji.push(BREZ_KLJUCA_MIN);   // stays pending, no attempt counted
    } else {
      const datum = new Date(v.created_at).toISOString().slice(0, 10);
      const res = await upsertSubscriber(sestaviSubscriber({
        kontakt, rezultat: v.rezultat, reportUrl: javniUrl(v.token), marketing: v.marketing_soglasje, datum,
      }));
      upd.attempts_ml = v.attempts_ml + 1;
      if (res.ok) upd.ml_status = 'ok';
      else {
        napake.push(`MailerLite: ${res.error}`);
        if (!res.retry || upd.attempts_ml >= ML_BACKOFF_MIN.length) upd.ml_status = 'failed';
        else { upd.ml_status = 'retry'; naslednji.push(ML_BACKOFF_MIN[upd.attempts_ml - 1]); }
      }
    }
  }

  // 2) AI prose
  if (['pending', 'retry'].includes(v.ai_status)) {
    if (!imaAI()) {
      upd.ai_status = 'failed';            // report keeps the template text
      napake.push('AI: ANTHROPIC_API_KEY ni nastavljen, porocilo uporablja predlogo');
    } else {
      const b = await generirajBesedilo(v.rezultat, besedilaOdgovorov(raw.odgovori), kontakt.podjetje || 'vaše podjetje');
      upd.attempts_ai = v.attempts_ai + 1;
      if (b) { upd.ai_status = 'ok'; upd.besedilo = b; }
      else if (upd.attempts_ai >= AI_MAX) { upd.ai_status = 'failed'; napake.push('AI: neveljaven odgovor, porocilo uporablja predlogo'); }
      else { upd.ai_status = 'retry'; naslednji.push(upd.attempts_ai); }
    }
  }

  const cez = naslednji.length ? Math.min(...naslednji) : 0;
  await dbQuery(
    `UPDATE score_results
        SET ml_status = $2, attempts_ml = $3, ai_status = $4, attempts_ai = $5,
            besedilo = COALESCE($6::jsonb, besedilo),
            next_attempt_at = NOW() + make_interval(mins => $7::int),
            last_error = $8, locked_at = NULL
      WHERE id = $1`,
    [v.id, upd.ml_status, upd.attempts_ml, upd.ai_status, upd.attempts_ai,
     upd.besedilo ? JSON.stringify(upd.besedilo) : null, cez, napake.join(' | ') || null],
  );
}

let tece = false;
export async function obdelajZapadle() {
  if (tece) return 0;           // one pass at a time per process
  tece = true;
  try {
    const vrstice = await prevzemi();
    for (const v of vrstice) {
      try { await obdelajVrstico(v); }
      catch (e) {
        console.error('[score/outbox] vrstica', v.id, e.message);
        await dbQuery('UPDATE score_results SET locked_at = NULL, last_error = $2 WHERE id = $1', [v.id, e.message.slice(0, 300)]);
      }
    }
    return vrstice.length;
  } finally { tece = false; }
}

// Kick right after a submission, without waiting for the interval.
export function sprozi() { setImmediate(() => obdelajZapadle().catch(e => console.error('[score/outbox]', e.message))); }

export function zazeniOutbox() {
  const ms = parseInt(process.env.SCORE_OUTBOX_MS || '30000', 10);
  const t = setInterval(() => obdelajZapadle().catch(e => console.error('[score/outbox]', e.message)), ms);
  t.unref();
  sprozi(); // pick up whatever a previous process left behind
  console.log(`[score/outbox] delavec tece vsakih ${ms} ms`);
}
