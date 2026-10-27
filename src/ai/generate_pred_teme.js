// "Kaj jim vzame najvec casa": themes from the answers before the workshop.
//
// Matjaz wants two things before a workshop: how advanced the people are
// (computed without AI in public/admin/pred.js) and which work takes their
// time. The second comes from free-text answers, so the model groups them
// into themes. Every theme names the answers it comes from and quotes one of
// them verbatim; the code checks both, so a theme cannot rest on an answer
// that does not exist or on a quote nobody wrote.

// ── 1: Imports ────────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { klicSonnet, MODEL_SONNET, sdkVklopljen } from './claude.js';

// ── 2: Constants ──────────────────────────────────────────────────────────
const MAX_TEM = 6;
const MAX_NAZIV = 80;
const MAX_CITAT = 300;

// Questions about work, not about obstacles, tools or workshop wishes.
// Pre-workshop survey: "Katere naloge ... bi najraje optimizirali z AI?" and
// "Ali imate idejo za uporabo AI ...?"; Napredni AI: "Opisite problem ali
// proces, ki ga se niste uspeli resiti z AI."
const VPRASANJE_O_DELU = /(nalog|opravil|proces|idej|čas)/i;
const TIPI_BESEDILA = new Set(['text', 'textarea']);

const SYSTEM_PROMPT = `Si analitik v agenciji Acenta. Dobiš odgovore zaposlenih v enem podjetju, zbrane pred delavnico o umetni inteligenci. Ugotovi, katera dela jim vzamejo največ časa oziroma bi jih najraje prepustili umetni inteligenci.

Pravila:
- Podobna opravila združi v teme. Največ ${MAX_TEM} tem, razvrščenih po tem, koliko ljudi jih omenja.
- Naziv teme je konkreten opis dela v slovenščini, največ 60 znakov, npr. »Poročila za razpise« ali »Odgovori gostom na ponavljajoča se vprašanja«. Brez splošnih nazivov, kot sta »Optimizacija dela« ali »Uporaba AI«.
- Upoštevaj samo opravila in ideje za delo. Iz ovir, želja za delavnico ali naštetih orodij ne delaj tem.
- Odgovor brez konkretnega opravila (npr. »ne vem, kaj zmore«) ne spada v nobeno temo.
- Za vsako temo naštej oznake odgovorov (R1, R2 …), ki jo omenjajo, in dodaj en dobeseden citat iz enega od njih. Citat prepiši natanko tako, kot je zapisan, tudi s tipkarskimi napakami, največ 200 znakov, brez dodanih narekovajev.

Vrni IZKLJUČNO veljaven JSON brez dodatnega besedila:
{"teme":[{"naziv":"...","odgovori":["R1","R4"],"citat":"...","citat_iz":"R4"}]}`;

// ── 3: Pure helpers (exported for tests) ──────────────────────────────────

// Text answers about work, per respondent. rows: [{ id, raw_data, vprasanja }]
// in a stable order (time of submission). Respondents without such text are
// kept (with an empty list) so the page can say how many named no task.
export function zberiBesedila(rows) {
  return (rows || []).map((row, i) => {
    const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    const vprasanja = Array.isArray(row.vprasanja) ? row.vprasanja : [];
    const besedila = vprasanja
      .filter(q => q && TIPI_BESEDILA.has(q.tip) && VPRASANJE_O_DELU.test(String(q.label || '')))
      .map(q => ({ vprasanje: String(q.label).trim(), odgovor: String(raw[q.id] ?? '').trim() }))
      .filter(b => /[\p{L}\d]{2,}/u.test(b.odgovor));
    return { ref: `R${i + 1}`, responseId: row.id, besedila };
  });
}

export function sestaviUporabnika(zbrano) {
  const bloki = zbrano
    .filter(r => r.besedila.length)
    .map(r => `${r.ref}\n${r.besedila.map(b => `- ${b.vprasanje}\n  ${b.odgovor.replace(/\s+/g, ' ')}`).join('\n')}`);
  return `Odgovori (vsaka oznaka R je en izpolnjevalec):\n\n${bloki.join('\n\n')}\n\nVrni samo JSON.`;
}

