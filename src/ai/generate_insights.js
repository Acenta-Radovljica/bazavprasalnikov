// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { klicOpus } from './claude.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const SYSTEM_PROMPT =
  'Si senior svetovalec agencije Acenta.si za AI delavnice. ' +
  'Tvoja naloga je iz povzetkov vec turisticnih, gostinskih in storitvenih klientov ' +
  'najti VZORCE: kaj jih druzi, katere bolecine se ponavljajo, kaj rabijo. ' +
  'Output v slovenscini. Brez floskul. Konkretno, operativno, na osnovi podatkov.';

const DEFAULT_DNI = 90;

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

function formatirajPodjetje(c, idx) {
  const lines = [`--- Klient ${idx + 1}: ${c.naziv_prikaz} ---`];
  lines.push(`Stevilo respondentov: ${c.st_respondentov}`);
  if (c.povzetki && c.povzetki.length) {
    lines.push('POVZETKI:');
    c.povzetki.forEach((p, i) => {
      if (p) lines.push(`  [${i + 1}] ${p.trim()}`);
    });
  }
  return lines.join('\n');
}

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────

async function generirajInsights({ dni = DEFAULT_DNI } = {}) {
  // Naloži vse companies z agregiranimi povzetki responses zadnjih N dni.
  // ARRAY_AGG zbere povzetke v polje, FILTER izloci NULL.
  const r = await dbQuery(
    `SELECT
        c.id,
        c.naziv_prikaz,
        COUNT(r.id)::int AS st_respondentov,
        ARRAY_AGG(r.ai_povzetek) FILTER (WHERE r.ai_povzetek IS NOT NULL) AS povzetki
       FROM companies c
       JOIN responses r ON r.company_id = c.id
      WHERE r.submitted_at > NOW() - ($1 || ' days')::interval
      GROUP BY c.id, c.naziv_prikaz
     HAVING COUNT(r.id) > 0
      ORDER BY c.naziv_prikaz`,
    [String(dni)]
  );

  const klienti = r?.rows ?? [];
  if (klienti.length < 2) {
    console.warn(`[insights] premalo klientov za cross-analizo (${klienti.length})`);
    return null;
  }

  const blok = klienti.map((c, i) => formatirajPodjetje(c, i)).join('\n\n');

  const user =
    `Analiziraj sledece kliente Acenta agencije (povzetki delavniskih vprasalnikov, zadnjih ${dni} dni).\n` +
    `Stevilo klientov: ${klienti.length}\n\n` +
    blok +
    `\n\n` +
    `Iz teh podatkov sestavi cross-client analizo:\n\n` +
    `## 1. TOP 3 SKUPNE BOLECINE\n` +
    `Katere tezave se ponavljajo cez vec klientov? Konkretno, brez splosnih fraz.\n\n` +
    `## 2. NAJPOGOSTEJSI PRICAKOVANI BENEFITI\n` +
    `Kaj klienti vecinoma pricakujejo od AI? Razvrsti po pogostosti.\n\n` +
    `## 3. PRIPOROCENA AI ORODJA (top 5 cez vse kliente)\n` +
    `Katera orodja bi imela najsirsi uporabni doseg? Za vsako: ime + 1 stavek zakaj.\n\n` +
    `## 4. SEKTORSKI VZORCI\n` +
    `Ce vidis razlike med turizmom, gostinstvom in ostalimi storitvami — opisi.\n` +
    `Ce ni dovolj podatkov za sektorsko delitev, navedi to.\n\n` +
    `## 5. PRILOZNOSTI ZA ACENTA AGENCIJO\n` +
    `Top 2 storitvi/produkta, ki bi ju Acenta lahko zapakirala za vec klientov hkrati.`;

  // 4000 tokenov ~= 12-15k znakov (enako kot priporocila).
  const insights = await klicOpus({ system: SYSTEM_PROMPT, user, maxTokens: 4000 });
  if (!insights) {
    console.warn('[insights] Opus ni vrnil odgovora');
    return null;
  }

  // Shrani v cross_client_insights. Vsebina je JSONB — wrappamo v objekt.
  const vsebina = {
    format: 'markdown',
    dni_obdobja: dni,
    st_klientov: klienti.length,
    st_respondentov: klienti.reduce((sum, c) => sum + c.st_respondentov, 0),
    content: insights,
  };

  const ins = await dbQuery(
    `INSERT INTO cross_client_insights (vsebina) VALUES ($1) RETURNING id, generated_at`,
    [JSON.stringify(vsebina)]
  );

  console.log(`[insights] OK (${insights.length} znakov, ${klienti.length} klientov)`);
  return ins?.rows?.[0] ?? null;
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { generirajInsights };
