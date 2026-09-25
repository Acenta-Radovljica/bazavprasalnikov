-- ── 012: mozni dvojnik podjetja ────────────────────────────────────────────
-- Kadar ujemanje (src/ai/match_company.js) najde verjeten obstojec zapis, a ga
-- ne sme zdruziti samodejno (ista domena, a AI ni potrdil; AI meni isto, a
-- sta domeni razlicni), ustvari novo podjetje in si zapomni, s katerim je
-- verjetno isto. Na strani podjetja se pokaze opozorilo z gumbom Zdruzi.
-- Zakaj ne samodejno: napacna zdruzitev pomesa odgovore dveh strank v eno
-- priporocilo, zgresena pa pomeni le en klik vec.
--
-- ON DELETE SET NULL: ko se dvojnik zdruzi (izbrise), opozorilo samo izgine.
-- Idempotentno — migracije tecejo ob vsakem zagonu.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS mozni_dvojnik_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS mozni_dvojnik_razlog TEXT;
