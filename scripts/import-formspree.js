// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { argv } from 'node:process';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const API_BASE = 'https://nacrt-api.deploy.acenta.si';
const TOKEN = 'acenta-test-clean';
const DELAY_MS = 1500; // 1.5s med klici da ne zasicimo Haiku rate limit

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// RFC 4180 CSV parser — podpira veckratnih vrstic v navedenicah in escape ""
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++;
    } else {
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += ch; i++;
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

// Vrne true ce vrstica izgleda kot test (filtrira ven)
function jeTestVrstica(rec) {
  const podjetje = (rec['2_podjetje'] || rec.podjetje || '').toLowerCase().trim();
  const email    = (rec['3_email']    || rec.email     || '').toLowerCase().trim();
  if (!podjetje && !email) return true; // brez podjetja in brez emaila — definitvno tezko upraviti

  // Eksplicitne test oznake
  const TEST_PODJETJA = ['test', 'test hotel', 'maks', 'gdgsg'];
  if (TEST_PODJETJA.includes(podjetje)) return true;
  if (podjetje.startsWith('test ')) return true;

  // Test email vzorci
  const TEST_EMAIL_VZORCI = [
    'maks11zager',     // moj testni email
    'test@test.com',   // generic test
    'podpora@acenta',  // Acenta interni
    'matjaz@acenta',   // Acenta interni
    '+test',           // gmail plus-tagging vzorec za test
  ];
  if (TEST_EMAIL_VZORCI.some(v => email.includes(v))) return true;

  // Vsebina ki je ocitno garbage
  const ALL_TEXT = JSON.stringify(rec).toLowerCase();
  if (ALL_TEXT.includes('gdgsg') || ALL_TEXT.includes('etstt')) return true;

  return false;
}

// Klic backend endpointa
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ── DEL 4: Glavna funkcija ────────────────────────────────────────────────

async function main() {
  const csvPath = argv[2];
  const wipe = argv.includes('--wipe');
  const dryRun = argv.includes('--dry-run');

  if (!csvPath) {
    console.error('Uporaba: node scripts/import-formspree.js <pot-do-csv> [--wipe] [--dry-run]');
    process.exit(1);
  }

  console.log(`[import] Berem CSV: ${csvPath}`);
  const text = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) {
    console.error('[import] CSV je prazen ali nima header-ja');
    process.exit(1);
  }

  const header = rows[0];
  const dataRows = rows.slice(1).filter(r => r.length === header.length || r.length === header.length - 1);
  console.log(`[import] Najdenih ${dataRows.length} vrstic podatkov (header: ${header.length} stolpcev)`);

  // Pretvori v objekte
  const records = dataRows.map(r => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = (r[i] || '').trim();
    return obj;
  });

  // Klasificiraj
  const tests = records.filter(jeTestVrstica);
  const real = records.filter(r => !jeTestVrstica(r));

  console.log(`[import] Filtriranje:`);
  console.log(`  - REAL (uvozim): ${real.length}`);
  console.log(`  - TEST (preskocim): ${tests.length}`);
  if (tests.length > 0) {
    console.log(`[import] Preskoceni testi:`);
    for (const t of tests) {
      const p = t['2_podjetje'] || t.podjetje || '(brez)';
      const e = t['3_email'] || t.email || '(brez)';
      console.log(`    - ${t._date} | ${p} | ${e}`);
    }
  }

  console.log(`[import] Real vrstice za uvoz:`);
  for (const r of real) {
    const p = r['2_podjetje'] || r.podjetje || '(brez)';
    const e = r['3_email'] || r.email || '(brez)';
    console.log(`    - ${r._date} | ${p} | ${e}`);
  }

  if (dryRun) {
    console.log('\n[import] --dry-run nacin, ne izvajam dejanskega uvoza. KONEC.');
    return;
  }

  // Wipe?
  if (wipe) {
    console.log('\n[import] WIPE: brisem vse responses + companies...');
    const wipeRes = await postJson(`${API_BASE}/debug/cleanup?token=${TOKEN}`, {});
    if (wipeRes.status !== 200) {
      console.error('[import] Wipe FAILED:', wipeRes.status, wipeRes.data);
      process.exit(1);
    }
    console.log('[import] Wipe OK:', wipeRes.data);
  }

  // Import
  console.log(`\n[import] Zacenjam uvoz ${real.length} vrstic...`);
  let uspeh = 0, napaka = 0;
  for (let i = 0; i < real.length; i++) {
    const rec = real[i];

    // Vsi ne-prazni keys gredo v payload (raw_data ostane verodostojen kopija obrazca)
    const payload = {};
    for (const [k, v] of Object.entries(rec)) {
      if (k.startsWith('_')) continue; // preskoci _date, _status (interni Formspree)
      if (v && v.trim()) payload[k] = v;
    }

    // submitted_at: Formspree daje ISO timestamp v _date (z mikrosekundami)
    let submittedAt = rec._date;
    if (submittedAt && !submittedAt.endsWith('Z')) submittedAt += 'Z';

    const podjetje = rec['2_podjetje'] || rec.podjetje || '';
    const tag = `[${i + 1}/${real.length}]`;

    process.stdout.write(`${tag} ${submittedAt} | "${podjetje}" → `);

    const r = await postJson(
      `${API_BASE}/debug/import?token=${TOKEN}`,
      { payload, submitted_at: submittedAt, podjetje }
    );

    if (r.status === 200 && r.data.ok) {
      console.log(`OK (company=${r.data.companyId}, response=${r.data.responseId}, match=${r.data.matchSource})`);
      uspeh++;
    } else {
      console.log(`NAPAKA: ${r.status} ${JSON.stringify(r.data)}`);
      napaka++;
    }

    if (i < real.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n[import] KONCANO: uspeh=${uspeh}, napaka=${napaka}`);
  console.log(`[import] Haiku povzetki tecejo v ozadju (~10s/vrstica) — preveri /admin/ cez ~${Math.ceil((real.length * 10 + 30) / 60)} min.`);
}

main().catch(err => {
  console.error('[import] FATAL:', err);
  process.exit(1);
});
