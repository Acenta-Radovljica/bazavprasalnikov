// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { klicOpus } from './claude.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const SYSTEM_PROMPT =
  'Si svetovalec agencije Acenta.si za AI delavnice za turisticne in gostinske kliente. ' +
  'Tvoja naloga je iz odgovorov respondentov podjetja sestaviti konkretno agendo workshopa, ' +
  'priporocena AI orodja in primere uporabe. Odgovor v slovenscini. Brez floskul kot ' +
  '"ekipa je odlicna" — bodi konkreten in operativen.';

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

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────

async function generirajPriporocila(companyId) {
  if (!companyId) return null;

  // Naloži podjetje
  const c = await dbQuery(
    'SELECT id, naziv_prikaz FROM companies WHERE id = $1',
    [companyId]
  );
  if (!c?.rows?.length) {
    console.warn(`[priporocila] company ${companyId} ne obstaja`);
    return null;
  }
  const naziv = c.rows[0].naziv_prikaz;

  // Naloži vse responses + povzetke za to podjetje
  const r = await dbQuery(
    `SELECT id, raw_data, ai_povzetek
       FROM responses
      WHERE company_id = $1
      ORDER BY submitted_at ASC`,
    [companyId]
  );
  const respondenti = r?.rows ?? [];
  if (respondenti.length === 0) {
    console.warn(`[priporocila] ni respondentov za company=${companyId}`);
    return null;
  }

  const respondentiBlok = respondenti
    .map((row, i) => formatirajRespondenta(i, row.raw_data, row.ai_povzetek))
    .join('\n\n');

  const user =
    `Podjetje: ${naziv}\n` +
    `Stevilo respondentov: ${respondenti.length}\n\n` +
    respondentiBlok +
    `\n\n` +
    `Iz teh odgovorov sestavi:\n\n` +
    `## 1. AGENDA WORKSHOPA (max 4 ure)\n` +
    `Konkretne tematske bloke z ocenjenim casom. Prilagojeno tej panogi in njihovim ovi ram.\n\n` +
    `## 2. PRIPOROCENA AI ORODJA\n` +
    `3-5 orodij, ki bi takoj prinesla vrednost. Za vsako: ime + 1 stavek zakaj ravno zanje.\n\n` +
    `## 3. PRIMERI UPORABE\n` +
    `3 konkretni use case-i iz njihovega vsakdanjega posla.\n\n` +
    `## 4. PRICAKOVANI ROI\n` +
    `Pol stavka — kaj naj pricakujejo v 30 dneh implementacije.\n\n` +
    `## 5. RIZIKI / OVIRE\n` +
    `Top 2 stvari, ki bi jih lahko zaustavile, in kako jih nasloviti.`;

  // 4000 tokenov ~= 12-15k znakov — dovolj za 5 sekcij z tabelami + buffer.
  // Prej je bilo 2500 in se je tekst presekal sredi 5. sekcije.
  const priporocila = await klicOpus({ system: SYSTEM_PROMPT, user, maxTokens: 4000 });
  if (!priporocila) {
    console.warn(`[priporocila] AI ni vrnil odgovora za company=${companyId}`);
    return null;
  }

  await dbQuery(
    `UPDATE companies
        SET ai_priporocila = $1,
            ai_priporocila_updated_at = NOW()
      WHERE id = $2`,
    [priporocila, companyId]
  );

  console.log(`[priporocila] OK company=${companyId} (${priporocila.length} znakov, iz ${respondenti.length} respondentov)`);
  return priporocila;
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { generirajPriporocila };
