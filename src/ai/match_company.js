// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { normalizirajNaziv } from '../utils/normalize.js';
import { klicHaiku } from './claude.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
// Pragovi za matching. Kombiniramo dve metriki:
// - pg_trgm similarity (0.0 = razlicno, 1.0 = identicno) — dobro za daljse fraze
// - Levenshtein distance (stevilo sprememb znakov) — dobro za enoznakovne typo-e
const PRAG_TRGM_AVTO  = 0.85;  // pg_trgm: nad tem avto-zlij
const LEV_AVTO        = 2;     // levenshtein: <=2 spremembi avto-zlij (npr. "Cubo" vs "Kubo")
const PRAG_TRGM_AI    = 0.20;  // pg_trgm: nad tem vprasaj AI
const LEV_AI          = 4;     // levenshtein: <=4 spremembi vprasaj AI

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Najde top 5 podjetij, kjer JE pg_trgm similarity > 0.2 ALI Levenshtein <= 4.
// Razlog za OR: "kubo" vs "cubo" ima sim=0.25 (komaj) ampak lev=1 (jasno typo) —
// pg_trgm sam tega ne ujame zanesljivo pri kratkih besedah.
async function najdiKandidate(normIme) {
  const res = await dbQuery(
    `SELECT id, naziv_prikaz, naziv_normaliziran,
            similarity(naziv_normaliziran, $1) AS sim,
            levenshtein(naziv_normaliziran, $1) AS lev
       FROM companies
      WHERE similarity(naziv_normaliziran, $1) > $2
         OR levenshtein(naziv_normaliziran, $1) <= $3
      ORDER BY sim DESC, lev ASC
      LIMIT 5`,
    [normIme, PRAG_TRGM_AI, LEV_AI]
  );
  return res?.rows ?? [];
}

// Vprasa Claude Haiku ali je novo ime ujema z enim od kandidatov.
// Vrne id kandidata ali null.
async function vprasajAI(noviNaziv, kandidati) {
  const kandidatiOpis = kandidati.map(k => `  - id=${k.id}: "${k.naziv_prikaz}"`).join('\n');

  const system =
    'Si pomocnik agencije Acenta.si, ki preverja, ali sta dve imeni podjetij ista entiteta. ' +
    'Odgovori SAMO z veljavnim JSON-om, brez komentarjev: ' +
    '{"match_id": <id ali null>}.';

  const user =
    `Novo podjetje iz obrazca: "${noviNaziv}"\n\n` +
    `Ali se ujema z enim od teh obstojecih podjetij?\n${kandidatiOpis}\n\n` +
    `Pravila:\n` +
    `- "Hotel Cubo" in "Cubo Hotel" sta ISTA (samo razlicen vrstni red).\n` +
    `- "Hotel Cubo" in "Hotel Cubo d.o.o." sta ISTA.\n` +
    `- "Hotel Bled" in "Bled Rose Hotel" sta RAZLICNA (Bled je mesto, ne ime hotela).\n` +
    `- Ce nisi preprican, vrni null.\n\n` +
    `Odgovor (JSON):`;

  const odgovor = await klicHaiku({ system, user, maxTokens: 100 });
  if (!odgovor) return null;

  try {
    // Claude lahko vrne markdown code block ali surov JSON
    const cisto = odgovor.replace(/```json\s*|\s*```/g, '').trim();
    const parsed = JSON.parse(cisto);
    const matchId = parsed?.match_id;
    if (matchId && Number.isInteger(matchId)) {
      // Preveri, da id res obstaja med kandidati (varnost: Claude lahko izmisli)
      const obstaja = kandidati.find(k => k.id === matchId);
      if (obstaja) return matchId;
    }
    return null;
  } catch (err) {
    console.warn('[match_company] AI ni vrnil veljavnega JSON:', odgovor.slice(0, 100));
    return null;
  }
}

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────

// Vrne { companyId, source }. source je 'exact' | 'fuzzy_auto' | 'ai' | 'created'.
// source je koristen za logging in debug — vemo, kateri korak je dal rezultat.
async function najdiPodjetjeAI(nazivPrikaz) {
  if (!nazivPrikaz || typeof nazivPrikaz !== 'string') return null;

  const norm = normalizirajNaziv(nazivPrikaz);
  if (!norm) return null;

  // 1) Exact match na normaliziran naziv
  const exact = await dbQuery(
    'SELECT id FROM companies WHERE naziv_normaliziran = $1',
    [norm]
  );
  if (exact?.rows?.length > 0) {
    return { companyId: exact.rows[0].id, source: 'exact' };
  }

  // 2) Fuzzy match preko pg_trgm + Levenshtein
  const kandidati = await najdiKandidate(norm);

  // 2a) En kandidat z visoko similarity ALI majhno Levenshtein → avto-zlij brez AI
  if (kandidati.length === 1) {
    const k = kandidati[0];
    if (k.sim >= PRAG_TRGM_AVTO || k.lev <= LEV_AVTO) {
      console.log(`[match] fuzzy_auto: "${nazivPrikaz}" → id=${k.id} sim=${k.sim.toFixed(2)} lev=${k.lev}`);
      return { companyId: k.id, source: 'fuzzy_auto' };
    }
  }

  // 2b) Vec kandidatov ALI en sumljiv → AI razresi
  if (kandidati.length > 0) {
    const aiMatch = await vprasajAI(nazivPrikaz, kandidati);
    if (aiMatch) {
      console.log(`[match] ai: "${nazivPrikaz}" → id=${aiMatch}`);
      return { companyId: aiMatch, source: 'ai' };
    }
  }

  // 3) Novo podjetje
  const created = await dbQuery(
    `INSERT INTO companies (naziv_normaliziran, naziv_prikaz)
     VALUES ($1, $2)
     ON CONFLICT (naziv_normaliziran) DO UPDATE SET naziv_prikaz = EXCLUDED.naziv_prikaz
     RETURNING id`,
    [norm, nazivPrikaz]
  );
  const newId = created?.rows?.[0]?.id;
  if (!newId) return null;

  console.log(`[match] created: "${nazivPrikaz}" → id=${newId}`);
  return { companyId: newId, source: 'created' };
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { najdiPodjetjeAI };
