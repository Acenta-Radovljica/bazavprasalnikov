// ── Kopija vprasalnika ob oddaji odgovora ────────────────────────────────
//
// Vprasanja se ob prikazu odgovora ne smejo brati iz vprasalnika, kakrsen je
// danes: ce ga kdo vmes uredi, se stari odgovori prikazejo pod besedili, ki
// jih tisti clovek nikoli ni videl. Zato se ob VSAKI oddaji shrani kopija.
//
// Isto locitev ima process_sessions.questions_snapshot (migracija 009); tu je
// za lead odgovore (migracija 010).

// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';

// ── DEL 2: Helper funkcije ────────────────────────────────────────────────

// Iz ze prebrane vrstice vprasalnika naredi zapis za INSERT.
// Uporabi jo pot, ki vprasalnik ze ima v roki (form.js) — tako se posname
// natanko tista razlicica, proti kateri je bil odgovor preverjen.
function snapshotIzVrstice(vrstica) {
  const questions = Array.isArray(vrstica?.questions) ? vrstica.questions : [];
  const html = typeof vrstica?.custom_html === 'string' ? vrstica.custom_html.trim() : '';
  return {
    questions: JSON.stringify(questions),
    // Prazen niz shranimo kot NULL, da "obrazec nima custom HTML" in "custom
    // HTML je bil prazen" nista videti enako.
    customHtml: html === '' ? null : vrstica.custom_html,
  };
}

// Prebere vprasalnik in vrne isti zapis. Za poti, ki vprasalnika nimajo
// (webhook, simulacija).
//
// ZAKAJ NE VRZE: to se klice tik pred shranjevanjem odgovora. Ce bi neuspesno
// branje snapshota ustavilo shranjevanje, bi zaradi pomozne stvari izgubili
// odgovor stranke. Zato ob napaki vrne prazen snapshot in pusti zapis skozi —
// prazen snapshot vmesnik zna oznaciti, izgubljenega odgovora pa ne zna nihce.
async function snapshotPoId(questionnaireId) {
  const r = await dbQuery(
    'SELECT questions, custom_html FROM questionnaires WHERE id = $1',
    [questionnaireId]
  );
  if (!r?.rows?.length) {
    console.warn(`[snapshot] vprasalnika ${questionnaireId} ni bilo mogoce prebrati; odgovor se shrani brez kopije`);
    return { questions: '[]', customHtml: null };
  }
  return snapshotIzVrstice(r.rows[0]);
}

// ── DEL 3: Named exports ─────────────────────────────────────────────────
export { snapshotIzVrstice, snapshotPoId };
