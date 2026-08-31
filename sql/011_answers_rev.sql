-- 011: revizija odgovorov (answers_rev) za zascito pred prepisom med
-- zavihki. PATCH z odgovori se izvede samo, ce se klientova revizija ujema
-- z bazo (CAS); sicer 409 in klient ponovi s svezo revizijo.
--
-- NAMENOMA ne uporabljamo updated_at kot revizije: dvigajo ga tudi
-- transkripti, statusi in meta polja, kar bi pri autosave dajalo lazne
-- konflikte. answers_rev se dvigne IZKLJUCNO ob pisanju answers.
--
-- Idempotentno — ta projekt pozene vse sql/*.sql ob vsakem bootu.

ALTER TABLE process_sessions
  ADD COLUMN IF NOT EXISTS answers_rev INTEGER NOT NULL DEFAULT 0;
