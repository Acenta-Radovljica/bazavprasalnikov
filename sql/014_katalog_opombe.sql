-- 014: katalog Acentinih resitev + interne opombe podjetja.
--
-- Katalog je vhod za prodajni predlog in za ZIP za Claude: kaj Acenta zna in
-- kje to ze deluje. Brez njega AI predlaga splosna orodja (Copilot, DeepL),
-- ki jih podjetje lahko kupi samo in Acenti ne prinesejo posla.
--
-- VSEBINE NI V REPU: repo je javen, v katalogu pa so imena strank. Tabela je
-- prazna in se napolni prek admina (/admin/katalog.html) ali API-ja.
--
-- Vse je idempotentno (migracije tecejo ob vsakem zagonu) in samo dodaja.

CREATE TABLE IF NOT EXISTS katalog_resitev (
  id             SERIAL PRIMARY KEY,
  naziv          TEXT NOT NULL,
  tezava         TEXT NOT NULL DEFAULT '',   -- tezava v jeziku stranke
  kaj_naredi     TEXT NOT NULL DEFAULT '',   -- kaj naredi AI in kaj ostane cloveku
  kje            TEXT NOT NULL DEFAULT '',   -- kje ze deluje (stranka, panoga, dokaz)
  panoga         TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'ideja',
  -- Ali sme AI stranko iz polja "kje" omeniti pred DRUGO stranko. Privzeto ne:
  -- dovoljenje da clovek, ne AI.
  smemo_omeniti  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE katalog_resitev ADD CONSTRAINT katalog_resitev_status_check
    CHECK (status IN ('produkcija', 'pilot', 'prototip', 'ponudba', 'ideja', 'ustavljeno'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Prosto besedilo, ki ga ureja clovek, po kljucu. Prvi kljuc:
-- 'ne_priporocamo' (cesa Acenta ne priporoca; AI to dobi kot prepoved).
CREATE TABLE IF NOT EXISTS nastavitve (
  kljuc       TEXT PRIMARY KEY,
  vrednost    TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kar vemo o podjetju mi (npr. "racun za Claude ze imajo"). Interno: gre v
-- prodajni predlog in ZIP kot dejstvo, stranka ga nikoli ne vidi.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS interne_opombe TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS interne_opombe_updated_at TIMESTAMPTZ;
