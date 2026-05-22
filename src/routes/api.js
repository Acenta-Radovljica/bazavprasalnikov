// ── DEL 1: Imports ────────────────────────────────────────────────────────
import express from 'express';
import { dbQuery } from '../db.js';
import { generirajPovzetek } from '../ai/generate_povzetek.js';
import { generirajPriporocila } from '../ai/generate_priporocila.js';
import { sproziPovzetek, sproziPriporocila, sproziInsights } from '../ai/queue.js';
import { renderiraj as renderirajPdf } from '../pdf/render.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const router = express.Router();

// ── DEL 4: Rute ───────────────────────────────────────────────────────────

// GET /api/companies — seznam vseh podjetij z metriko.
// Opcijski filter ?questionnaire_id=X (samo podjetja, ki imajo odgovore za ta vprasalnik).
router.get('/companies', async (req, res) => {
  const qid = parseInt(req.query.questionnaire_id, 10);
  const filtriraj = Number.isInteger(qid);

  const r = await dbQuery(`
    SELECT
      c.id, c.naziv_prikaz, c.naziv_normaliziran,
      c.created_at, c.last_response_at,
      EXISTS (SELECT 1 FROM company_priporocila cp WHERE cp.company_id = c.id) AS has_priporocila,
      (SELECT MAX(updated_at) FROM company_priporocila cp WHERE cp.company_id = c.id) AS priporocila_updated_at,
      COUNT(r.id)::int AS st_odgovorov,
      MAX(r.submitted_at) AS zadnji_odgovor
    FROM companies c
    LEFT JOIN responses r ON r.company_id = c.id ${filtriraj ? 'AND r.questionnaire_id = $1' : ''}
    ${filtriraj
      ? 'WHERE EXISTS (SELECT 1 FROM responses r2 WHERE r2.company_id = c.id AND r2.questionnaire_id = $1)'
      : ''}
    GROUP BY c.id
    ORDER BY COALESCE(MAX(r.submitted_at), c.created_at) DESC
  `, filtriraj ? [qid] : []);
  res.json({ companies: r?.rows ?? [] });
});

// GET /api/companies/:id — eno podjetje + vsi odgovori + AI priporocila (per vprasalnik).
router.get('/companies/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const company = await dbQuery('SELECT * FROM companies WHERE id = $1', [id]);
  if (!company?.rows?.length) return res.status(404).json({ error: 'not_found' });

  const responses = await dbQuery(
    `SELECT r.id, r.questionnaire_id, q.slug AS q_slug, q.naziv_prikaz AS q_naziv,
            r.submitted_at, r.raw_data, r.ai_povzetek, r.ai_processed_at, r.consent_gdpr
       FROM responses r
       JOIN questionnaires q ON q.id = r.questionnaire_id
      WHERE r.company_id = $1
      ORDER BY r.submitted_at DESC`,
    [id]
  );

  // Priporocila per vprasalnik (samo tisti vprasalniki, kjer podjetje ima odgovore ALI priporocila)
  const priporocila = await dbQuery(
    `SELECT cp.questionnaire_id, q.slug, q.naziv_prikaz, cp.vsebina, cp.updated_at
       FROM company_priporocila cp
       JOIN questionnaires q ON q.id = cp.questionnaire_id
      WHERE cp.company_id = $1
      ORDER BY cp.updated_at DESC`,
    [id]
  );

  res.json({
    company: company.rows[0],
    responses: responses?.rows ?? [],
    priporocila: priporocila?.rows ?? [],
  });
});

