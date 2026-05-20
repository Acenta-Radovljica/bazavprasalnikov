-- ────────────────────────────────────────────────────────────────────────────
-- Migracija 001 — zacetna shema
-- Baza vprasalnikov delavnice "Moj AI nacrt"
-- ────────────────────────────────────────────────────────────────────────────

-- Razsiritev za fuzzy matching imen podjetij (Levenshtein, similarity)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- ── Tabela: companies ───────────────────────────────────────────────────────
-- Eno podjetje (npr. Hotel Cubo) lahko ima vec respondentov (lastnik + direktor).
-- naziv_normaliziran sluzi za AI matching: lowercase, brez "hotel", "d.o.o.", presledki strgani.
CREATE TABLE IF NOT EXISTS companies (
  id                        SERIAL PRIMARY KEY,
  naziv_normaliziran        TEXT UNIQUE NOT NULL,
  naziv_prikaz              TEXT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_response_at          TIMESTAMPTZ,
  ai_priporocila            TEXT,
  ai_priporocila_updated_at TIMESTAMPTZ
);

-- ── Tabela: responses ───────────────────────────────────────────────────────
-- En vprasalnik = ena vrstica. raw_data je celoten Formspree payload (JSON).
-- ip_hash: SHA256 IP-ja respondenta za GDPR (nesled, ampak preverljiv za duplikate).
CREATE TABLE IF NOT EXISTS responses (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  raw_data        JSONB NOT NULL,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash         TEXT,
  ai_povzetek     TEXT,
  ai_processed_at TIMESTAMPTZ,
  consent_gdpr    BOOLEAN NOT NULL DEFAULT FALSE
);

-- ── Tabela: cross_client_insights ───────────────────────────────────────────
-- Tedenski cross-podjetje insights (top bolecine, sektorski trendi).
-- vsebina je JSONB z naborom kategoriziranih najdb.
CREATE TABLE IF NOT EXISTS cross_client_insights (
  id           SERIAL PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vsebina      JSONB NOT NULL
);

-- ── Indeksi za performance ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_responses_company    ON responses(company_id);
CREATE INDEX IF NOT EXISTS idx_responses_submitted  ON responses(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_companies_norm_trgm  ON companies USING GIN (naziv_normaliziran gin_trgm_ops);

-- Polnotekstovno iskanje cez raw_data + ai_povzetek (uporabi se v /api/search)
CREATE INDEX IF NOT EXISTS idx_responses_search ON responses
  USING GIN (to_tsvector('simple', coalesce(raw_data::text, '') || ' ' || coalesce(ai_povzetek, '')));
