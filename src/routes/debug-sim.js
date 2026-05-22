// Zacasna debug ruta za preverjanje pg_trgm similarity-jev.
// Bo odstranjena ko bo AI matching tuninja koncan.
import express from 'express';
import { dbQuery } from '../db.js';
import { generirajPriporocila } from '../ai/generate_priporocila.js';
import { generirajPovzetek } from '../ai/generate_povzetek.js';
import { najdiPodjetjeAI } from '../ai/match_company.js';
import { sproziPovzetek } from '../ai/queue.js';
import { hashIp } from '../utils/normalize.js';
import { posljiObvestiloOdgovor } from '../lib/mailer.js';

const router = express.Router();

router.get('/sim', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'manjka q parameter' });

  const r = await dbQuery(
    `SELECT id, naziv_prikaz, naziv_normaliziran,
            similarity(naziv_normaliziran, $1) AS sim,
            levenshtein(naziv_normaliziran, $1) AS lev
       FROM companies
      ORDER BY sim DESC`,
    [q]
  );
  res.json({ query: q, results: r?.rows ?? [] });
});

// Zacasno cisti testne podatke (rabi ?token=acenta-test-clean)
// Ko bo admin UI s pravim auth-om gotov (Faza 4), to izbrisi.
router.post('/cleanup', async (req, res) => {
  if (req.query.token !== 'acenta-test-clean') return res.status(403).json({ error: 'forbidden' });
  await dbQuery('DELETE FROM responses');
  await dbQuery('DELETE FROM companies');
  await dbQuery('ALTER SEQUENCE responses_id_seq RESTART WITH 1');
  await dbQuery('ALTER SEQUENCE companies_id_seq RESTART WITH 1');
  res.json({ ok: true, cleared: ['responses', 'companies'] });
});

