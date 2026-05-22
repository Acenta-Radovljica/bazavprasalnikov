// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { klicOpus } from './claude.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
// Prompti se nalozijo iz questionnaires (per slug/id). Priporocila se shranijo
// v company_priporocila (UPSERT po company_id × questionnaire_id) — eno podjetje
// ima lahko priporocila za vec razlicnih vprasalnikov hkrati.

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

function formatirajRespondenta(idx, raw, povzetek) {
  const lines = [`--- Respondent ${idx + 1} ---`];
  if (povzetek) {
    lines.push('POVZETEK:');
    lines.push(povzetek);
  } else {
    // Fallback ce povzetek se ni narejen
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

function uporabiTemplate(template, vars) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────

// Generira priporocila za en (company × questionnaire). Idempotentno — ce že
// obstajajo, se prepisejo (UPSERT). Bere prompte iz questionnaires, responses
// pa filtrira po questionnaire_id, da Opus ne meša odgovorov iz različnih
// vprašalnikov v eno priporocilo.
async function generirajPriporocila(companyId, questionnaireId) {
  if (!companyId || !questionnaireId) return null;

  // Naloži podjetje + vprasalnik (prompt + template)
  const meta = await dbQuery(`
    SELECT c.naziv_prikaz,
           q.priporocila_system_prompt, q.priporocila_user_template
      FROM companies c, questionnaires q
     WHERE c.id = $1 AND q.id = $2
  `, [companyId, questionnaireId]);
  if (!meta?.rows?.length) {
    console.warn(`[priporocila] company=${companyId} ali questionnaire=${questionnaireId} ne obstaja`);
    return null;
  }
  const { naziv_prikaz: naziv, priporocila_system_prompt: system, priporocila_user_template: tpl } = meta.rows[0];

  // Naloži responses + povzetke samo za ta vprasalnik (ne mesaj odgovorov iz drugih vprasalnikov)
  const r = await dbQuery(
    `SELECT id, raw_data, ai_povzetek
       FROM responses
      WHERE company_id = $1 AND questionnaire_id = $2
      ORDER BY submitted_at ASC`,
    [companyId, questionnaireId]
  );
  const respondenti = r?.rows ?? [];
  if (respondenti.length === 0) {
    console.warn(`[priporocila] ni respondentov za company=${companyId} q=${questionnaireId}`);
    return null;
  }

  const respondentiBlok = respondenti
    .map((row, i) => formatirajRespondenta(i, row.raw_data, row.ai_povzetek))
    .join('\n\n');

  const user = uporabiTemplate(tpl, {
    naziv,
    st_respondentov: String(respondenti.length),
    respondenti: respondentiBlok,
  });

  // 4000 tokenov ~= 12-15k znakov — dovolj za 5 sekcij z tabelami + buffer.
  const priporocila = await klicOpus({ system, user, maxTokens: 4000 });
  if (!priporocila) {
    console.warn(`[priporocila] AI ni vrnil odgovora za company=${companyId} q=${questionnaireId}`);
    return null;
  }

  // UPSERT v company_priporocila (po UNIQUE company_id + questionnaire_id)
  await dbQuery(`
    INSERT INTO company_priporocila (company_id, questionnaire_id, vsebina, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (company_id, questionnaire_id)
    DO UPDATE SET vsebina = EXCLUDED.vsebina, updated_at = NOW()
  `, [companyId, questionnaireId, priporocila]);

  console.log(`[priporocila] OK company=${companyId} q=${questionnaireId} (${priporocila.length} znakov, iz ${respondenti.length} respondentov)`);
  return priporocila;
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { generirajPriporocila };
