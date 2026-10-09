-- 015: prodajni predlog na strani podjetja.
--
-- Opus iz celih odgovorov vseh vprasalnikov, zapisov sestankov, internih opomb
-- in kataloga pripravi dva dokumenta: seznam procesov za direktorja in
-- prodajni list za Matjaza. Vsaka priprava je nova vrstica: prejsnji predlog
-- ostane viden, dokler novi ni koncan, in vidimo, kdaj je kaj nastalo.
--
-- Idempotentno (migracije tecejo ob vsakem zagonu), samo dodaja.

CREATE TABLE IF NOT EXISTS prodajni_predlogi (
  id             SERIAL PRIMARY KEY,
  company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pripravlja',
  za_direktorja  TEXT,                 -- Markdown, dokument 1
  za_matjaza     TEXT,                 -- Markdown, dokument 2 (interno)
  -- Kar je preverjanje izhoda se nasel po popravku (npr. stevilka, ki je ni
  -- v vhodu). Matjaz jih vidi nad predlogom, preden ga poslje.
  opozorila      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Iz cesa je predlog nastal: { odgovori, seje, transkripti, katalog, opombe }.
  vhod           JSONB NOT NULL DEFAULT '{}'::jsonb,
  napaka         TEXT,
  model          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  koncano_at     TIMESTAMPTZ
);

DO $$ BEGIN
  ALTER TABLE prodajni_predlogi ADD CONSTRAINT prodajni_predlogi_status_check
    CHECK (status IN ('pripravlja', 'ok', 'napaka'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_prodajni_predlogi_company
  ON prodajni_predlogi(company_id, created_at DESC);

-- Za eno podjetje tece najvec ena priprava (dvojni klik, dva zavihka).
-- Obticeno vrstico (ponovni zagon med pripravo) API pred vstavljanjem oznaci
-- kot napako, zato ta indeks ne blokira za vedno.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prodajni_predlogi_tece
  ON prodajni_predlogi(company_id) WHERE status = 'pripravlja';

-- Priprava tece v Node procesu (src/ai/queue.js). Migracije tecejo ob vsakem
-- zagonu, zato tu pospravimo pripravo, ki jo je prekinil ponovni zagon; brez
-- tega bi stran do 20 minut kazala "pripravljam".
UPDATE prodajni_predlogi
   SET status = 'napaka', napaka = 'Priprava je bila prekinjena (ponovni zagon strežnika). Poskusite znova.',
       koncano_at = NOW()
 WHERE status = 'pripravlja';
