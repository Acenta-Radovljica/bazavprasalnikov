// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { klicHaiku } from './claude.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
// Kvalifikacija je enotna ocenjevalna lestvica (ne vsebinski prompt kot
// povzetek/priporocila), zato je prompt hardkodiran tu — isti za vsak
// lead-vprasalnik. Dovoljene vrednosti morajo ujemati CHECK v migraciji 005.
const DOVOLJENE = ['hot', 'warm', 'cold'];

const SYSTEM_PROMPT = `Si analitik prodajnih leadov za digitalno agencijo Acenta.si.
Na podlagi odgovorov potencialne stranke iz vprasalnika oceni, kako "vroc" je lead za prodajo.

Vrni IZKLJUCNO veljaven JSON brez kakrsnegakoli dodatnega besedila ali markdown ograje, v obliki:
{"kvalifikacija": "hot", "razlog": "kratko pojasnilo v slovenscini"}

Pomen ocen:
- "hot"  = jasna bolecina/potreba + signal proracuna ali nujnosti + odlocevalec ali blizu njega
- "warm" = realno zanimanje, a manjka eden od: proracun, nujnost, pooblastilo za odlocitev
- "cold" = nejasna potreba, samo raziskovanje, brez signala za nakup

Polje "razlog" naj bo 1-2 stavka, konkretno (sklicuj se na odgovore, ne splosno).`;

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Sestavi citljiv blok enega respondenta — povzetek ce obstaja, sicer surovi
// odgovori. Isti pristop kot generate_priporocila.js (povzetek morda se ni gotov).
function formatirajRespondenta(idx, raw, povzetek) {
  const lines = [`--- Respondent ${idx + 1} ---`];
  if (povzetek) {
    lines.push('POVZETEK:');
    lines.push(povzetek);
  } else {
    lines.push('SUROVI ODGOVORI:');
    const keys = Object.keys(raw || {}).sort();
    for (const k of keys) {
      if (k.startsWith('_') || k === 'gdpr_consent') continue;
      const v = raw[k];
      if (v === null || v === undefined || v === '') continue;
      lines.push(`  ${k}: ${String(v).trim()}`);
    }
  }
  return lines.join('\n');
}

// Varno izlusci JSON iz Haiku odgovora. Haiku vcasih ovije v ```json ... ```
// ali doda uvodni stavek — zato vzamemo podniz od prvega { do zadnjega }.
// Vrne validiran objekt {kvalifikacija, razlog} ali null.
function parsajKvalifikacijo(text) {
  if (!text || typeof text !== 'string') return null;

  const zacetek = text.indexOf('{');
  const konec = text.lastIndexOf('}');
  if (zacetek === -1 || konec === -1 || konec <= zacetek) return null;

  let obj;
  try {
    obj = JSON.parse(text.slice(zacetek, konec + 1));
  } catch {
    return null;
  }

  const k = String(obj.kvalifikacija || '').toLowerCase().trim();
  if (!DOVOLJENE.includes(k)) return null;

  const razlog = String(obj.razlog || '').trim();
  return { kvalifikacija: k, razlog };
}

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────

// Samodejno oceni podjetje (hot/warm/cold) na podlagi odgovorov za en
// lead-vprasalnik. Vrata: ce vprasalnik ni lead (je_lead_vprasalnik=FALSE),
// takoj vrne null. Varovalka: NE prepise rocne ocene (kvalifikacija_rocna=TRUE).
// Vrne {kvalifikacija, razlog} ali null.
async function generirajKvalifikacija(companyId, questionnaireId) {
  if (!companyId || !questionnaireId) return null;

  // Naloži podjetje + vprasalnik. je_lead_vprasalnik so vrata — samo lead
  // vprasalniki sprozijo AI oceno (varovalka iz migracije 005).
  const meta = await dbQuery(`
    SELECT c.naziv_prikaz, q.je_lead_vprasalnik
      FROM companies c, questionnaires q
     WHERE c.id = $1 AND q.id = $2
  `, [companyId, questionnaireId]);
  if (!meta?.rows?.length) {
    console.warn(`[kvalifikacija] company=${companyId} ali questionnaire=${questionnaireId} ne obstaja`);
    return null;
  }
  if (!meta.rows[0].je_lead_vprasalnik) {
    // Tih izhod — to je pricakovano za ne-lead vprasalnike (moj-ai-nacrt, pred-delavnico).
    return null;
  }
  const naziv = meta.rows[0].naziv_prikaz;

  // Vsi odgovori tega podjetja za ta lead-vprasalnik (polna slika leada).
  const r = await dbQuery(
    `SELECT raw_data, ai_povzetek
       FROM responses
      WHERE company_id = $1 AND questionnaire_id = $2
      ORDER BY submitted_at ASC`,
    [companyId, questionnaireId]
  );
  const respondenti = r?.rows ?? [];
  if (respondenti.length === 0) {
    console.warn(`[kvalifikacija] ni respondentov za company=${companyId} q=${questionnaireId}`);
    return null;
  }

  const respondentiBlok = respondenti
    .map((row, i) => formatirajRespondenta(i, row.raw_data, row.ai_povzetek))
    .join('\n\n');

  const user = `Podjetje: ${naziv}
Stevilo respondentov: ${respondenti.length}

Odgovori:
${respondentiBlok}

Vrni samo JSON z ocenama "kvalifikacija" in "razlog".`;

  // Majhen output (kratek JSON) — 300 tokenov je dovolj.
  const odgovor = await klicHaiku({ system: SYSTEM_PROMPT, user, maxTokens: 300 });
  const ocena = parsajKvalifikacijo(odgovor);
  if (!ocena) {
    console.warn(`[kvalifikacija] AI ni vrnil veljavnega JSON-a za company=${companyId} q=${questionnaireId}`);
    return null;
  }

  // Varovalka: kvalifikacija_rocna=TRUE pomeni, da je clovek rocno ocenil —
  // AI tega NE prepise. Pogoj v WHERE je atomaren (brez race condition-a).
  const upd = await dbQuery(`
    UPDATE companies
       SET kvalifikacija = $1,
           kvalifikacija_razlog = $2,
           kvalifikacija_updated_at = NOW()
     WHERE id = $3 AND kvalifikacija_rocna = FALSE
     RETURNING id
  `, [ocena.kvalifikacija, ocena.razlog, companyId]);

  if (!upd?.rows?.length) {
    console.log(`[kvalifikacija] preskoceno company=${companyId} — rocna ocena obstaja (ne prepisem)`);
    return null;
  }

  console.log(`[kvalifikacija] OK company=${companyId} q=${questionnaireId} → ${ocena.kvalifikacija}`);
  return ocena;
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { generirajKvalifikacija };
