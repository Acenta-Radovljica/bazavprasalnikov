// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { klicHaiku } from './claude.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
// Prompti se ne hardkodirajo več — preberejo se iz tabele questionnaires
// glede na responses.questionnaire_id. Tako lahko vsak vprašalnik ima svoj
// povzetek prompt (drug ton, drugačne točke, drug fokus).

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Pretvori raw_data JSONB v lep čitljiv blok za Claude.
// Sortira po stevilski predponi (1_, 2_, 3_...) ce obstaja, preskoci tehnicna polja.
function formatirajPodatke(rawData) {
  if (!rawData || typeof rawData !== 'object') return '(prazno)';

  const keys = Object.keys(rawData).sort();
  const lines = [];
  for (const k of keys) {
    if (k.startsWith('_') || k === 'gdpr_consent') continue;
    const v = rawData[k];
    if (v === null || v === undefined || v === '') continue;
    lines.push(`${k}: ${String(v).trim()}`);
  }
  return lines.join('\n');
}

// Zamenja {placeholder} v templatu z vrednostmi iz vars.
// Neznane {kljuce} pusti pri miru (varno, ne crashne ce admin pozabi placeholder).
function uporabiTemplate(template, vars) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────

// Generira povzetek za en response. Idempotentno — ce je ze povzetek,
// se prepise. Prompt + template se naloži iz questionnaires (JOIN po
// responses.questionnaire_id). Vrne string povzetek ali null.
async function generirajPovzetek(responseId) {
  if (!responseId) return null;

  // Naloži response + pripadajoč vprasalnik (system + user template)
  const r = await dbQuery(`
    SELECT r.id, r.raw_data, r.questionnaire_id,
           q.povzetek_system_prompt, q.povzetek_user_template
      FROM responses r
      JOIN questionnaires q ON q.id = r.questionnaire_id
     WHERE r.id = $1
  `, [responseId]);
  if (!r?.rows?.length) {
    console.warn(`[povzetek] response ${responseId} ne obstaja ali nima vprasalnika`);
    return null;
  }

  const { raw_data, povzetek_system_prompt: system, povzetek_user_template: tpl } = r.rows[0];

  const podatki = formatirajPodatke(raw_data);
  const user = uporabiTemplate(tpl, { podatki });

  const povzetek = await klicHaiku({ system, user, maxTokens: 600 });
  if (!povzetek) {
    console.warn(`[povzetek] AI ni vrnil odgovora za response=${responseId}`);
    return null;
  }

  await dbQuery(
    'UPDATE responses SET ai_povzetek = $1, ai_processed_at = NOW() WHERE id = $2',
    [povzetek, responseId]
  );

  console.log(`[povzetek] OK response=${responseId} (${povzetek.length} znakov)`);
  return povzetek;
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { generirajPovzetek };
