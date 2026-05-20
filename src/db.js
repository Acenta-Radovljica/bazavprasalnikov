// ── DEL 1: Imports ────────────────────────────────────────────────────────
import 'dotenv/config';
import pg from 'pg';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const { Pool } = pg;

// Connection pool: max 10 hkratnih povezav (Acenta konvencija).
// Pool sam upravlja povezave — mi samo klicemo query() in on poskrbi.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Globalni handler — ce povezava propade, ne zrusimo aplikacije.
pool.on('error', (err) => {
  console.error('[db] nepricakovana napaka pool povezave:', err.message);
});

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────
// Tanek wrapper okrog pool.query — vrne null na napaki namesto throw
// (Acenta konvencija: nikoli throw iz modula).
async function dbQuery(text, params = []) {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (err) {
    console.error('[db] query napaka:', err.message, '| SQL:', text.slice(0, 100));
    return null;
  }
}

// Preveri, da je povezava na bazo ziva — uporablja se v /health endpointu.
async function dbPing() {
  const res = await dbQuery('SELECT 1 AS ok');
  return res?.rows?.[0]?.ok === 1;
}

// ── DEL 5: Named exports ─────────────────────────────────────────────────
export { dbQuery, dbPing, pool };
