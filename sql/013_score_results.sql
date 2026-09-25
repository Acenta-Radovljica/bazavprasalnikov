-- 013: AI Business Score — rezultat ocene + outbox za AI besedilo in MailerLite.
--
-- Rezultat se izracuna ENKRAT ob oddaji (src/score/izracunaj.js) in se shrani s
-- score_version. Kasnejsa sprememba tabele tock ne prepise starih porocil (ista
-- logika kot questions_snapshot v 010).
--
-- Outbox: AI besedilo in zapis v MailerLite nista v spominu procesa, ampak v tej
-- vrstici (status + next_attempt_at + locked_at). Deploy ali sesut kontejner zato
-- ne izgubi dela; delavec (src/score/outbox.js) ob zagonu pobere, kar je ostalo.
--
-- Vse je idempotentno in samo DODAJA (nova tabela + nov vprasalnik), zato je
-- rollback = prejsnji image; tabela lahko ostane.

CREATE TABLE IF NOT EXISTS score_results (
  id                 SERIAL PRIMARY KEY,
  response_id        INTEGER NOT NULL UNIQUE REFERENCES responses(id) ON DELETE CASCADE,
  token              TEXT NOT NULL UNIQUE,            -- javni URL porocila /r/:token (128 bit)
  score_version      TEXT NOT NULL,
  rezultat           JSONB NOT NULL,                  -- izhod izracunajScore()
  besedilo           JSONB,                           -- AI besedilo; NULL = uporabi predlogo
  marketing_soglasje BOOLEAN NOT NULL DEFAULT FALSE,  -- locen od soglasja za porocilo
  ai_status          TEXT NOT NULL DEFAULT 'pending',
  ml_status          TEXT NOT NULL DEFAULT 'pending',
  attempts_ai        INTEGER NOT NULL DEFAULT 0,
  attempts_ml        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at          TIMESTAMPTZ,
  last_error         TEXT,
  revoked_at         TIMESTAMPTZ,                     -- preklic javnega porocila (410)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE score_results ADD CONSTRAINT score_results_ai_status_check
    CHECK (ai_status IN ('pending', 'retry', 'ok', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE score_results ADD CONSTRAINT score_results_ml_status_check
    CHECK (ml_status IN ('pending', 'retry', 'ok', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Delavec isce samo zapadle nedokoncane vrstice.
CREATE INDEX IF NOT EXISTS idx_score_due ON score_results (next_attempt_at)
  WHERE ai_status IN ('pending', 'retry') OR ml_status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_score_created ON score_results (created_at);

-- Vprasalnik, na katerega kaze javni kviz. namen='shramba': splosni AI povzetek
-- in priporocila ne tecejo; oceno in besedilo naredi modul score. questions=[],
-- ker vprasanja zivijo v kodi (src/score/vprasanja-v1.js), ne v bazi.
INSERT INTO questionnaires (
  slug, naziv_prikaz, opis, questions,
  povzetek_system_prompt, povzetek_user_template,
  priporocila_system_prompt, priporocila_user_template,
  aktivna, namen
) VALUES (
  'ai-business-score',
  'AI Business Score',
  'Javna samoocena uporabe AI (pristajalna stran /ai-business-score). Vprasanja in tockovanje so v kodi, rezultat v score_results.',
  '[]'::jsonb, '', '', '', '',
  TRUE, 'shramba'
) ON CONFLICT (slug) DO NOTHING;
