// ── DEL 1: Imports ────────────────────────────────────────────────────────
import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(__dirname, '..', 'sql');

// ── DEL 4: Glavna funkcija ────────────────────────────────────────────────
// Zazene vse .sql datoteke iz mape sql/ po abecednem vrstnem redu.
// Postgres mora biti DOSEGLJIV — drugace skripta crkne.
async function migrate() {
  console.log('[migrate] iscem SQL datoteke v:', SQL_DIR);
  const files = (await readdir(SQL_DIR)).filter(f => f.endsWith('.sql')).sort();

  if (files.length === 0) {
    console.log('[migrate] ni SQL datotek — koncam');
    process.exit(0);
  }

  for (const file of files) {
    const path = join(SQL_DIR, file);
    const sql = await readFile(path, 'utf-8');
    console.log(`[migrate] ${file} ...`);
    try {
      await pool.query(sql);
      console.log(`[migrate] ${file} OK`);
    } catch (err) {
      console.error(`[migrate] ${file} NAPAKA:`, err.message);
      process.exit(1);
    }
  }

  console.log('[migrate] vse migracije uspesno koncane');
  await pool.end();
  process.exit(0);
}

migrate();
