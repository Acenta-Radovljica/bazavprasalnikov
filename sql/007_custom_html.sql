-- ────────────────────────────────────────────────────────────────────────────
-- Migracija 007 — custom_html obrazec na questionnaires
-- Omogoci, da admin nalozi CEL HTML obrazec v bazo. Ce je custom_html nastavljen,
-- ga GET /f/:slug postreze dobesedno (namesto avto-generiranega obrazca iz
-- "questions"). Tako lahko dodamo nov bogat HTML vprasalnik brez nove staticne
-- datoteke in brez deploya — samo prilepimo HTML v adminu.
-- Polje je nullable TEXT (prazno = navaden avto-obrazec). Idempotentno.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE questionnaires ADD COLUMN IF NOT EXISTS custom_html TEXT;
