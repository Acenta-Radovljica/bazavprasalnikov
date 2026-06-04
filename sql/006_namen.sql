-- ────────────────────────────────────────────────────────────────────────────
-- Migracija 006 — namen vprasalnika (lead vs shramba)
-- Doda klasifikacijo na nivoju vprasalnika:
--   namen = 'lead'    → polni AI tok (povzetek + priporocila + kvalifikacija)
--   namen = 'shramba' → obrazec se SAMO shrani, brez AI (npr. konfiguracijski
--                       vprasalniki za review-agent, kjer ne rabimo povzetkov)
-- Vse je idempotentno (ADD COLUMN IF NOT EXISTS, CHECK preko DO bloka,
-- ON CONFLICT DO NOTHING), zato se varno vrti pri vsakem zagonu.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Novo polje na questionnaires ────────────────────────────────────────
-- Privzeto 'lead' — vsi obstojeci vprasalniki ostanejo polni AI tok kot prej.
ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS namen TEXT NOT NULL DEFAULT 'lead';

-- ── 2. CHECK omejitev za dovoljene vrednosti ───────────────────────────────
-- Obramba na nivoju baze proti tipkarski napaki (poleg validacije v API-ju).
-- ALTER TABLE ADD CONSTRAINT nima IF NOT EXISTS, zato idempotentno preko DO bloka.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'questionnaires' AND constraint_name = 'questionnaires_namen_check'
  ) THEN
    ALTER TABLE questionnaires ADD CONSTRAINT questionnaires_namen_check
      CHECK (namen IN ('lead','shramba'));
  END IF;
END$$;

-- ── 3. Seed: "review-agent-intake" (konfiguracijski vprasalnik) ────────────
-- Namen 'shramba' = brez AI. Prompti so NOT NULL, zato vstavimo prazne nize
-- (AI moduli jih nikoli ne dosezejo, ker se gate sprozi prej).
-- ON CONFLICT (slug) DO NOTHING — ob ponovnem deployu ne prepise rocnih sprememb.
INSERT INTO questionnaires (
  slug, naziv_prikaz, opis, questions,
  povzetek_system_prompt, povzetek_user_template,
  priporocila_system_prompt, priporocila_user_template,
  aktivna, namen
) VALUES (
  'review-agent-intake',
  'Review Agent — vprašalnik za pripravo sistema',
  'Konfiguracijski vprašalnik za sistem odgovarjanja na komentarje. Samo shramba — brez AI obdelave.',
  '[]'::jsonb,
  '',
  '',
  '',
  '',
  TRUE,
  'shramba'
)
ON CONFLICT (slug) DO NOTHING;