// Whitespace, case and quote style must not decide whether a quote is real.
export function normaliziraj(s) {
  return String(s || '').normalize('NFC').toLowerCase()
    .replace(/[»«„“”"']/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// A model likes to wrap a quote in quotation marks or cut it with an
// ellipsis. Marks are removed only as a pair, so a quote that really ends
// with a quoted word ("pozablja") keeps it.
function ociscenCitat(s) {
  let c = String(s || '').trim().replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, '').trim();
  if (/^["»«„“”']/.test(c) && /["»«„“”']$/.test(c) && c.length > 2) c = c.slice(1, -1).trim();
  return c.replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, '').trim();
}

export function parsaj(besedilo) {
  if (typeof besedilo !== 'string') return null;
  const a = besedilo.indexOf('{');
  const b = besedilo.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(besedilo.slice(a, b + 1)); } catch { return null; }
}

// Keeps the themes that hold up and says what was wrong with the others.
// Returns { teme: [{ naziv, odgovori: [responseId], citat, citat_odgovor }], tezave: [] }.
export function preveriTeme(obj, zbrano) {
  const tezave = [];
  const poRef = new Map(zbrano.map(r => [r.ref, r]));
  const surove = Array.isArray(obj?.teme) ? obj.teme : null;
  if (!surove) return { teme: [], tezave: ['Odgovor nima seznama "teme".'] };

  const teme = [];
  const videni = new Set();
  surove.forEach((t, i) => {
    const kje = `Tema ${i + 1}`;
    const naziv = String(t?.naziv || '').trim().replace(/\s+/g, ' ');
    if (naziv.length < 3 || naziv.length > MAX_NAZIV) { tezave.push(`${kje}: naziv manjka ali je predolg.`); return; }
    if (videni.has(normaliziraj(naziv))) { tezave.push(`${kje}: tema »${naziv}« je podvojena.`); return; }

    const refs = [...new Set((Array.isArray(t.odgovori) ? t.odgovori : []).map(x => String(x).trim().toUpperCase()))];
    const neznani = refs.filter(r => !poRef.has(r) || !poRef.get(r).besedila.length);
    if (!refs.length || neznani.length) {
      tezave.push(`${kje} »${naziv}«: ${refs.length ? `neznane oznake ${neznani.join(', ')}` : 'ni oznak odgovorov'}.`);
      return;
    }

    const citatIz = String(t.citat_iz || '').trim().toUpperCase();
    const citat = ociscenCitat(t.citat);
    if (!refs.includes(citatIz)) { tezave.push(`${kje} »${naziv}«: citat_iz ${citatIz || '(prazno)'} ni med odgovori teme.`); return; }
    if (citat.length < 3 || citat.length > MAX_CITAT) { tezave.push(`${kje} »${naziv}«: citat manjka ali je predolg.`); return; }
    const vir = poRef.get(citatIz).besedila.map(b => normaliziraj(b.odgovor)).join(' \n ');
    if (!vir.includes(normaliziraj(citat))) {
      tezave.push(`${kje} »${naziv}«: citat »${citat}« ni dobesedno v odgovoru ${citatIz}.`);
      return;
    }

    videni.add(normaliziraj(naziv));
    teme.push({
      naziv,
      odgovori: refs.map(r => poRef.get(r).responseId),
      citat,
      citat_odgovor: poRef.get(citatIz).responseId,
    });
  });

  // Most mentioned first; the model's order breaks ties.
  const urejene = teme
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.odgovori.length - a.t.odgovori.length || a.i - b.i)
    .map(x => x.t)
    .slice(0, MAX_TEM);
  return { teme: urejene, tezave };
}

// One call, and one correction when something did not hold up. What still
// fails after the correction is dropped; the page shows only checked themes.
export async function pripraviTeme(zbrano, { klic }) {
  const user = sestaviUporabnika(zbrano);
  const prvi = await klic({ system: SYSTEM_PROMPT, user });
  const obj = parsaj(prvi);
  let izid = obj ? preveriTeme(obj, zbrano) : { teme: [], tezave: ['Odgovor ni veljaven JSON.'] };
  if (!izid.tezave.length) return { ok: true, teme: izid.teme };

  const popravek = `${user}\n\nTvoj prejšnji odgovor:\n${String(prvi || '').slice(0, 6000)}\n\nV njem so bile napake:\n${izid.tezave.map(x => `- ${x}`).join('\n')}\n\nPopravi jih in vrni cel JSON znova.`;
  const drugi = await klic({ system: SYSTEM_PROMPT, user: popravek });
  const obj2 = parsaj(drugi);
  if (obj2) {
    const izid2 = preveriTeme(obj2, zbrano);
    if (izid2.teme.length || !izid.teme.length) izid = izid2;
  }
  if (!izid.teme.length && !obj && !obj2) return { ok: false, napaka: 'AI ni vrnil veljavnega odgovora.' };
  return { ok: true, teme: izid.teme, tezave: izid.tezave };
}

// ── 4: Run against the database ───────────────────────────────────────────

// Answers before the workshop, oldest first, with the questions as they were
// when submitted (copy) or as they are today.
export async function odgovoriPred(companyId) {
  const r = await dbQuery(
    `SELECT r.id, r.submitted_at, r.raw_data,
            CASE WHEN COALESCE(jsonb_array_length(r.questions_snapshot), 0) > 0
                 THEN r.questions_snapshot ELSE q.questions END AS vprasanja
       FROM responses r
       JOIN questionnaires q ON q.id = r.questionnaire_id
      WHERE r.company_id = $1 AND q.faza = 'pred'
      ORDER BY r.submitted_at, r.id`,
    [companyId],
  );
  return r ? r.rows : null;
}

export async function oznaciPripravo(companyId) {
  await dbQuery(
    `INSERT INTO pred_teme (company_id, status) VALUES ($1, 'pripravlja')
     ON CONFLICT (company_id) DO UPDATE SET status = 'pripravlja', napaka = NULL, zacetek_at = NOW()`,
    [companyId],
  );
}

export async function generirajPredTeme(companyId, { klic } = {}) {
  const rows = await odgovoriPred(companyId);
  if (!rows) return null;
  if (!rows.length) {
    // No answers before the workshop (any more): nothing to show.
    await dbQuery('DELETE FROM pred_teme WHERE company_id = $1', [companyId]);
    return null;
  }
  await oznaciPripravo(companyId);

  const zbrano = zberiBesedila(rows);
  const ids = rows.map(r => r.id);
  const model = `${MODEL_SONNET}${sdkVklopljen() ? ' (SDK)' : ''}`;
  let izid;
  if (!zbrano.some(r => r.besedila.length)) {
    izid = { ok: true, teme: [] };
  } else {
    try {
      izid = await pripraviTeme(zbrano, {
        klic: klic || (({ system, user }) => klicSonnet({ system, user, maxTokens: 2000 })),
      });
    } catch (err) {
      izid = { ok: false, napaka: `Napaka pri pripravi: ${err.message}` };
    }
  }

  if (!izid.ok) {
    await dbQuery(
      `UPDATE pred_teme SET status = 'napaka', napaka = $2, model = $3, koncano_at = NOW() WHERE company_id = $1`,
      [companyId, izid.napaka, model],
    );
    console.warn(`[pred-teme] company=${companyId} napaka: ${izid.napaka}`);
    return null;
  }

  const vTemah = new Set(izid.teme.flatMap(t => t.odgovori));
  const brez = ids.filter(id => !vTemah.has(id)).length;
  await dbQuery(
    `UPDATE pred_teme
        SET status = 'ok', teme = $2::jsonb, odgovori = $3::int[], brez_opravil = $4,
            model = $5, napaka = NULL, koncano_at = NOW()
      WHERE company_id = $1`,
    [companyId, JSON.stringify(izid.teme), ids, brez, model],
  );
  if (izid.tezave?.length) console.warn(`[pred-teme] company=${companyId} izpusceno: ${izid.tezave.join(' | ')}`);
  console.log(`[pred-teme] company=${companyId} ok, tem ${izid.teme.length}, odgovorov ${ids.length}`);
  return izid.teme;
}

export { SYSTEM_PROMPT, MAX_TEM };
