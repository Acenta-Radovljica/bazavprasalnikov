// ── DEL 1: Imports ────────────────────────────────────────────────────────
import express from 'express';
import { dbQuery } from '../db.js';
import { hashIp } from '../utils/normalize.js';
import { najdiPodjetjeAI } from '../ai/match_company.js';
import { sproziPovzetek } from '../ai/queue.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const router = express.Router();

// Legacy slug — vsi obstoječi Formspree odgovori se vežejo na ta vprasalnik.
const LEGACY_SLUG = 'moj-ai-nacrt';

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

// Skupna logika za vse webhooke (legacy /formspree + novi /:slug).
// Vrne odgovor obliki, ki ga ruta direktno res.json-i.
async function obdelajSubmission({ payload, ip, questionnaireId }) {
  const ipHash = hashIp(ip);
  const consent = payload.gdpr_consent === 'on' || payload.gdpr_consent === true;

  const podjetje = izlusciPodjetje(payload);
  const matchRes = await najdiPodjetjeAI(podjetje);

  if (!matchRes?.companyId) {
    console.error('[webhook] ni mogel ustvariti/najti companies vrstice za:', podjetje);
    return { status: 500, body: { ok: false, error: 'db_company_failed' } };
  }
  const companyId = matchRes.companyId;

  // Deduplikacija: ce isti email + isto podjetje + isti vprasalnik v zadnjih
  // 10 minutah, preskoci. Razlog: Formspree retry-a na network napakah.
  const email = (payload.email || payload['3_email'] || payload._replyto || '').toString().toLowerCase().trim();
  if (email) {
    const dup = await dbQuery(
      `SELECT id FROM responses
       WHERE company_id = $1
         AND questionnaire_id = $2
         AND (lower(raw_data->>'email') = $3 OR lower(raw_data->>'3_email') = $3)
         AND submitted_at > NOW() - INTERVAL '10 minutes'
       LIMIT 1`,
      [companyId, questionnaireId, email]
    );
    if (dup?.rows?.length > 0) {
      console.log('[webhook] duplikat zaznan (email+10min), preskocim');
      return { status: 200, body: { ok: true, deduplicated: true } };
    }
  }

  const inserted = await dbQuery(
    `INSERT INTO responses (company_id, questionnaire_id, raw_data, ip_hash, consent_gdpr)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [companyId, questionnaireId, JSON.stringify(payload), ipHash, consent]
  );

  // Posodobi last_response_at na podjetju
  await dbQuery(
    'UPDATE companies SET last_response_at = NOW() WHERE id = $1',
    [companyId]
  );

  const responseId = inserted?.rows?.[0]?.id;
  console.log(`[webhook] shranjeno: company=${companyId} q=${questionnaireId} response=${responseId} podjetje="${podjetje}" match=${matchRes.source}`);

  // POVZETEK (Haiku ~$0.001/klic) tece avtomatsko ob vsakem responseu.
  // PRIPOROCILA (Opus ~$0.30/klic) NE tecejo avtomatsko — admin jih sprozi rocno.
  if (responseId) sproziPovzetek(responseId);

  return {
    status: 200,
    body: { ok: true, responseId, companyId, matchSource: matchRes.source },
  };
}

// Najdi questionnaire_id po slugu. Vrne null ce vprasalnik ne obstaja ali ni aktiven.
async function najdiQuestionnaireBySlug(slug) {
  const r = await dbQuery(
    'SELECT id, aktivna FROM questionnaires WHERE slug = $1',
    [slug]
  );
  if (!r?.rows?.length) return null;
  if (!r.rows[0].aktivna) return null;
  return r.rows[0].id;
}

// Unwrap Formspree-style { submission: {...} } payload. Direkten POST (npr.
// curl test) ima polja na korenu — podpremo oba formata.
function razpakajPayload(body) {
  if (!body) return {};
  return (body.submission && typeof body.submission === 'object') ? body.submission : body;
}

function ipIzReq(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
}

// ── DEL 4: Glavne rute ────────────────────────────────────────────────────

// POST /webhook/formspree — LEGACY za obstojeci Formspree obrazec "Moj AI nacrt".
// Veze odgovore na fiksen slug moj-ai-nacrt. NE odstrani — Formspree posilja sem.
router.post('/formspree', async (req, res) => {
  const payload = razpakajPayload(req.body);
  const ip = ipIzReq(req);

  const questionnaireId = await najdiQuestionnaireBySlug(LEGACY_SLUG);
  if (!questionnaireId) {
    console.error(`[webhook/formspree] LEGACY vprasalnik "${LEGACY_SLUG}" ne obstaja ali ni aktiven`);
    return res.status(500).json({ ok: false, error: 'legacy_questionnaire_missing' });
  }

  const { status, body } = await obdelajSubmission({ payload, ip, questionnaireId });
  return res.status(status).json(body);
});

// POST /webhook/:slug — splosna pot za vse nove vprasalnike.
// Slug mora biti aktiven v tabeli questionnaires.
// Pomembno: ta ruta MORA biti za /formspree, sicer /formspree padel v :slug match.
router.post('/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (!slug) return res.status(400).json({ ok: false, error: 'missing_slug' });

  const questionnaireId = await najdiQuestionnaireBySlug(slug);
  if (!questionnaireId) {
    return res.status(404).json({ ok: false, error: 'questionnaire_not_found_or_inactive', slug });
  }

  const payload = razpakajPayload(req.body);
  const ip = ipIzReq(req);

  const { status, body } = await obdelajSubmission({ payload, ip, questionnaireId });
  return res.status(status).json(body);
});

// ── DEL 4b: Debug endpointi (brez auth — odstrani v Fazi 4) ─────────────

// Zadnjih 10 responses + companies za hitro preverjanje
router.get('/debug/last', async (_req, res) => {
  const responses = await dbQuery(
    `SELECT r.id, r.company_id, r.questionnaire_id,
            c.naziv_prikaz, c.naziv_normaliziran,
            q.slug AS q_slug, q.naziv_prikaz AS q_naziv,
            r.submitted_at, r.raw_data, r.ai_povzetek, r.ai_processed_at
       FROM responses r
       JOIN companies c ON c.id = r.company_id
       JOIN questionnaires q ON q.id = r.questionnaire_id
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

// Hitri AI status — koliko responses ima povzetek, koliko (podjetje x vprasalnik) ima priporocila
router.get('/debug/ai-status', async (_req, res) => {
  const r = await dbQuery(`
    SELECT
      (SELECT count(*) FROM responses) AS responses_total,
      (SELECT count(*) FROM responses WHERE ai_povzetek IS NOT NULL) AS responses_z_povzetkom,
      (SELECT count(*) FROM companies) AS companies_total,
      (SELECT count(*) FROM company_priporocila) AS priporocila_total,
      (SELECT count(*) FROM questionnaires WHERE aktivna) AS vprasalniki_aktivni
  `);
  res.json(r?.rows?.[0] ?? {});
});

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { router };
