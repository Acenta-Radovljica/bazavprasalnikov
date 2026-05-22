// ── DEL 1: Imports ────────────────────────────────────────────────────────
import express from 'express';
import { dbQuery } from '../db.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const router = express.Router();

// Veljavni tipi vprasanj za "lasten obrazec". Ce admin posuje neveljaven tip,
// vrnemo 400. Bolje ujeti zgodaj kot crash pri renderu.
const VELJAVNI_TIPI = new Set(['text', 'textarea', 'email', 'number', 'select', 'radio', 'checkbox']);

// Slug mora biti URL-friendly: samo male crke, stevilke in vezaji. Min 2 znakov.
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Validira polje "questions" — mora biti array, vsak element objekt s polji:
// id (string), label (string), tip (eden od VELJAVNI_TIPI), obvezno (boolean),
// options (samo za select/radio/checkbox — array stringov).
// Vrne { ok: true } ali { ok: false, error: '...' }.
function validirajQuestions(questions) {
  if (!Array.isArray(questions)) return { ok: false, error: 'questions_not_array' };

  const idi = new Set();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q || typeof q !== 'object') return { ok: false, error: `q[${i}]_not_object` };

    if (typeof q.id !== 'string' || !q.id.trim()) {
      return { ok: false, error: `q[${i}]_missing_id` };
    }
    if (idi.has(q.id)) return { ok: false, error: `q[${i}]_duplicate_id_${q.id}` };
    idi.add(q.id);

    if (typeof q.label !== 'string' || !q.label.trim()) {
      return { ok: false, error: `q[${i}]_missing_label` };
    }
    if (!VELJAVNI_TIPI.has(q.tip)) {
      return { ok: false, error: `q[${i}]_invalid_tip_${q.tip}` };
    }
    if (['select', 'radio', 'checkbox'].includes(q.tip)) {
      if (!Array.isArray(q.options) || q.options.length === 0) {
        return { ok: false, error: `q[${i}]_${q.tip}_needs_options` };
      }
      if (!q.options.every(o => typeof o === 'string' && o.trim())) {
        return { ok: false, error: `q[${i}]_options_must_be_strings` };
      }
    }
  }
  return { ok: true };
}

// Validira slug. Razlog za omejitev: slug gre v URL (/f/:slug + /webhook/:slug)
// in se prikaze v admin UI — zelimo ga vidnega in varnega.
function validirajSlug(slug) {
  if (typeof slug !== 'string') return false;
  return SLUG_REGEX.test(slug);
}

// Vrne podmnozico body polj, ki je dovoljena za INSERT/UPDATE.
// Razlog: SQL injection ni mozen (parametrizirano), ampak zelimo varen subset.
function pripraviPolja(body) {
  return {
    slug: typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : null,
    naziv_prikaz: typeof body.naziv_prikaz === 'string' ? body.naziv_prikaz.trim() : null,
    opis: typeof body.opis === 'string' ? body.opis.trim() : null,
    questions: Array.isArray(body.questions) ? body.questions : [],
    povzetek_system_prompt: typeof body.povzetek_system_prompt === 'string' ? body.povzetek_system_prompt : null,
    povzetek_user_template: typeof body.povzetek_user_template === 'string' ? body.povzetek_user_template : null,
    priporocila_system_prompt: typeof body.priporocila_system_prompt === 'string' ? body.priporocila_system_prompt : null,
    priporocila_user_template: typeof body.priporocila_user_template === 'string' ? body.priporocila_user_template : null,
    aktivna: typeof body.aktivna === 'boolean' ? body.aktivna : true,
  };
}

// ── DEL 4: Rute ───────────────────────────────────────────────────────────

// GET /api/questionnaires — seznam vseh (z metrikami)
router.get('/', async (_req, res) => {
  const r = await dbQuery(`
    SELECT q.id, q.slug, q.naziv_prikaz, q.opis, q.aktivna,
           q.created_at, q.updated_at,
           jsonb_array_length(q.questions) AS st_vprasanj,
           (SELECT count(*) FROM responses r WHERE r.questionnaire_id = q.id)::int AS st_odgovorov,
           (SELECT count(DISTINCT company_id) FROM responses r WHERE r.questionnaire_id = q.id)::int AS st_podjetij
      FROM questionnaires q
     ORDER BY q.aktivna DESC, q.created_at DESC
  `);
  res.json({ questionnaires: r?.rows ?? [] });
});

// GET /api/questionnaires/:id — en vprasalnik (vkljucno z questions JSONB + prompti)
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const r = await dbQuery('SELECT * FROM questionnaires WHERE id = $1', [id]);
  if (!r?.rows?.length) return res.status(404).json({ error: 'not_found' });

  res.json({ questionnaire: r.rows[0] });
});

