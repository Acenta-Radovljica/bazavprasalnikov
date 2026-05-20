// ── DEL 1: Imports ────────────────────────────────────────────────────────
import express from 'express';
import { dbQuery } from '../db.js';
import { hashIp } from '../utils/normalize.js';
import { najdiPodjetjeAI } from '../ai/match_company.js';
import { sproziPovzetek, sproziPriporocila } from '../ai/queue.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const router = express.Router();

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Iz Formspree payloada izlusci ime podjetja.
// Formspree poslje vsa polja obrazca kot kljuce — iscemo polje "2_podjetje"
// ali variante. Ce ga ni, vrnemo placeholder z timestampom.
function izlusciPodjetje(payload) {
  const keys = ['2_podjetje', 'podjetje', 'company', '_replyto_company'];
  for (const k of keys) {
    if (payload[k] && typeof payload[k] === 'string' && payload[k].trim()) {
      return payload[k].trim();
    }
  }
  return `NEZNANO_PODJETJE_${Date.now()}`;
}

// ── DEL 4: Glavni handler ────────────────────────────────────────────────
// POST /webhook/formspree
// Formspree poslje JSON s polji obrazca. Vrne 200 takoj — AI obdelava bo
// (v Fazi 3) potekala asinhrono, da ne blokiramo Formspree retry logike.
router.post('/formspree', async (req, res) => {
  // Formspree poslje payload v obliki { form, keys, submission: { ...polja } }.
  // Direkten POST (npr. test prek curl-a brez Formspree) pa ima polja na korenu.
  // Podpremo oba formata — ce ima telo `submission` objekt, ga "unwrappamo".
  const body = req.body || {};
  const payload = (body.submission && typeof body.submission === 'object') ? body.submission : body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const ipHash = hashIp(ip);

  // GDPR: privolitev v hrambo (polje v Formspree obrazcu — privzeto false ce manjka)
  const consent = payload.gdpr_consent === 'on' || payload.gdpr_consent === true;

  const podjetje = izlusciPodjetje(payload);
  const matchRes = await najdiPodjetjeAI(podjetje);

  if (!matchRes?.companyId) {
    console.error('[webhook] ni mogel ustvariti/najti companies vrstice za:', podjetje);
    return res.status(500).json({ ok: false, error: 'db_company_failed' });
  }
  const companyId = matchRes.companyId;

  // Deduplikacija: ce isti email + isto podjetje v zadnjih 10 minutah, preskoci.
  // Razlog: Formspree retrya na network napakah, in isti respondent ne odda
  // 2x v 10 minutah — varna meja proti duplikatom brez napacnih pozitivov.
  const email = (payload.email || payload['3_email'] || payload._replyto || '').toString().toLowerCase().trim();
  if (email) {
    const dup = await dbQuery(
      `SELECT id FROM responses
       WHERE company_id = $1
         AND lower(raw_data->>'email') = $2
         AND submitted_at > NOW() - INTERVAL '10 minutes'
       LIMIT 1`,
      [companyId, email]
    );
    // Tudi preveri po "3_email" kljucu (Formspree pogosto pripne stevilko polja)
    const dup2 = await dbQuery(
      `SELECT id FROM responses
       WHERE company_id = $1
         AND lower(raw_data->>'3_email') = $2
         AND submitted_at > NOW() - INTERVAL '10 minutes'
       LIMIT 1`,
      [companyId, email]
    );
    if (dup?.rows?.length > 0 || dup2?.rows?.length > 0) {
      console.log('[webhook] duplikat zaznan (email+10min), preskocim');
      return res.json({ ok: true, deduplicated: true });
    }
  }

  const inserted = await dbQuery(
    `INSERT INTO responses (company_id, raw_data, ip_hash, consent_gdpr)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [companyId, JSON.stringify(payload), ipHash, consent]
  );

  // Posodobi last_response_at na podjetju
  await dbQuery(
    'UPDATE companies SET last_response_at = NOW() WHERE id = $1',
    [companyId]
  );

  const responseId = inserted?.rows?.[0]?.id;
  console.log(`[webhook] shranjeno: company=${companyId} response=${responseId} podjetje="${podjetje}" match=${matchRes.source}`);

  // Sprozi AI obdelavo v ozadju — webhook odgovori takoj, AI tece async.
  if (responseId) sproziPovzetek(responseId);
  sproziPriporocila(companyId);

  return res.json({ ok: true, responseId, companyId, matchSource: matchRes.source });
});

// ── DEL 4b: Debug endpointi (zacasno, brez auth — odstrani v Fazi 4) ────

// Zadnjih 10 responses + companies za hitro preverjanje
router.get('/debug/last', async (_req, res) => {
  const responses = await dbQuery(
    `SELECT r.id, r.company_id, c.naziv_prikaz, c.naziv_normaliziran,
            r.submitted_at, r.raw_data, r.ai_povzetek, r.ai_processed_at
       FROM responses r
       JOIN companies c ON c.id = r.company_id
      ORDER BY r.id DESC
      LIMIT 10`
  );
  const companies = await dbQuery(
    `SELECT id, naziv_prikaz, naziv_normaliziran, created_at, last_response_at,
            ai_priporocila, ai_priporocila_updated_at
       FROM companies
      ORDER BY id DESC
      LIMIT 20`
  );
  res.json({
    responses: responses?.rows ?? [],
    companies: companies?.rows ?? [],
  });
});

// Hitri AI status — koliko responses ima povzetek, koliko podjetij priporocila
router.get('/debug/ai-status', async (_req, res) => {
  const r = await dbQuery(`
    SELECT
      (SELECT count(*) FROM responses) AS responses_total,
      (SELECT count(*) FROM responses WHERE ai_povzetek IS NOT NULL) AS responses_z_povzetkom,
      (SELECT count(*) FROM companies) AS companies_total,
      (SELECT count(*) FROM companies WHERE ai_priporocila IS NOT NULL) AS companies_z_priporocili
  `);
  res.json(r?.rows?.[0] ?? {});
});

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { router };
