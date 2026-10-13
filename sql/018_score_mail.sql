-- 018: AI Business Score -> mail stranki z rezultati v PDF (Maja, 13. 10. 2026).
--
-- Po oddaji stranka dobi mail od matjaz@acenta.si z zadevo »[AI Business Score] Vaši rezultati«
-- in poročilom v prilogi (src/score/mail.js). Outbox (src/score/outbox.js) ga pošlje, ko je
-- AI besedilo gotovo, in ob napaki ponovi.
--
-- Isti vzorec kot 017: stolpec se doda s privzeto vrednostjo 'skipped', zato vrstice, ki že
-- obstajajo (testne oddaje, Majin test), maila NE dobijo. Takoj zatem privzeta vrednost postane
-- 'pending', zato ga vsaka nova oddaja dobi. Vse je idempotentno (migrate.js poganja vse ob zagonu).

ALTER TABLE score_results ADD COLUMN IF NOT EXISTS mail_status TEXT NOT NULL DEFAULT 'skipped';
ALTER TABLE score_results ALTER COLUMN mail_status SET DEFAULT 'pending';
ALTER TABLE score_results ADD COLUMN IF NOT EXISTS attempts_mail INTEGER NOT NULL DEFAULT 0;
ALTER TABLE score_results ADD COLUMN IF NOT EXISTS mail_id TEXT;            -- id pri Resendu
ALTER TABLE score_results ADD COLUMN IF NOT EXISTS mail_sent_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE score_results ADD CONSTRAINT score_results_mail_status_check
    CHECK (mail_status IN ('pending', 'retry', 'ok', 'failed', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_score_due_mail ON score_results (next_attempt_at)
  WHERE mail_status IN ('pending', 'retry');
