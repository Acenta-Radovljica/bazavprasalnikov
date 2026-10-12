-- ────────────────────────────────────────────────────────────────────────────
-- Migracija 016 — Popis opravil (vprasalnik za zaposlene)
-- Zaposleni opisejo do tri ponavljajoca se opravila (pogostost + cas), aplikacija
-- iz tega izracuna ure na mesec (public/admin/popis.js). Vsako podjetje ima svojo
-- povezavo /popis/<koda>, zato zaposleni naziva podjetja ne vpisujejo: prosto
-- vpisan naziv je pri vprasalniku pred delavnico posiljal odgovore v
-- NEZNANO_PODJETJE (glej 008).
-- Idempotentno, tece ob vsakem zagonu.
-- ────────────────────────────────────────────────────────────────────────────

-- Koda povezave: 12 hex znakov iz gen_random_uuid (krepka nakljucnost, 48 bitov),
-- ki je ni mogoce uganiti. Volatilen privzetek dobi vsaka obstojeca vrstica
-- posebej, nova podjetja pa ob vstavljanju. "Zamenjaj povezavo" (api.js) jo
-- prepise, stara povezava takoj preneha delovati.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS popis_koda TEXT UNIQUE
  DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

-- Vprasalnik, na katerega se shranjujejo oddaje. namen='shramba': splosni AI
-- povzetek in priporocila ne tecejo. questions=[], ker vprasanja zivijo v kodi
-- (public/admin/popis.js) in gredo v vsak odgovor kot questions_snapshot.
-- Javni /f/popis-opravil je zaprt (form.js): brez kode ne vemo, cigavo je.
INSERT INTO questionnaires (
  slug, naziv_prikaz, opis, questions,
  povzetek_system_prompt, povzetek_user_template,
  priporocila_system_prompt, priporocila_user_template,
  aktivna, namen
) VALUES (
  'popis-opravil',
  'Popis opravil',
  'Kratek vprasalnik za zaposlene: do tri ponavljajoca se opravila s pogostostjo in casom. Povezavo za podjetje kopirate na strani podjetja (kartica Popis opravil).',
  '[]'::jsonb, '', '', '', '',
  TRUE, 'shramba'
) ON CONFLICT (slug) DO NOTHING;
