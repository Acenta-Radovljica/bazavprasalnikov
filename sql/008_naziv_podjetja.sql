-- ────────────────────────────────────────────────────────────────────────────
-- Migracija 008 — dodaj polje "Naziv podjetja" obstojecim vprasalnikom
-- napredni-ai in pred-delavnico.
--
-- Zakaj: oba obrazca nista imela polja za podjetje, zato je izlusciPodjetje()
-- (src/routes/form.js) vsakemu odgovoru dodelil "NEZNANO_PODJETJE_<timestamp>",
-- kar je za vsako oddajo ustvarilo novo podjetje → baza ni mogla zdruziti
-- odgovorov istega podjetja. Matcher ze prepozna vprasanje z id="podjetje",
-- zato je dovolj dodati to vprasanje na zacetek questions array-a.
--
-- ON CONFLICT (slug) DO NOTHING v 003/004 NE posodobi obstojecih vrstic, zato
-- to popravimo locseno tukaj.
--
-- IDEMPOTENTNO: guard NOT (questions @> '[{"id":"podjetje"}]') zagotovi, da se
-- polje ne doda dvakrat, ce migracijo poenes vec krat.
-- '...'::jsonb || questions prependi vprasanje na ZACETEK array-a.
-- ────────────────────────────────────────────────────────────────────────────

UPDATE questionnaires
SET questions =
  '[{"id":"podjetje","label":"Naziv podjetja","tip":"text","obvezno":true}]'::jsonb
  || questions
WHERE slug IN ('napredni-ai', 'pred-delavnico')
  AND NOT (questions @> '[{"id":"podjetje"}]'::jsonb);
