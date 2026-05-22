// ── DEL 1: Imports ────────────────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dbPing, pool } from './db.js';
import { router as webhookRouter } from './routes/webhook.js';
import { router as debugSimRouter } from './routes/debug-sim.js';
import { router as apiRouter } from './routes/api.js';
import { router as questionnairesRouter } from './routes/questionnaires.js';
import { router as formRouter } from './routes/form.js';
import { basicAuth } from './middleware/auth.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const app = express();

// Express prebere JSON body do 1 MB. Formspree posilja max ~50 KB,
// 1 MB je varna meja proti DoS s prevelikimi payloadi.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Trust proxy: Dokploy Traefik je pred nami, x-forwarded-for je verodostojen.
app.set('trust proxy', 1);

// ── DEL 4: Rute ───────────────────────────────────────────────────────────

// Health check — Dokploy ga klice za preverjanje, ali app dela.
app.get('/health', async (_req, res) => {
  const dbOk = await dbPing();
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    service: 'bazavprasalnikov-api',
    db: dbOk ? 'up' : 'down',
    time: new Date().toISOString(),
  });
});

// Root — preusmeri na trenutni privzeti vprasalnik.
// QR koda v PPT za delavnico (Art hotel Kristal, Acenta_AI_Delavnica.pptx)
// kaze na http://nacrt.deploy.acenta.si — uporabnik mora pristati na obrazcu,
// ne na JSON debug izhodu. Slug je nastavljiv prek ENV (ROOT_REDIRECT_SLUG),
// fallback "moj-ai-nacrt" za backward compat z ze natisnjeno QR kodo.
// 302 (temporary) — da lahko spremenimo target brez browser cache problemov.
// API meta info je se vedno dostopen na /health (vsebuje servis info + db status).
app.get('/', (_req, res) => {
  const slug = (process.env.ROOT_REDIRECT_SLUG || 'moj-ai-nacrt').trim().toLowerCase();
  res.redirect(302, `/f/${encodeURIComponent(slug)}`);
});

// Webhook ruta (javna, brez auth)
app.use('/webhook', webhookRouter);

// Lasten obrazec — javni (brez auth). GET renderira HTML, POST sprejme submission.
app.use('/f', formRouter);

// Zacasna debug ruta za tuninje similarity pragov
app.use('/debug', debugSimRouter);

// Admin API — zascitena z basic auth.
// Questionnaires CRUD je pred apiRouter-jem mountan na /api/questionnaires,
// da ne kolidiraj z /api/companies/:id (kjer :id lahko biti "questionnaires").
app.use('/api/questionnaires', basicAuth, questionnairesRouter);
app.use('/api', basicAuth, apiRouter);

// Admin UI — staticne HTML strani, prav tako za basic auth.
// Brskalnik bo zahteval login pri prvem obisku, nato cache-a.
const __filename = fileURLToPath(import.meta.url);
const __dirnameSrv = dirname(__filename);
app.use('/admin', basicAuth, express.static(join(__dirnameSrv, '..', 'public', 'admin')));

// Javno dostopni branding assets (logo) za form, hvala stran, info strani.
// Brez basic auth — namenoma, ker so klienti, ki vidijo obrazec, nepooblasceni.
app.use('/assets', express.static(join(__dirnameSrv, '..', 'assets'), {
  maxAge: '7d',  // logo se ne spreminja pogosto — cache za 7 dni
}));

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

// Globalni error handler (zaloga, ce kaj uide)
app.use((err, _req, res, _next) => {
  console.error('[server] nepricakovana napaka:', err);
  res.status(500).json({ error: 'server_error' });
});

// ── DEL 6: Start ──────────────────────────────────────────────────────────

// Auto-migracija ob zagonu. Vsi SQL-i so idempotentni (CREATE TABLE IF NOT EXISTS),
// zato je varno klicati ob vsakem deployu. Ce baza se ni pripravljena, retry 5x.
async function runMigracije() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sqlDir = join(__dirname, '..', 'sql');

  let files;
  try {
    files = (await readdir(sqlDir)).filter(f => f.endsWith('.sql')).sort();
  } catch (err) {
    console.log('[migrate] ni mape sql/, preskocim:', err.message);
    return;
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    const ok = await dbPing();
    if (ok) break;
    console.log(`[migrate] baza se ni pripravljena (poskus ${attempt}/5), pocakam 3s...`);
    await new Promise(r => setTimeout(r, 3000));
  }

  for (const file of files) {
    const sql = await readFile(join(sqlDir, file), 'utf-8');
    try {
      await pool.query(sql);
      console.log(`[migrate] ${file} OK`);
    } catch (err) {
      console.error(`[migrate] ${file} NAPAKA:`, err.message);
    }
  }
}

await runMigracije();

app.listen(PORT, () => {
  console.log(`[server] bazavprasalnikov-api posluša na portu ${PORT}`);
});
