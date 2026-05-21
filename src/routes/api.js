// ── DEL 1: Imports ────────────────────────────────────────────────────────
import express from 'express';
import { dbQuery } from '../db.js';
import { generirajPovzetek } from '../ai/generate_povzetek.js';
import { generirajPriporocila } from '../ai/generate_priporocila.js';
import { sproziPovzetek, sproziPriporocila } from '../ai/queue.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const router = express.Router();

// ── DEL 4: Rute ───────────────────────────────────────────────────────────

// GET /api/companies — seznam vseh podjetij z metriko
// Vraca: id, naziv_prikaz, st_odgovorov, last_response_at, has_priporocila
router.get('/companies', async (_req, res) => {
  const r = await dbQuery(`
    SELECT
      c.id, c.naziv_prikaz, c.naziv_normaliziran,
      c.created_at, c.last_response_at,
      (c.ai_priporocila IS NOT NULL) AS has_priporocila,
      c.ai_priporocila_updated_at,
      COUNT(r.id)::int AS st_odgovorov,
      MAX(r.submitted_at) AS zadnji_odgovor
    FROM companies c
    LEFT JOIN responses r ON r.company_id = c.id
    GROUP BY c.id
    ORDER BY COALESCE(MAX(r.submitted_at), c.created_at) DESC
  `);
  res.json({ companies: r?.rows ?? [] });
});

// GET /api/companies/:id — eno podjetje + vsi odgovori + AI priporocila
router.get('/companies/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const company = await dbQuery('SELECT * FROM companies WHERE id = $1', [id]);
  if (!company?.rows?.length) return res.status(404).json({ error: 'not_found' });

  const responses = await dbQuery(
    `SELECT id, submitted_at, raw_data, ai_povzetek, ai_processed_at, consent_gdpr
       FROM responses
      WHERE company_id = $1
      ORDER BY submitted_at DESC`,
    [id]
  );

  res.json({
    company: company.rows[0],
    responses: responses?.rows ?? [],
  });
});

// GET /api/responses/:id — en odgovor + AI povzetek + company info
router.get('/responses/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const r = await dbQuery(`
    SELECT r.*, c.naziv_prikaz, c.id AS company_id_full
      FROM responses r
      JOIN companies c ON c.id = r.company_id
     WHERE r.id = $1
  `, [id]);
  if (!r?.rows?.length) return res.status(404).json({ error: 'not_found' });

  res.json({ response: r.rows[0] });
});

// POST /api/companies/:id/regenerate-ai — rocno sprozi AI priporocila
// Body: { mode: "priporocila" | "vsi_povzetki" | "vse" } (default: "priporocila")
router.post('/companies/:id/regenerate-ai', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const mode = req.body?.mode ?? 'priporocila';

  // Preveri, da podjetje obstaja
  const c = await dbQuery('SELECT id FROM companies WHERE id = $1', [id]);
  if (!c?.rows?.length) return res.status(404).json({ error: 'not_found' });

  if (mode === 'vsi_povzetki' || mode === 'vse') {
    // Najprej regeneriraj povzetke za vse responses tega podjetja (async)
    const responses = await dbQuery(
      'SELECT id FROM responses WHERE company_id = $1',
      [id]
    );
    for (const row of (responses?.rows ?? [])) {
      sproziPovzetek(row.id);
    }
  }

  // Sprozi priporocila (debounce 60s — admin lahko klika veckrat brez teze)
  sproziPriporocila(id);

  res.json({ ok: true, mode, queued_at: new Date().toISOString() });
});

// POST /api/companies/:id/merge — zlij dve podjetji
// Body: { target_id: <id v katerega zlijemo source> }
// Razlog: AI matching ni 100% — admin mora imeti rocni fallback.
router.post('/companies/:id/merge', async (req, res) => {
  const sourceId = parseInt(req.params.id, 10);
  const targetId = parseInt(req.body?.target_id, 10);
  if (!Number.isInteger(sourceId) || !Number.isInteger(targetId)) {
    return res.status(400).json({ error: 'invalid_ids' });
  }
  if (sourceId === targetId) {
    return res.status(400).json({ error: 'same_id' });
  }

  // Preveri, da oba obstajata
  const check = await dbQuery(
    'SELECT id FROM companies WHERE id = ANY($1::int[])',
    [[sourceId, targetId]]
  );
  if ((check?.rows?.length ?? 0) !== 2) {
    return res.status(404).json({ error: 'one_or_both_missing' });
  }

  // Premakni vse responses iz source na target
  const moved = await dbQuery(
    'UPDATE responses SET company_id = $1 WHERE company_id = $2 RETURNING id',
    [targetId, sourceId]
  );

  // Izbrisi source company
  await dbQuery('DELETE FROM companies WHERE id = $1', [sourceId]);

  // Posodobi last_response_at na target
  await dbQuery(
    `UPDATE companies SET last_response_at = (
       SELECT MAX(submitted_at) FROM responses WHERE company_id = $1
     ) WHERE id = $1`,
    [targetId]
  );

  // Re-generate priporocila za target (debounced)
  sproziPriporocila(targetId);

  res.json({
    ok: true,
    moved_responses: moved?.rows?.length ?? 0,
    deleted_company: sourceId,
    merged_into: targetId,
  });
});

// GET /api/stats — agregacije za dashboard (totals + timeline)
router.get('/stats', async (_req, res) => {
  // Skupne vrednosti
  const totals = await dbQuery(`
    SELECT
      (SELECT count(*) FROM companies)::int AS podjetja_total,
      (SELECT count(*) FROM responses)::int AS odgovori_total,
      (SELECT count(*) FROM companies WHERE ai_priporocila IS NULL)::int AS brez_priporocil,
      (SELECT count(*) FROM responses WHERE submitted_at > NOW() - INTERVAL '7 days')::int AS odgovori_7d,
      (SELECT count(*) FROM responses WHERE submitted_at > NOW() - INTERVAL '14 days' AND submitted_at <= NOW() - INTERVAL '7 days')::int AS odgovori_prej_7d,
      (SELECT count(*) FROM companies WHERE created_at > NOW() - INTERVAL '7 days')::int AS podjetja_7d,
      (SELECT count(*) FROM companies WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days')::int AS podjetja_prej_7d
  `);

  // Zastarela = podjetje ima priporocila, ampak je nov response prisel po generaciji
  const zastarela = await dbQuery(`
    SELECT count(*)::int AS n FROM companies
     WHERE ai_priporocila IS NOT NULL
       AND last_response_at > ai_priporocila_updated_at
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

// GET /api/search?q=... — polnotekstovno iskanje
router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json({ results: [] });

  // Uporabimo idx_responses_search GIN indeks (tsvector)
  const r = await dbQuery(`
    SELECT
      r.id AS response_id,
      r.company_id,
      c.naziv_prikaz,
      r.submitted_at,
      ts_headline('simple',
        coalesce(r.raw_data::text, '') || ' ' || coalesce(r.ai_povzetek, ''),
        plainto_tsquery('simple', $1),
        'MaxFragments=2, MaxWords=20'
      ) AS highlight
    FROM responses r
    JOIN companies c ON c.id = r.company_id
    WHERE to_tsvector('simple', coalesce(r.raw_data::text, '') || ' ' || coalesce(r.ai_povzetek, ''))
          @@ plainto_tsquery('simple', $1)
    ORDER BY r.submitted_at DESC
    LIMIT 50
  `, [q]);

  res.json({ query: q, results: r?.rows ?? [] });
});

// DELETE /api/companies/:id — GDPR delete (kaskadno brise responses)
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
