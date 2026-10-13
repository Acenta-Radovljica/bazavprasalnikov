-- 017: AI Business Score -> monday CRM board Leads (Maja, 13. 10. 2026).
--
-- Vsaka oddaja postane lead na boardu Leads prek sprejemnika v Acenta OS
-- (src/score/crm.js); outbox (src/score/outbox.js) ga poslje in ob napaki ponovi.
--
-- migrate.js poganja vse datoteke ob vsakem zagonu, zato je vse idempotentno.
-- Stolpec se doda s privzeto vrednostjo 'skipped': vrstice, ki ze obstajajo
-- (testne oddaje pred to spremembo), NE gredo na Leads. Takoj zatem privzeta
-- vrednost postane 'pending', zato vsaka nova oddaja gre. Ob ponovnem zagonu
-- ADD COLUMN IF NOT EXISTS ne naredi nic, SET DEFAULT pa je enak.

ALTER TABLE score_results ADD COLUMN IF NOT EXISTS crm_status TEXT NOT NULL DEFAULT 'skipped';
ALTER TABLE score_results ALTER COLUMN crm_status SET DEFAULT 'pending';
ALTER TABLE score_results ADD COLUMN IF NOT EXISTS attempts_crm INTEGER NOT NULL DEFAULT 0;
ALTER TABLE score_results ADD COLUMN IF NOT EXISTS crm_item_id TEXT;   -- id leada na mondayu

DO $$ BEGIN
  ALTER TABLE score_results ADD CONSTRAINT score_results_crm_status_check
    CHECK (crm_status IN ('pending', 'retry', 'ok', 'failed', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_score_due_crm ON score_results (next_attempt_at)
  WHERE crm_status IN ('pending', 'retry');
