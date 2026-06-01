-- ────────────────────────────────────────────────────────────────────────────
-- Migracija 005 — lead-status pipeline
-- Doda strukturirano stanje leada na nivoju podjetja (1 podjetje = 1 lead):
--   status        = ROCNO prodajno stanje (komercialist premika po lijaku)
--   kvalifikacija = AI/clovekova ocena toplote (hot/warm/cold)
-- Vse je idempotentno (ADD COLUMN IF NOT EXISTS, CHECK preko DO bloka),
-- zato se varno vrti pri vsakem zagonu (server.js auto-migracija).
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Nova polja na companies ──────────────────────────────────────────────
-- status: privzeto 'nov'. Lijak: nov → kvalificiran → kontaktiran → sestanek →
--         ponudba → dobljen / izgubljen.
-- kvalifikacija: NULL = se ni ocenjeno. AI jo nastavi ob submitu lead-vprasalnika.
-- kvalifikacija_rocna: ce clovek rocno povozi oceno, AI je odslej NE prepise.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS status                   TEXT NOT NULL DEFAULT 'nov';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS status_updated_at        TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS kvalifikacija            TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS kvalifikacija_razlog     TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS kvalifikacija_rocna      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS kvalifikacija_updated_at TIMESTAMPTZ;

-- ── 2. CHECK omejitvi za dovoljene vrednosti ───────────────────────────────
-- Obramba na nivoju baze proti tipkarski napaki (poleg validacije v API-ju).
-- ALTER TABLE ADD CONSTRAINT nima IF NOT EXISTS, zato idempotentno preko DO bloka.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'companies' AND constraint_name = 'companies_status_check'
  ) THEN
    ALTER TABLE companies ADD CONSTRAINT companies_status_check
      CHECK (status IN ('nov','kvalificiran','kontaktiran','sestanek','ponudba','dobljen','izgubljen'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'companies' AND constraint_name = 'companies_kvalifikacija_check'
  ) THEN
    ALTER TABLE companies ADD CONSTRAINT companies_kvalifikacija_check
      CHECK (kvalifikacija IS NULL OR kvalifikacija IN ('hot','warm','cold'));
  END IF;
END$$;

-- ── 3. Varovalka na questionnaires ─────────────────────────────────────────
-- je_lead_vprasalnik: samo vprasalniki s TRUE sprozijo AI kvalifikacijo.
-- napredni-ai = lead anketa (TRUE). moj-ai-nacrt (obstojeci klienti) in
-- pred-delavnico (anonimno) ostaneta FALSE.
ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS je_lead_vprasalnik BOOLEAN NOT NULL DEFAULT FALSE;

-- Nastavi flag SAMO ob prvem zagonu te migracije (ko se noben vprasalnik ni
-- oznacen). Razlog: ce kasneje dodamo UI za rocno upravljanje te zastavice,
-- ne smemo povoziti rocne izbire ob vsakem bootu.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM questionnaires WHERE je_lead_vprasalnik = TRUE) THEN
    UPDATE questionnaires SET je_lead_vprasalnik = TRUE WHERE slug = 'napredni-ai';
  END IF;
END$$;

-- ── 4. Indeks za filtriranje po statusu na dashboardu ──────────────────────
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
