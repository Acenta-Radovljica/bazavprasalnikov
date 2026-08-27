// ── DEL 1: Imports ────────────────────────────────────────────────────────
import 'dotenv/config';
import pg from 'pg';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const { Pool } = pg;

// DATE (OID 1082) beri kot NIZ, ne kot Date.
//
// ZAKAJ: pg privzeto pretvori DATE v JS Date ob LOKALNI polnoci. Express ga
// nato serializira prek toISOString(), torej v UTC — pri slovenskem +02:00
// se "2026-08-24" v odzivu pojavi kot "2026-08-23T22:00:00.000Z". Datum
// sestanka je zato v vmesniku kazal dan prej kot vpisani.
// Ker DATE nikoli nima casa in ne pripada nobenemu casovnemu pasu, je edini
// pravilen prenos gol niz "YYYY-MM-DD", tako kot je v bazi.
// (Casovni zigi TIMESTAMPTZ te tezave nimajo in jih ne diramo.)
pg.types.setTypeParser(1082, (v) => v);

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