// POST /api/questionnaires — ustvari nov vprasalnik
router.post('/', async (req, res) => {
  const f = pripraviPolja(req.body || {});

  if (!f.slug || !validirajSlug(f.slug)) {
    return res.status(400).json({ error: 'invalid_slug', detail: 'samo male crke/stevilke/vezaji, 2-50 znakov' });
  }
  if (!f.naziv_prikaz) return res.status(400).json({ error: 'missing_naziv_prikaz' });
  if (!f.povzetek_system_prompt || !f.povzetek_user_template) {
    return res.status(400).json({ error: 'missing_povzetek_prompt' });
  }
  if (!f.priporocila_system_prompt || !f.priporocila_user_template) {
    return res.status(400).json({ error: 'missing_priporocila_prompt' });
  }

  const v = validirajQuestions(f.questions);
  if (!v.ok) return res.status(400).json({ error: 'invalid_questions', detail: v.error });

  try {
    const r = await dbQuery(`
      INSERT INTO questionnaires (
        slug, naziv_prikaz, opis, questions,
        povzetek_system_prompt, povzetek_user_template,
        priporocila_system_prompt, priporocila_user_template,
        aktivna
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, slug, naziv_prikaz, aktivna, created_at
    `, [
      f.slug, f.naziv_prikaz, f.opis, JSON.stringify(f.questions),
      f.povzetek_system_prompt, f.povzetek_user_template,
      f.priporocila_system_prompt, f.priporocila_user_template,
      f.aktivna,
    ]);
    res.status(201).json({ ok: true, questionnaire: r?.rows?.[0] ?? null });
  } catch (err) {
    if (err.code === '23505') {
      // unique_violation — slug ze obstaja
      return res.status(409).json({ error: 'slug_taken', slug: f.slug });
    }
    console.error('[questionnaires] INSERT napaka:', err);
    res.status(500).json({ error: 'db_error', message: err.message });
  }
});

// PATCH /api/questionnaires/:id — posodobi vprasalnik (vse polja opcijska)
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const obstaja = await dbQuery('SELECT id FROM questionnaires WHERE id = $1', [id]);
  if (!obstaja?.rows?.length) return res.status(404).json({ error: 'not_found' });

  // Dinamicni UPDATE — samo polja, ki so podana v body.
  const body = req.body || {};
  const updates = [];
  const params = [];
  let p = 1;

  // Lokalna helper: doda polje v UPDATE samo, ce je v body
  function maybeAdd(field, value) {
    updates.push(`${field} = $${p++}`);
    params.push(value);
  }

  if (typeof body.slug === 'string') {
    const slug = body.slug.trim().toLowerCase();
    if (!validirajSlug(slug)) return res.status(400).json({ error: 'invalid_slug' });
    maybeAdd('slug', slug);
  }
  if (typeof body.naziv_prikaz === 'string') {
    if (!body.naziv_prikaz.trim()) return res.status(400).json({ error: 'empty_naziv_prikaz' });
    maybeAdd('naziv_prikaz', body.naziv_prikaz.trim());
  }
  if (typeof body.opis === 'string') maybeAdd('opis', body.opis.trim());
  if (Array.isArray(body.questions)) {
    const v = validirajQuestions(body.questions);
    if (!v.ok) return res.status(400).json({ error: 'invalid_questions', detail: v.error });
    maybeAdd('questions', JSON.stringify(body.questions));
  }
  if (typeof body.povzetek_system_prompt === 'string') maybeAdd('povzetek_system_prompt', body.povzetek_system_prompt);
  if (typeof body.povzetek_user_template === 'string') maybeAdd('povzetek_user_template', body.povzetek_user_template);
  if (typeof body.priporocila_system_prompt === 'string') maybeAdd('priporocila_system_prompt', body.priporocila_system_prompt);
  if (typeof body.priporocila_user_template === 'string') maybeAdd('priporocila_user_template', body.priporocila_user_template);
  if (typeof body.aktivna === 'boolean') maybeAdd('aktivna', body.aktivna);

  if (updates.length === 0) return res.status(400).json({ error: 'no_fields_to_update' });

  // Vedno bumpamo updated_at
  updates.push(`updated_at = NOW()`);
  params.push(id);

  try {
    const r = await dbQuery(
      `UPDATE questionnaires SET ${updates.join(', ')} WHERE id = $${p} RETURNING id, slug, naziv_prikaz, aktivna, updated_at`,
      params
    );
    res.json({ ok: true, questionnaire: r?.rows?.[0] ?? null });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'slug_taken' });
    }
    console.error('[questionnaires] UPDATE napaka:', err);
    res.status(500).json({ error: 'db_error', message: err.message });
  }
});

// DELETE /api/questionnaires/:id — SOFT delete (aktivna = false).
// Pravi DELETE ni mogoc dokler so povezani responses (FK ON DELETE RESTRICT).
// Razlog: zgodovinske odgovore zelimo ohraniti — vprasalnik samo "ugasnemo".
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const r = await dbQuery(
    'UPDATE questionnaires SET aktivna = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id, slug',
    [id]
  );
  if (!r?.rows?.length) return res.status(404).json({ error: 'not_found' });

  res.json({ ok: true, soft_deleted: r.rows[0] });
});

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { router };
