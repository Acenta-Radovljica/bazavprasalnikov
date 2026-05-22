-- ────────────────────────────────────────────────────────────────────────────
-- Migracija 002 — multi-vprasalniki
-- Vse je idempotentno (CREATE/ALTER IF NOT EXISTS, ON CONFLICT DO NOTHING),
-- zato se lahko vrti pri vsakem zagonu brez napake.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabela questionnaires ────────────────────────────────────────────────
-- En vprasalnik = ena vrstica. questions je JSONB array vprasanj:
--   [{ id: "ime", label: "Vase ime", tip: "text", obvezno: true, options?: [...] }]
-- Prompti se uporabijo v AI modulih z {placeholders}.
CREATE TABLE IF NOT EXISTS questionnaires (
  id                          SERIAL PRIMARY KEY,
  slug                        TEXT UNIQUE NOT NULL,
  naziv_prikaz                TEXT NOT NULL,
  opis                        TEXT,
  questions                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  povzetek_system_prompt      TEXT NOT NULL,
  povzetek_user_template      TEXT NOT NULL,
  priporocila_system_prompt   TEXT NOT NULL,
  priporocila_user_template   TEXT NOT NULL,
  aktivna                     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Seed: "Moj AI nacrt" (obstojeci vprasalnik) ─────────────────────────
-- ON CONFLICT (slug) DO NOTHING — pri vsakem deployu ne prepise rocnih
-- sprememb v admin UI.
-- Dollar-quoting ($pp$...$pp$) se izogiba escape-anju ' znotraj besedila.
INSERT INTO questionnaires (
  slug, naziv_prikaz, opis, questions,
  povzetek_system_prompt, povzetek_user_template,
  priporocila_system_prompt, priporocila_user_template,
  aktivna
) VALUES (
  'moj-ai-nacrt',
  'Moj AI načrt',
  'Originalna delavnica Acenta — Formspree vprašalnik. Vsi obstoječi odgovori so povezani s tem vprašalnikom.',
  '[]'::jsonb,
  $pp$Si asistent agencije Acenta.si. Tvoja naloga je iz vprašalnika delavnice "Moj AI načrt" izlušciti kratek 5-tockovni povzetek v slovenščini. Bodi konkreten, ne dodajaj fraz tipa "ekipa je zelo predana".$pp$,
  $pp$Tu so odgovori na vprasalnik:

{podatki}

Napisi povzetek v TOCNO 5 tockah v slovenscini:
1. KDO so (oseba + podjetje, panoga)
2. KAJ pocnejo / kaksen je njihov posel
3. KJE vidijo AI priloznosti
4. KATERE OVIRE jih zaustavljajo (cas, znanje, denar, varnost)
5. KAJ so njihove PRIORITETE (1-2 konkretni stvari)

Brez uvoda, samo 5 tock. Vsaka tocka <30 besed.$pp$,
  $pp$Si svetovalec agencije Acenta.si za AI delavnice za turisticne in gostinske kliente. Tvoja naloga je iz odgovorov respondentov podjetja sestaviti konkretno agendo workshopa, priporocena AI orodja in primere uporabe. Odgovor v slovenscini. Brez floskul kot "ekipa je odlicna" — bodi konkreten in operativen.$pp$,
  $pp$Podjetje: {naziv}
Stevilo respondentov: {st_respondentov}

{respondenti}

Iz teh odgovorov sestavi:

## 1. AGENDA WORKSHOPA (max 4 ure)
Konkretne tematske bloke z ocenjenim casom. Prilagojeno tej panogi in njihovim oviram.

## 2. PRIPOROCENA AI ORODJA
3-5 orodij, ki bi takoj prinesla vrednost. Za vsako: ime + 1 stavek zakaj ravno zanje.

## 3. PRIMERI UPORABE
3 konkretni use case-i iz njihovega vsakdanjega posla.

## 4. PRICAKOVANI ROI
Pol stavka — kaj naj pricakujejo v 30 dneh implementacije.

## 5. RIZIKI / OVIRE
Top 2 stvari, ki bi jih lahko zaustavile, in kako jih nasloviti.$pp$,
  TRUE
)
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Dodaj questionnaire_id v responses ──────────────────────────────────
-- Najprej dodamo nullable, naredimo backfill, sele potem SET NOT NULL.
-- Razlog: ALTER ... SET NOT NULL ne deluje, ce so v tabeli vrstice z NULL.
ALTER TABLE responses ADD COLUMN IF NOT EXISTS questionnaire_id INTEGER;

-- Backfill: vsi obstojeci responses brez questionnaire_id → "moj-ai-nacrt"
UPDATE responses
   SET questionnaire_id = (SELECT id FROM questionnaires WHERE slug = 'moj-ai-nacrt')
 WHERE questionnaire_id IS NULL;

-- FK constraint (idempotentno preko DO bloka — ALTER TABLE ADD CONSTRAINT nima IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'responses' AND constraint_name = 'responses_questionnaire_id_fkey'
  ) THEN
    ALTER TABLE responses
      ADD CONSTRAINT responses_questionnaire_id_fkey
      FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id) ON DELETE RESTRICT;
  END IF;
END$$;

-- NOT NULL (idempotentno — preverimo information_schema)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'responses' AND column_name = 'questionnaire_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE responses ALTER COLUMN questionnaire_id SET NOT NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_responses_questionnaire ON responses(questionnaire_id);

-- ── 4. Tabela company_priporocila (per vprasalnik) ─────────────────────────
-- Eno podjetje ima lahko priporocila za vec razlicnih vprasalnikov.
-- Stara polja v companies (ai_priporocila + ai_priporocila_updated_at) ostanejo
-- kot backup; koda jih od zdaj naprej ne piše — bere se iz te tabele.
CREATE TABLE IF NOT EXISTS company_priporocila (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  questionnaire_id  INTEGER NOT NULL REFERENCES questionnaires(id) ON DELETE RESTRICT,
  vsebina           TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, questionnaire_id)
);

CREATE INDEX IF NOT EXISTS idx_company_priporocila_company ON company_priporocila(company_id);

-- Backfill: prestavi obstojeca priporocila iz companies → company_priporocila
-- (samo ce ze ni v novi tabeli — ON CONFLICT preprecuje duplikate ob ponovnem zagonu).
INSERT INTO company_priporocila (company_id, questionnaire_id, vsebina, updated_at)
SELECT c.id,
       (SELECT id FROM questionnaires WHERE slug = 'moj-ai-nacrt'),
       c.ai_priporocila,
       COALESCE(c.ai_priporocila_updated_at, NOW())
  FROM companies c
 WHERE c.ai_priporocila IS NOT NULL
   AND c.ai_priporocila <> ''
ON CONFLICT (company_id, questionnaire_id) DO NOTHING;
