// ── Katalog Acentinih resitev (migracija 014) ─────────────────────────────
// Kaj Acenta zna narediti in kje to ze deluje. Bere ga prodajni predlog in
// ZIP za Claude; ureja ga clovek na /admin/katalog.html.

// ── DEL 1: Imports ────────────────────────────────────────────────────────
import express from 'express';
import { dbQuery } from '../db.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const router = express.Router();

// Ista resnica kot CHECK v sql/014_katalog_opombe.sql.
const STATUSI = ['produkcija', 'pilot', 'prototip', 'ponudba', 'ideja', 'ustavljeno'];

// Besedilna polja in njihova najvecja dolzina.
const POLJA = { naziv: 200, tezava: 2000, kaj_naredi: 2000, kje: 1000, panoga: 200 };
const MAX_NE_PRIPOROCAMO = 5000;

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Iz telesa vzame samo znana polja. Vrne { polja } ali { error }.
// `nova` = POST: naziv je obvezen; pri PATCH-u se pise samo, kar je poslano.
function preberiPolja(body, nova) {
  const b = body && typeof body === 'object' ? body : {};
  const polja = {};
  for (const [k, max] of Object.entries(POLJA)) {
    if (!(k in b)) continue;
    if (typeof b[k] !== 'string') return { error: `invalid_${k}` };
    polja[k] = b[k].trim().slice(0, max);
  }
  if ('status' in b) {
    if (!STATUSI.includes(b.status)) return { error: 'invalid_status', dovoljeno: STATUSI };
    polja.status = b.status;
  }
  if ('smemo_omeniti' in b) {
    if (typeof b.smemo_omeniti !== 'boolean') return { error: 'invalid_smemo_omeniti' };
    polja.smemo_omeniti = b.smemo_omeniti;
  }
  if ((nova || 'naziv' in polja) && !polja.naziv) return { error: 'missing_naziv' };
  return { polja };
}

// Celoten katalog v obliki, ki jo berejo admin, izvoz in prodajni predlog.
// Vrne null ob napaki baze.
async function naloziKatalog() {
  const [r, n] = await Promise.all([
    dbQuery(`SELECT id, naziv, tezava, kaj_naredi, kje, panoga, status, smemo_omeniti, updated_at
               FROM katalog_resitev
              ORDER BY array_position($1::text[], status), lower(naziv)`, [STATUSI]),
    dbQuery(`SELECT vrednost, updated_at FROM nastavitve WHERE kljuc = 'ne_priporocamo'`),
  ]);
  if (!r || !n) return null;
  return {
    resitve: r.rows,
    ne_priporocamo: n.rows[0]?.vrednost ?? '',
    ne_priporocamo_updated_at: n.rows[0]?.updated_at ?? null,
  };
}

// ── DEL 4: Rute ───────────────────────────────────────────────────────────

// GET /api/katalog — vse resitve + "Cesa ne priporocamo".
router.get('/', async (_req, res) => {
  const k = await naloziKatalog();
  if (!k) return res.status(500).json({ error: 'db_error' });
  res.json({ ...k, statusi: STATUSI });
});

// POST /api/katalog — nova resitev. Obvezen je samo naziv.
router.post('/', async (req, res) => {
  const { polja, error, dovoljeno } = preberiPolja(req.body, true);
  if (error) return res.status(400).json({ error, dovoljeno });

  const kljuci = Object.keys(polja);
  const r = await dbQuery(
    `INSERT INTO katalog_resitev (${kljuci.join(', ')})
     VALUES (${kljuci.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING *`,
    Object.values(polja),
  );
  if (!r) return res.status(500).json({ error: 'db_error' });
  res.status(201).json({ ok: true, resitev: r.rows[0] });
});

// PUT /api/katalog/ne-priporocamo — besedilo "Cesa ne priporocamo".
// Pred /:id, da "ne-priporocamo" ni prebran kot id.
router.put('/ne-priporocamo', async (req, res) => {
  const besedilo = req.body?.besedilo;
  if (typeof besedilo !== 'string') return res.status(400).json({ error: 'invalid_besedilo' });
  const r = await dbQuery(
    `INSERT INTO nastavitve (kljuc, vrednost, updated_at) VALUES ('ne_priporocamo', $1, NOW())
     ON CONFLICT (kljuc) DO UPDATE SET vrednost = EXCLUDED.vrednost, updated_at = NOW()
     RETURNING vrednost, updated_at`,
    [besedilo.trim().slice(0, MAX_NE_PRIPOROCAMO)],
  );
  if (!r) return res.status(500).json({ error: 'db_error' });
  res.json({ ok: true, ne_priporocamo: r.rows[0].vrednost, updated_at: r.rows[0].updated_at });
});

// PATCH /api/katalog/:id — delna sprememba.
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });

  const { polja, error, dovoljeno } = preberiPolja(req.body, false);
  if (error) return res.status(400).json({ error, dovoljeno });
  const kljuci = Object.keys(polja);
  if (!kljuci.length) return res.status(400).json({ error: 'nothing_to_update' });

  const r = await dbQuery(
    `UPDATE katalog_resitev
        SET ${kljuci.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = NOW()
      WHERE id = $${kljuci.length + 1}
      RETURNING *`,
    [...Object.values(polja), id],
  );
  if (!r) return res.status(500).json({ error: 'db_error' });
  if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, resitev: r.rows[0] });
});

// DELETE /api/katalog/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
  const r = await dbQuery('DELETE FROM katalog_resitev WHERE id = $1 RETURNING id', [id]);
  if (!r) return res.status(500).json({ error: 'db_error' });
  if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, deleted: id });
});

// ── DEL 5: Named exports ─────────────────────────────────────────────────
export { router, naloziKatalog, STATUSI };
