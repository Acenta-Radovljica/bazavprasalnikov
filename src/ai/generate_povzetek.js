// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { klicHaiku } from './claude.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const SYSTEM_PROMPT =
  'Si asistent agencije Acenta.si. Tvoja naloga je iz vprašalnika delavnice "Moj AI načrt" izlušciti ' +
  'kratek 5-tockovni povzetek v slovenščini. Bodi konkreten, ne dodajaj fraz tipa "ekipa je zelo predana".';

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Pretvori raw_data JSONB v lep čitljiv blok za Claude.
// raw_data ima kljuce kot "1_ime", "2_podjetje", "3_email", "4_panoga" itd.
function formatirajPodatke(rawData) {
  if (!rawData || typeof rawData !== 'object') return '(prazno)';

  // Sortiraj po stevilski predponi (1_, 2_, 3_...) ce obstaja
  const keys = Object.keys(rawData).sort();
  const lines = [];
  for (const k of keys) {
    // Preskoci tehnicna polja Formspree
    if (k.startsWith('_') || k === 'gdpr_consent') continue;
    const v = rawData[k];
    if (v === null || v === undefined || v === '') continue;
    lines.push(`${k}: ${String(v).trim()}`);
  }
  return lines.join('\n');
}

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────

// Generira povzetek za en response. Idempotentno — ce je ze povzetek,
// se prepise. Vrne string povzetek ali null.
async function generirajPovzetek(responseId) {
  if (!responseId) return null;

  // Naloži response iz baze
  const r = await dbQuery(
    'SELECT id, raw_data FROM responses WHERE id = $1',
    [responseId]
  );
  if (!r?.rows?.length) {
    console.warn(`[povzetek] response ${responseId} ne obstaja`);
    return null;
  }

  const podatki = formatirajPodatke(r.rows[0].raw_data);

  const user =
    `Tu so odgovori na vprasalnik:\n\n${podatki}\n\n` +
    `Napisi povzetek v TOCNO 5 tockah v slovenscini:\n` +
    `1. KDO so (oseba + podjetje, panoga)\n` +
    `2. KAJ pocnejo / kaksen je njihov posel\n` +
    `3. KJE vidijo AI priloznosti\n` +
    `4. KATERE OVIRE jih zaustavljajo (cas, znanje, denar, varnost)\n` +
    `5. KAJ so njihove PRIORITETE (1-2 konkretni stvari)\n\n` +
    `Brez uvoda, samo 5 tock. Vsaka tocka <30 besed.`;

  const povzetek = await klicHaiku({ system: SYSTEM_PROMPT, user, maxTokens: 600 });
  if (!povzetek) {
    console.warn(`[povzetek] AI ni vrnil odgovora za response=${responseId}`);
    return null;
  }

  // Shrani v bazo
  await dbQuery(
    'UPDATE responses SET ai_povzetek = $1, ai_processed_at = NOW() WHERE id = $2',
    [povzetek, responseId]
  );

  console.log(`[povzetek] OK response=${responseId} (${povzetek.length} znakov)`);
  return povzetek;
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { generirajPovzetek };