// GET /api/responses/:id — en odgovor + AI povzetek + company info
router.get('/responses/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const r = await dbQuery(`
    SELECT r.*, c.naziv_prikaz, c.id AS company_id_full,
           q.slug AS q_slug, q.naziv_prikaz AS q_naziv,
           q.questions AS q_questions
      FROM responses r
      JOIN companies c ON c.id = r.company_id
      JOIN questionnaires q ON q.id = r.questionnaire_id
     WHERE r.id = $1
  `, [id]);
  if (!r?.rows?.length) return res.status(404).json({ error: 'not_found' });

  res.json({ response: r.rows[0] });
});

// POST /api/companies/:id/regenerate-ai — rocno sprozi AI priporocila za en vprasalnik.
// Body: { questionnaire_id: number, mode?: "priporocila" | "vsi_povzetki" | "vse" }
router.post('/companies/:id/regenerate-ai', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const qid = parseInt(req.body?.questionnaire_id, 10);
  if (!Number.isInteger(qid)) {
    return res.status(400).json({ error: 'missing_questionnaire_id' });
  }

  const mode = req.body?.mode ?? 'priporocila';

  // Preveri, da podjetje obstaja
  const c = await dbQuery('SELECT id FROM companies WHERE id = $1', [id]);
  if (!c?.rows?.length) return res.status(404).json({ error: 'company_not_found' });

  // Preveri, da vprasalnik obstaja
  const q = await dbQuery('SELECT id FROM questionnaires WHERE id = $1', [qid]);
  if (!q?.rows?.length) return res.status(404).json({ error: 'questionnaire_not_found' });

  if (mode === 'vsi_povzetki' || mode === 'vse') {
    // Regeneriraj povzetke za vse responses tega (podjetja x vprasalnika)
    const responses = await dbQuery(
      'SELECT id FROM responses WHERE company_id = $1 AND questionnaire_id = $2',
      [id, qid]
    );
    for (const row of (responses?.rows ?? [])) {
      sproziPovzetek(row.id);
    }
  }

  // Sprozi priporocila (debounce 60s)
  sproziPriporocila(id, qid);

  res.json({ ok: true, mode, questionnaire_id: qid, queued_at: new Date().toISOString() });
});

// POST /api/companies/:id/merge — zlij dve podjetji
// Body: { target_id: <id v katerega zlijemo source> }
router.post('/companies/:id/merge', async (req, res) => {
  const sourceId = parseInt(req.params.id, 10);
  const targetId = parseInt(req.body?.target_id, 10);
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId)) {
    return res.status(400).json({ error: 'invalid_ids' });
  }
  if (sourceId === targetId) {
    return res.status(400).json({ error: 'same_id' });
  }

  const check = await dbQuery(
    'SELECT id FROM companies WHERE id = ANY($1::int[])',
    [[sourceId, targetId]]
  );
  if ((check?.rows?.length ?? 0) !== 2) {
    return res.status(404).json({ error: 'one_or_both_missing' });
  }

  // Premakni vse responses iz source na target
  const moved = await dbQuery(
    'UPDATE responses SET company_id = $1 WHERE company_id = $2 RETURNING id, questionnaire_id',
    [targetId, sourceId]
  );

  // Premakni company_priporocila iz source na target (ce target ze ima za isti
  // vprasalnik, source-ovo zavrzi — target ostane primarno).
  await dbQuery(`
    INSERT INTO company_priporocila (company_id, questionnaire_id, vsebina, updated_at)
    SELECT $1, questionnaire_id, vsebina, updated_at
      FROM company_priporocila
     WHERE company_id = $2
    ON CONFLICT (company_id, questionnaire_id) DO NOTHING
  `, [targetId, sourceId]);

  // Izbrisi source company (CASCADE pobrise company_priporocila iz source-a)
  await dbQuery('DELETE FROM companies WHERE id = $1', [sourceId]);

  // Posodobi last_response_at na target
  await dbQuery(
    `UPDATE companies SET last_response_at = (
       SELECT MAX(submitted_at) FROM responses WHERE company_id = $1
     ) WHERE id = $1`,
    [targetId]
  );

  // Re-generate priporocila za target za vsak vprasalnik, ki ga je dobil (debounced).
  // Iz moved responses izlusci unique questionnaire_ids.
  const qids = [...new Set((moved?.rows ?? []).map(r => r.questionnaire_id))];
  for (const qid of qids) {
    sproziPriporocila(targetId, qid);
  }

  res.json({
    ok: true,
    moved_responses: moved?.rows?.length ?? 0,
    regenerating_questionnaires: qids,
    deleted_company: sourceId,
    merged_into: targetId,
  });
});

// GET /api/stats — agregacije za dashboard (totals + timeline)
router.get('/stats', async (_req, res) => {
  // Skupne vrednosti — "brez_priporocil" pomeni podjetje ima vsaj 1 odgovor,
  // ampak nima nobenega priporocila v company_priporocila.
  const totals = await dbQuery(`
    SELECT
      (SELECT count(*) FROM companies)::int AS podjetja_total,
      (SELECT count(*) FROM responses)::int AS odgovori_total,
      (SELECT count(*) FROM companies c
        WHERE NOT EXISTS (SELECT 1 FROM company_priporocila cp WHERE cp.company_id = c.id)
          AND EXISTS (SELECT 1 FROM responses r WHERE r.company_id = c.id)
      )::int AS brez_priporocil,
      (SELECT count(*) FROM responses WHERE submitted_at > NOW() - INTERVAL '7 days')::int AS odgovori_7d,
      (SELECT count(*) FROM responses WHERE submitted_at > NOW() - INTERVAL '14 days' AND submitted_at <= NOW() - INTERVAL '7 days')::int AS odgovori_prej_7d,
      (SELECT count(*) FROM companies WHERE created_at > NOW() - INTERVAL '7 days')::int AS podjetja_7d,
      (SELECT count(*) FROM companies WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days')::int AS podjetja_prej_7d,
      (SELECT count(*) FROM questionnaires WHERE aktivna)::int AS vprasalniki_aktivni
  `);

  // Zastarela = priporocila obstajajo, ampak je novejsi response za isto
  // (podjetje x vprasalnik) prisel po generaciji.
  const zastarela = await dbQuery(`
    SELECT count(*)::int AS n
      FROM company_priporocila cp
     WHERE EXISTS (
       SELECT 1 FROM responses r
        WHERE r.company_id = cp.company_id
          AND r.questionnaire_id = cp.questionnaire_id
          AND r.submitted_at > cp.updated_at
     )
  `);

  // Timeline: stevilo responsov po dnevu zadnjih 30 dni
  const timeline = await dbQuery(`
    SELECT
      to_char(date_trunc('day', d), 'YYYY-MM-DD') AS dan,
      count(r.id)::int AS st
    FROM generate_series(
      date_trunc('day', NOW() - INTERVAL '29 days'),
      date_trunc('day', NOW()),
      INTERVAL '1 day'
    ) AS d
    LEFT JOIN responses r ON date_trunc('day', r.submitted_at) = d
    GROUP BY d
    ORDER BY d ASC
  `);

  res.json({
    totals: totals?.rows?.[0] ?? {},
    zastarela: zastarela?.rows?.[0]?.n ?? 0,
    timeline: timeline?.rows ?? [],
  });
});

// GET /api/insights — najnovejsi cross-client insights
router.get('/insights', async (_req, res) => {
  const r = await dbQuery(
    'SELECT id, generated_at, vsebina FROM cross_client_insights ORDER BY generated_at DESC LIMIT 1'
  );
  res.json({ insights: r?.rows?.[0] ?? null });
});

// POST /api/insights/regenerate
router.post('/insights/regenerate', async (req, res) => {
  const dni = parseInt(req.body?.dni, 10);
  sproziInsights({ dni: Number.isInteger(dni) && dni > 0 ? dni : undefined });
  res.json({ ok: true, queued_at: new Date().toISOString() });
});

// GET /api/search?q=... — polnotekstovno iskanje
router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json({ results: [] });

  const r = await dbQuery(`
    SELECT
      r.id AS response_id,
      r.company_id,
      c.naziv_prikaz,
      qn.slug AS q_slug,
      qn.naziv_prikaz AS q_naziv,
      r.submitted_at,
      ts_headline('simple',
        coalesce(r.raw_data::text, '') || ' ' || coalesce(r.ai_povzetek, ''),
        plainto_tsquery('simple', $1),
        'MaxFragments=2, MaxWords=20'
      ) AS highlight
    FROM responses r
    JOIN companies c ON c.id = r.company_id
    JOIN questionnaires qn ON qn.id = r.questionnaire_id
    WHERE to_tsvector('simple', coalesce(r.raw_data::text, '') || ' ' || coalesce(r.ai_povzetek, ''))
          @@ plainto_tsquery('simple', $1)
    ORDER BY r.submitted_at DESC
    LIMIT 50
  `, [q]);

  res.json({ query: q, results: r?.rows ?? [] });
});

// GET /api/companies/:id/pdf?questionnaire_id=X — render Acenta-branded PDF za
// specificen (podjetje x vprasalnik) priporocila.
router.get('/companies/:id/pdf', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const qid = parseInt(req.query.questionnaire_id, 10);
  if (!Number.isInteger(qid)) {
    return res.status(400).json({ error: 'missing_questionnaire_id' });
  }

  const r = await dbQuery(`
    SELECT c.naziv_prikaz, cp.vsebina, q.naziv_prikaz AS q_naziv
      FROM companies c, questionnaires q
      LEFT JOIN company_priporocila cp ON cp.company_id = $1 AND cp.questionnaire_id = q.id
     WHERE c.id = $1 AND q.id = $2
  `, [id, qid]);
  if (!r?.rows?.length) return res.status(404).json({ error: 'not_found' });

  const { naziv_prikaz, vsebina, q_naziv } = r.rows[0];
  if (!vsebina) return res.status(400).json({ error: 'no_priporocila_yet' });

  try {
    const pdfBuffer = await renderirajPdf({
      nazivPrikaz: naziv_prikaz,
      prirocila: vsebina,
    });
    if (!pdfBuffer) return res.status(500).json({ error: 'render_failed' });

    const slug = (naziv_prikaz || 'podjetje').toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const qslug = (q_naziv || 'vprasalnik').toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    const ts = new Date().toISOString().slice(0, 10);
    const filename = `${slug}-${qslug}-${ts}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(pdfBuffer);
  } catch (err) {
    console.error('[api/pdf] napaka:', err);
    res.status(500).json({ error: 'render_failed', message: err.message });
  }
});

// DELETE /api/companies/:id — GDPR delete (kaskadno brise responses + company_priporocila)
router.delete('/companies/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const del = await dbQuery(
    'DELETE FROM companies WHERE id = $1 RETURNING id',
    [id]
  );
  if (!del?.rows?.length) return res.status(404).json({ error: 'not_found' });

  res.json({ ok: true, deleted: id });
});

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { router };