// Bulk import endpoint za uvoz starih Formspree submission-ov.
// Token-protected (acenta-test-clean). Sprejme original submitted_at.
// Body: { payload, submitted_at, podjetje?, questionnaire_slug? (default: moj-ai-nacrt) }
router.post('/import', async (req, res) => {
  if (req.query.token !== 'acenta-test-clean') return res.status(403).json({ error: 'forbidden' });

  const { payload, submitted_at, podjetje: explicitPodjetje, questionnaire_slug } = req.body || {};
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'missing_payload' });
  }
  if (!submitted_at) return res.status(400).json({ error: 'missing_submitted_at' });

  // Default slug: moj-ai-nacrt (legacy Formspree). Lahko overridenes z body.questionnaire_slug.
  const slug = (typeof questionnaire_slug === 'string' && questionnaire_slug.trim())
    ? questionnaire_slug.trim().toLowerCase()
    : 'moj-ai-nacrt';
  const qRow = await dbQuery('SELECT id FROM questionnaires WHERE slug = $1', [slug]);
  if (!qRow?.rows?.length) {
    return res.status(400).json({ error: 'questionnaire_not_found', slug });
  }
  const questionnaireId = qRow.rows[0].id;

  // Izvleci podjetje iz payloada (preveri obe varianti: 2_podjetje + podjetje)
  const podjetje = explicitPodjetje
    || payload['2_podjetje']
    || payload['podjetje']
    || payload['company']
    || null;

  if (!podjetje || !podjetje.trim()) {
    return res.status(400).json({ error: 'missing_company_name' });
  }

  const matchRes = await najdiPodjetjeAI(podjetje.trim());
  if (!matchRes?.companyId) {
    return res.status(500).json({ error: 'company_match_failed', podjetje });
  }
  const companyId = matchRes.companyId;

  const consent = payload.gdpr_consent === 'on' || payload.gdpr_consent === true;
  const ipHash = hashIp('import-script');

  // INSERT z eksplicitnim submitted_at (override DB default)
  const inserted = await dbQuery(
    `INSERT INTO responses (company_id, questionnaire_id, raw_data, ip_hash, consent_gdpr, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [companyId, questionnaireId, JSON.stringify(payload), ipHash, consent, submitted_at]
  );
  const responseId = inserted?.rows?.[0]?.id;

  // Posodobi last_response_at na max (current vs new)
  await dbQuery(
    `UPDATE companies
        SET last_response_at = GREATEST(COALESCE(last_response_at, $2::timestamptz), $2::timestamptz)
      WHERE id = $1`,
    [companyId, submitted_at]
  );

  // Sprozi Haiku povzetek async (povzetek ostane avtomatski — poceni)
  if (responseId) sproziPovzetek(responseId);

  res.json({ ok: true, companyId, responseId, matchSource: matchRes.source, podjetje });
});

// Sinhron klic priporocil — za debug. Ce je napaka, vrne stack trace.
// Param: ?questionnaire_id=X (obvezno). Po default-u ni vec ene "priporocila" funkcije
// brez vprasalnika — vsako podjetje ima locena priporocila per vprasalnik.
router.post('/run-priporocila/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const qid = parseInt(req.query.questionnaire_id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
  if (!Number.isInteger(qid)) return res.status(400).json({ error: 'missing_questionnaire_id' });
  try {
    const r = await generirajPriporocila(id, qid);
    res.json({ ok: true, length: r?.length ?? 0, preview: r?.slice(0, 200) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
});

router.post('/run-povzetek/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const r = await generirajPovzetek(id);
    res.json({ ok: true, length: r?.length ?? 0, preview: r?.slice(0, 200) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
});

// Direkten zapis priporocil v bazo (brez klica AI). Za uvoz analize narejene
// rocno v Claude Code (brez API stroska).
// Body: { content: "markdown...", questionnaire_id?: number, questionnaire_slug?: string }
// Vsaj eno od questionnaire_id / questionnaire_slug mora biti podano.
// Default: ce ni podano nic, uporabi "moj-ai-nacrt" (backward compat).
router.post('/set-priporocila/:id', async (req, res) => {
  if (req.query.token !== 'acenta-test-clean') return res.status(403).json({ error: 'forbidden' });
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const { content, questionnaire_id, questionnaire_slug } = req.body || {};
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'missing_content' });

  // Razresi questionnaire_id iz body (po id ali slug, default moj-ai-nacrt)
  let qid = Number.isInteger(questionnaire_id) ? questionnaire_id : null;
  if (!qid) {
    const slug = (typeof questionnaire_slug === 'string' && questionnaire_slug.trim())
      ? questionnaire_slug.trim().toLowerCase()
      : 'moj-ai-nacrt';
    const qRow = await dbQuery('SELECT id FROM questionnaires WHERE slug = $1', [slug]);
    if (!qRow?.rows?.length) return res.status(400).json({ error: 'questionnaire_not_found', slug });
    qid = qRow.rows[0].id;
  }

  // Preveri da podjetje obstaja
  const c = await dbQuery('SELECT id, naziv_prikaz FROM companies WHERE id = $1', [id]);
  if (!c?.rows?.length) return res.status(404).json({ error: 'company_not_found' });

  // UPSERT v company_priporocila
  await dbQuery(`
    INSERT INTO company_priporocila (company_id, questionnaire_id, vsebina, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (company_id, questionnaire_id)
    DO UPDATE SET vsebina = EXCLUDED.vsebina, updated_at = NOW()
  `, [id, qid, content]);

  res.json({ ok: true, company: c.rows[0], questionnaire_id: qid, length: content.length });
});

// Direkten zapis cross-client insights v bazo (brez klica AI).
// Za uvoz analize narejene rocno v Claude Code (brez API stroska).
// Body: { content: "markdown...", dni?: 90, st_klientov?: number, st_respondentov?: number }
router.post('/set-insights', async (req, res) => {
  if (req.query.token !== 'acenta-test-clean') return res.status(403).json({ error: 'forbidden' });
  const { content, dni, st_klientov, st_respondentov } = req.body || {};
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'missing_content' });

  const vsebina = {
    format: 'markdown',
    dni_obdobja: Number.isInteger(dni) ? dni : null,
    st_klientov: Number.isInteger(st_klientov) ? st_klientov : null,
    st_respondentov: Number.isInteger(st_respondentov) ? st_respondentov : null,
    content,
    source: 'manual_import',
  };

  const r = await dbQuery(
    `INSERT INTO cross_client_insights (vsebina) VALUES ($1) RETURNING id, generated_at`,
    [JSON.stringify(vsebina)]
  );
  res.json({ ok: true, insight: r?.rows?.[0] ?? null, length: content.length });
});

// Debug: preveri stanje email konfiguracije in poskusi poslati test mail.
// GET /debug/mail-status?token=acenta-test-clean
router.get('/mail-status', async (req, res) => {
  if (req.query.token !== 'acenta-test-clean') return res.status(403).json({ error: 'forbidden' });
  const env = {
    RESEND_API_KEY_present: !!process.env.RESEND_API_KEY,
    RESEND_API_KEY_prefix: (process.env.RESEND_API_KEY || '').slice(0, 6),
    RESEND_API_KEY_len: (process.env.RESEND_API_KEY || '').length,
    NOTIFY_EMAIL: process.env.NOTIFY_EMAIL || '(default: ai@acenta.si)',
    RESEND_FROM: process.env.RESEND_FROM || '(default: Acenta Baza <onboarding@resend.dev>)',
    ADMIN_BASE_URL: process.env.ADMIN_BASE_URL || '(default)',
  };
  res.json({ ok: true, env });
});

// POST /debug/test-mail?token=acenta-test-clean
// Poskusi poslati test mail in vrne rezultat sinhrono.
router.post('/test-mail', async (req, res) => {
  if (req.query.token !== 'acenta-test-clean') return res.status(403).json({ error: 'forbidden' });
  const resendId = await posljiObvestiloOdgovor({
    companyId: 999,
    companyName: 'DEBUG TEST Acenta',
    contactName: 'Debug Test',
    contactEmail: 'debug@acenta.si',
    position: 'Test',
    povzetek: 'To je test povzetek za preverjanje, ali Resend API delue prek backenda.',
  });
  res.json({
    ok: true,
    resendId,
    note: resendId ? 'Mail poslan — preveri inbox' : 'Mail NI bil poslan (poglej server logs ali mail-status)',
  });
});

export { router };
