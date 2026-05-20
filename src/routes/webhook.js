// ── DEL 1: Imports ────────────────────────────────────────────────────────
import express from 'express';
import { dbQuery } from '../db.js';
import { hashIp } from '../utils/normalize.js';
import { najdiPodjetjeAI } from '../ai/match_company.js';

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
  const payload = req.body || {};
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

  // Deduplikacija: ce isti IP+timestamp v zadnji minuti, preskoci.
  // Razlog: Formspree retrya na network napakah — ne zelimo duplikatov.
  if (ipHash) {
    const dup = await dbQuery(
      `SELECT id FROM responses
       WHERE ip_hash = $1
         AND company_id = $2
         AND submitted_at > NOW() - INTERVAL '1 minute'
       LIMIT 1`,
      [ipHash, companyId]
    );
    if (dup?.rows?.length > 0) {
      console.log('[webhook] duplikat zaznan (ip+1min), preskocim');
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

  // TODO Faza 3: sprozi async AI obdelavo (generate_povzetek, generate_priporocila)
  return res.json({ ok: true, responseId, companyId, matchSource: matchRes.source });
});

// ── DEL 4b: Debug endpoint (zacasno, brez auth — odstrani v Fazi 4) ─────
// GET /webhook/debug/last → zadnjih 10 responses + companies za hitro preverjanje
router.get('/debug/last', async (_req, res) => {
  const responses = await dbQuery(
    `SELECT r.id, r.company_id, c.naziv_prikaz, c.naziv_normaliziran,
            r.submitted_at, r.raw_data
       FROM responses r
       JOIN companies c ON c.id = r.company_id
      ORDER BY r.id DESC
      LIMIT 10`
  );
  const companies = await dbQuery(
    `SELECT id, naziv_prikaz, naziv_normaliziran, created_at, last_response_at
       FROM companies
      ORDER BY id DESC
      LIMIT 20`
  );
  res.json({
    responses: responses?.rows ?? [],
    companies: companies?.rows ?? [],
  });
});

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { router };
