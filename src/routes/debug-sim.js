// Zacasna debug ruta za preverjanje pg_trgm similarity-jev.
// Bo odstranjena ko bo AI matching tuninja koncan.
import express from 'express';
import { dbQuery } from '../db.js';

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

export { router };
