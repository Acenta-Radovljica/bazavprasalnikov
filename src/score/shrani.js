// AI Business Score: persist a validated submission.
//
// The response row and its score row are written in ONE statement (CTE), so a response
// without a score (or the reverse) cannot exist. Then the company qualification is filled
// only if it is still empty: a self-assessment never overrides an existing sales judgement.

import { randomBytes } from 'node:crypto';
import { dbQuery } from '../db.js';
import { izracunajScore } from './izracunaj.js';
import { SCORE_VERSION } from './vprasanja-v1.js';

const LEAD_V_KVALIFIKACIJO = { A: 'hot', B: 'warm', C: 'cold' };

export const novToken = () => randomBytes(16).toString('base64url'); // 128 bit, 22 chars

// Returns { responseId, token, rezultat } or null on DB failure.
export async function shraniOddajo({ companyId, questionnaireId, payload, ipHash, snap, oddaja }) {
  const rezultat = izracunajScore({ ...oddaja.odgovori, velikost: oddaja.kontakt.velikost });
  const token = novToken();

  // raw_data keeps contact fields at top level (dedup and CSV read raw_data->>'email').
  const raw = { ...oddaja.kontakt, odgovori: oddaja.odgovori, marketing_consent: oddaja.marketing, gdpr_consent: true };

  const r = await dbQuery(
    `WITH resp AS (
       INSERT INTO responses (company_id, questionnaire_id, raw_data, ip_hash, consent_gdpr,
                              questions_snapshot, custom_html_snapshot)
       VALUES ($1, $2, $3, $4, TRUE, $5, $6)
       RETURNING id
     )
     INSERT INTO score_results (response_id, token, score_version, rezultat, marketing_soglasje)
     SELECT id, $7, $8, $9, $10 FROM resp
     RETURNING response_id`,
    [companyId, questionnaireId, JSON.stringify(raw), ipHash, snap.questions, snap.customHtml,
     token, SCORE_VERSION, JSON.stringify(rezultat), oddaja.marketing],
  );
  const responseId = r?.rows?.[0]?.response_id;
  if (!responseId) return null;

  await dbQuery('UPDATE companies SET last_response_at = NOW() WHERE id = $1', [companyId]);

  const datum = new Date().toLocaleDateString('sl-SI', { timeZone: 'Europe/Ljubljana' });
  const razlog = `[AI Business Score ${datum}] Razred ${rezultat.lead.razred}: ${rezultat.lead.razlogi.join(', ')}`;
  await dbQuery(
    `UPDATE companies
        SET kvalifikacija = $1, kvalifikacija_razlog = $2, kvalifikacija_updated_at = NOW()
      WHERE id = $3 AND kvalifikacija IS NULL AND kvalifikacija_rocna = FALSE`,
    [LEAD_V_KVALIFIKACIJO[rezultat.lead.razred], razlog, companyId],
  );

  return { responseId, token, rezultat };
}
