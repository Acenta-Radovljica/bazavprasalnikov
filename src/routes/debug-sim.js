// Zacasna debug ruta za preverjanje pg_trgm similarity-jev.
// Bo odstranjena ko bo AI matching tuninja koncan.
import express from 'express';
import { dbQuery } from '../db.js';
import { generirajPriporocila } from '../ai/generate_priporocila.js';
import { generirajPovzetek } from '../ai/generate_povzetek.js';

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

// Sinhron klic priporocil — za debug. Ce je napaka, vrne stack trace.
router.post('/run-priporocila/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const r = await generirajPriporocila(id);
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

export { router };
