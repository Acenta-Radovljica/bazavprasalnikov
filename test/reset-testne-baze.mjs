// Ponastavi testno bazo na stanje takoj po migracijah.
// Namen: oba testna nabora (e2e.mjs, ui-test.mjs) mocno predpostavljata
// izhodisce (stevilo sej, stevilo vprasanj v predlogi). Brez ponastavitve
// drugi zagon meri smeti prvega — kar me je danes ze enkrat ujelo.
import pg from 'pg';
import { readFileSync } from 'node:fs';

const SQL_009 = new URL('../sql/009_procesi.sql', import.meta.url);

const pool = new pg.Pool({ connectionString: 'postgres://postgres:test@127.0.0.1:5435/vprasalniki' });

// 1. Pobrisi vse procesne podatke (transkripti in emaili gredo kaskadno).
await pool.query('TRUNCATE process_sessions RESTART IDENTITY CASCADE');

// 2. Vrni predlogo na seedano stanje. E2E ji med testom doda vprasanje,
//    zato bi drugi zagon startal z 52 namesto 51.
await pool.query(`DELETE FROM questionnaires WHERE namen = 'proces'`);
await pool.query(readFileSync(SQL_009, 'utf-8'));

// 3. Pobrisi vprasalnike, ki jih ustvarijo testi (test/odgovori.test.mjs).
//    Brez tega procesi-api.test.mjs pade na trditvi "vseh vprasalnikov 5",
//    ker jih po vsakem zagonu ostane dva vec. Odgovore je treba pobrisati
//    prve zaradi tujega kljuca.
await pool.query(`DELETE FROM responses WHERE questionnaire_id IN
  (SELECT id FROM questionnaires WHERE slug LIKE 'test-snapshot-%')`);
await pool.query(`DELETE FROM questionnaires WHERE slug LIKE 'test-snapshot-%'`);

const r = await pool.query(`
  SELECT (SELECT count(*) FROM process_sessions)::int AS sej,
         (SELECT count(*) FROM process_transcripts)::int AS transkriptov,
         (SELECT count(*) FROM process_emails)::int AS emailov,
         (SELECT jsonb_array_length(questions) FROM questionnaires WHERE namen='proces')::int AS vprasanj_v_predlogi,
         (SELECT count(*) FROM questionnaires WHERE namen='lead')::int AS lead_vprasalnikov,
         (SELECT count(*) FROM responses)::int AS odgovorov`);
console.log('ponastavljeno:', JSON.stringify(r.rows[0]));
await pool.end();
