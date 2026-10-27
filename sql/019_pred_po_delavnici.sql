-- Migration 019: questionnaire part (before / after the workshop).
--
-- The company page splits answers into "Pred delavnico" and "Po delavnici"
-- by this field; the sales proposal reads only answers that are not from
-- before the workshop. NULL means "drugo" (AI Business Score, intake forms).
--
-- Runs on every boot (src/migrate.js), so it must be idempotent.

-- 1. questionnaires.faza. Initial values are set only when the column is
--    added, so a later choice in the admin (including "drugo") survives the
--    next boot. updated_at is left alone on purpose: the part is not a change
--    of the questionnaire's content, and bumping it would mark every old
--    answer as "vprasalnik urejen po oddaji".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'questionnaires' AND column_name = 'faza') THEN
    ALTER TABLE questionnaires ADD COLUMN faza TEXT;
    ALTER TABLE questionnaires ADD CONSTRAINT questionnaires_faza_check
      CHECK (faza IS NULL OR faza IN ('pred', 'po'));
    UPDATE questionnaires SET faza = 'pred' WHERE slug IN ('pred-delavnico', 'napredni-ai');
    UPDATE questionnaires SET faza = 'po'   WHERE slug IN ('moj-ai-nacrt', 'popis-opravil');
  END IF;
END $$;

-- 2. Sales proposals prepared without the answers from before the workshop.
--    Older rows stay FALSE: they were prepared from all answers, and the page
--    says so when the company has answers from before the workshop.
ALTER TABLE prodajni_predlogi ADD COLUMN IF NOT EXISTS brez_pred BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. "Kaj jim vzame najvec casa": themes from the answers before the
--    workshop, one row per company. The previous themes stay visible while
--    a new run is in progress (status 'pripravlja') or after it failed.
CREATE TABLE IF NOT EXISTS pred_teme (
  company_id   INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pripravlja'
                 CHECK (status IN ('pripravlja', 'ok', 'napaka')),
  teme         JSONB NOT NULL DEFAULT '[]'::jsonb,
  odgovori     INTEGER[] NOT NULL DEFAULT '{}',   -- response ids the themes were made from
  brez_opravil INTEGER NOT NULL DEFAULT 0,        -- respondents who named no task
  model        TEXT,
  napaka       TEXT,
  zacetek_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  koncano_at   TIMESTAMPTZ
);
