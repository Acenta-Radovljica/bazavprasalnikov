// ── DEL 1: Imports ────────────────────────────────────────────────────────
import 'dotenv/config';
import express from 'express';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dbPing, pool } from './db.js';
import { router as webhookRouter } from './routes/webhook.js';

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

// Root — samo info string
app.get('/', (_req, res) => {
  res.json({
    service: 'bazavprasalnikov-api',
    agency: 'Acenta.si',
    routes: ['/health', 'POST /webhook/formspree'],
  });
});

// Webhook ruta (javna, brez auth)
app.use('/webhook', webhookRouter);

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
