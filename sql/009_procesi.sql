-- ────────────────────────────────────────────────────────────────────────────
-- Migracija 009 — procesni vprasalniki (FAZA 1 Acenta Hotel AI Framework)
--
-- KONTEKST: monday task 12878305728 "Vprasalniki/transcripti - priprava
-- aplikacije" (Maja Lesjak, 24. 8. 2026). Komercialist na prodajnem sestanku
-- izpolnjuje vprasalnik ZIVO, doda Soniox povezavo do transkripta, aplikacija
-- transkript prekopira v svojo bazo in izpolnjen vprasalnik poslje stranki.
--
-- NACELO TE MIGRACIJE: nicesar ne odvzame in nicesar ne prepise.
--   - tabele companies / responses / cross_client_insights se NE dotakne
--   - javni lead tok (/f/:slug -> responses -> AI) ostane nespremenjen
--   - edina sprememba obstojece sheme je SIROKA omejitev namen (dodana vrednost
--     'proces'), kar ne more razveljaviti nobene obstojece vrstice
--
-- Vse je idempotentno, ker src/server.js pozene VSE sql/*.sql ob vsakem zagonu.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. Razsiritev omejitve namen: dodamo 'proces' ──────────────────────────
-- Migracija 006 je postavila CHECK (namen IN ('lead','shramba')). Procesni
-- vprasalniki so tretja vrsta: ne gredo v javni obrazec in ne sprozijo AI
-- lead toka. DROP + ADD (namesto pogojnega ADD) zato, ker mora biti definicija
-- omejitve po tej migraciji DETERMINISTICNA — ce bi jo samo pogojno dodajali,
-- bi baza, ki ze ima staro dvovrednostno omejitev, ostala na stari razlicici.
-- Sirjenje CHECK-a je varno: vsaka vrstica, ki je zadoscala stari omejitvi,
-- zadosca tudi novi.
ALTER TABLE questionnaires DROP CONSTRAINT IF EXISTS questionnaires_namen_check;
ALTER TABLE questionnaires ADD CONSTRAINT questionnaires_namen_check
  CHECK (namen IN ('lead', 'shramba', 'proces'));

-- ── 2. Tabela process_sessions ─────────────────────────────────────────────
-- Eno IZPOLNJEVANJE vprasalnika = ena vrstica = en prodajni sestanek za en
-- proces pri eni stranki. Hotel ima vec procesov (urniki, jedilniki, revenue),
-- zato je (company_id, proces) tipicno vec vrstic na isto podjetje.
--
-- KLJUCNA ODLOCITEV — questions_snapshot:
-- Vprasanja se ob zacetku seje PREKOPIRAJO iz predloge v sejo. Zato:
--   (a) komercialist lahko vprasanja prilagodi TEJ stranki, brez da bi
--       spremenil predlogo za vse ostale (Majina zahteva "prilagajanje
--       vprasalnika glede na stranko oziroma proces");
--   (b) kasnejse urejanje predloge NIKOLI ne spremeni ze izpolnjenega
--       vprasalnika iz preteklosti — cez pol leta vidis natanko tisto,
--       kar je bilo takrat vprasano.
-- Brez tega locevanja bi bila zgodovina laziva, popravek pa drag.
CREATE TABLE IF NOT EXISTS process_sessions (
  id                 SERIAL PRIMARY KEY,
  questionnaire_id   INTEGER NOT NULL REFERENCES questionnaires(id) ON DELETE RESTRICT,
  company_id         INTEGER REFERENCES companies(id) ON DELETE SET NULL,

  -- Prosto ime stranke za primer, ko podjetja se ni v tabeli companies
  -- (na sestanku ni casa za urejanje sifrantov). Sinhronizacija na
  -- companies je locen, kasnejsi korak.
  stranka_naziv      TEXT NOT NULL,
  proces             TEXT,
  oddelek            TEXT,
  svetovalec         TEXT,
  datum_sestanka     DATE,

  -- osnutek   = se izpolnjuje (privzeto; sestanek v teku)
  -- zakljucen = komercialist je koncal, podatki gredo v interni kick-off
  -- poslan    = izpolnjen vprasalnik je bil poslan stranki na email
  -- arhiv     = ne prikazuj na privzetem seznamu
  status             TEXT NOT NULL DEFAULT 'osnutek',

  questions_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  answers            JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- AI analiza TE seje (locena od cross-analize vec sej).
  ai_povzetek        TEXT,
  ai_povzetek_at     TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  zakljucen_at       TIMESTAMPTZ
);

-- Omejitev statusa v locenem DO bloku: ADD CONSTRAINT ni IF NOT EXISTS,
-- migracija pa se vrti ob vsakem bootu.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'process_sessions'
       AND constraint_name = 'process_sessions_status_check'
  ) THEN
    ALTER TABLE process_sessions ADD CONSTRAINT process_sessions_status_check
      CHECK (status IN ('osnutek', 'zakljucen', 'poslan', 'arhiv'));
  END IF;
END $$;

-- ── 3. Tabela process_transcripts ──────────────────────────────────────────
-- Majina izrecna zahteva: "ne shranjuje se samo Soniox povezava. Surov
-- transkript se mora dejansko kopirati in dolgorocno shraniti znotraj
-- aplikacije, ker ni zagotovljeno, da bo Soniox povezava ostala aktivna."
--
-- Zato je raw_text tisti stolpec, ki steje, soniox_url pa je le metapodatek
-- o izvoru. vir='rocno' pomeni, da je transkript prilepil clovek; vir='api'
-- ali 'scrape', da ga je aplikacija potegnila sama.
--
-- Vec transkriptov na sejo je dovoljeno (sestanek v dveh delih, popravljena
-- verzija), zato NI unique na session_id — najnovejsi po fetched_at zmaga.
CREATE TABLE IF NOT EXISTS process_transcripts (
  id           SERIAL PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES process_sessions(id) ON DELETE CASCADE,
  soniox_url   TEXT,
  raw_text     TEXT,
  znakov       INTEGER,
  vir          TEXT NOT NULL DEFAULT 'rocno',
  status       TEXT NOT NULL DEFAULT 'ok',
  napaka       TEXT,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'process_transcripts'
       AND constraint_name = 'process_transcripts_vir_check'
  ) THEN
    ALTER TABLE process_transcripts ADD CONSTRAINT process_transcripts_vir_check
      CHECK (vir IN ('rocno', 'api', 'scrape'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'process_transcripts'
       AND constraint_name = 'process_transcripts_status_check'
  ) THEN
    ALTER TABLE process_transcripts ADD CONSTRAINT process_transcripts_status_check
      CHECK (status IN ('ok', 'caka', 'napaka'));
  END IF;
END $$;

-- ── 4. Tabela process_emails ───────────────────────────────────────────────
-- Revizijska sled poslanih emailov. Brez nje ne moremo odgovoriti na
-- "ali je stranka to res dobila in kdaj" — pri prodajnem procesu je to
-- vprasanje, ki se ZANESLJIVO pojavi.
CREATE TABLE IF NOT EXISTS process_emails (
  id          SERIAL PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES process_sessions(id) ON DELETE CASCADE,
  prejemnik   TEXT NOT NULL,
  zadeva      TEXT,
  status      TEXT NOT NULL DEFAULT 'poslan',
  resend_id   TEXT,
  napaka      TEXT,
  poslal      TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'process_emails'
       AND constraint_name = 'process_emails_status_check'
  ) THEN
    ALTER TABLE process_emails ADD CONSTRAINT process_emails_status_check
      CHECK (status IN ('poslan', 'napaka'));
  END IF;
END $$;

-- ── 5. Indeksi ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_psessions_company     ON process_sessions(company_id);
CREATE INDEX IF NOT EXISTS idx_psessions_quest       ON process_sessions(questionnaire_id);
CREATE INDEX IF NOT EXISTS idx_psessions_status      ON process_sessions(status);
CREATE INDEX IF NOT EXISTS idx_psessions_updated     ON process_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ptranscripts_session  ON process_transcripts(session_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_pemails_session       ON process_emails(session_id, sent_at DESC);

-- Iskanje cez odgovore + transkript (za "kje smo se pogovarjali o urnikih").
CREATE INDEX IF NOT EXISTS idx_psessions_search ON process_sessions
  USING GIN (to_tsvector('simple',
    coalesce(stranka_naziv, '') || ' ' ||
    coalesce(proces, '') || ' ' ||
    coalesce(answers::text, '')));

-- ── 6. Seed predloge: "Ocena poslovnega potenciala za AI" ──────────────────
-- Vir: 4.bOcena_poslovnega_potenciala_za_AI_obrazec.docx (priponka na monday
-- tasku, 24. 8. 2026) — 8 sklopov, prepisani dobesedno.
--
-- Prompti so prazni nizi: stolpci so NOT NULL brez defaulta (migracija 002),
-- procesni vprasalniki pa NE gredo skozi lead AI tok. Isti vzorec kot pri
-- namen='shramba' v migraciji 006.
--
-- ON CONFLICT (slug) DO NOTHING — da deploy nikoli ne prepise sprememb,
-- ki jih je Maja naredila v admin urejevalniku.
INSERT INTO questionnaires (
  slug, naziv_prikaz, opis, questions,
  povzetek_system_prompt, povzetek_user_template,
  priporocila_system_prompt, priporocila_user_template,
  aktivna, namen
) VALUES (
  'ocena-poslovnega-potenciala-ai',
  'Ocena poslovnega potenciala za AI',
  'FAZA 1 — prvi prodajni sestanek s stranko. Izpolni se, kadar obravnavamo novo panogo, nov proces ali bistveno spremenjen obstoječi proces. Vir: Acenta model uvajanja umetne inteligence v hotelirstvu.',
  $qq$[
  {
    "id": "hotel",
    "label": "Hotel",
    "tip": "text",
    "obvezno": true
  },
  {
    "id": "oddelek",
    "label": "Oddelek oziroma področje",
    "tip": "text"
  },
  {
    "id": "datum",
    "label": "Datum",
    "tip": "date"
  },
  {
    "id": "svetovalec",
    "label": "Svetovalec Acente",
    "tip": "text"
  },
  {
    "id": "predstavniki",
    "label": "Sodelujoči predstavniki hotela",
    "tip": "textarea"
  },
  {
    "id": "s1",
    "label": "1. Poslovni cilj in problem",
    "tip": "section"
  },
  {
    "id": "cilj",
    "label": "Kaj želi hotel izboljšati? (poslovni cilj)",
    "tip": "textarea",
    "obvezno": true
  },
  {
    "id": "problem",
    "label": "Kaj je danes glavni problem?",
    "tip": "textarea",
    "obvezno": true
  },
  {
    "id": "vpliv",
    "label": "Kako problem vpliva na prihodke, stroške, čas, kakovost ali EBITDA?",
    "tip": "textarea"
  },
  {
    "id": "korist",
    "label": "Najpomembnejša pričakovana korist",
    "tip": "checkbox_multi",
    "drugo": true,
    "options": [
      "več prihodkov",
      "nižji stroški",
      "prihranek časa",
      "manj napak",
      "boljše odločitve",
      "boljša storitev",
      "manjše tveganje"
    ]
  },
  {
    "id": "korist_stevilke",
    "label": "Kako bi korist opisali ali ocenili v številkah?",
    "tip": "textarea"
  },
  {
    "id": "s2",
    "label": "2. Proces in trenutno stanje",
    "tip": "section"
  },
  {
    "id": "proces_naziv",
    "label": "Naziv procesa",
    "tip": "text",
    "obvezno": true
  },
  {
    "id": "proces_meje",
    "label": "Kje se proces začne in kaj je njegov končni rezultat?",
    "tip": "textarea",
    "obvezno": true,
    "poudarek": true,
    "namig": "Rezultat tega procesa je pogosto osnova za vse nadaljnje procese, ki jih stranka opiše na sestanku. Zapišite ga dovolj konkretno."
  },
  {
    "id": "proces_pogostost",
    "label": "Kako pogosto se izvaja?",
    "tip": "text"
  },
  {
    "id": "proces_izvajalci",
    "label": "Kdo proces izvaja in kdo je zanj odgovoren?",
    "tip": "textarea"
  },
  {
    "id": "proces_obremenitev",
    "label": "Koliko časa oziroma dela danes zahteva?",
    "tip": "text"
  },
  {
    "id": "s3",
    "label": "3. Ključna odločitev",
    "tip": "section"
  },
  {
    "id": "odlocitev",
    "label": "Katera ključna odločitev najbolj vpliva na rezultat procesa?",
    "tip": "textarea",
    "obvezno": true
  },
  {
    "id": "odlocitev_kdo",
    "label": "Kdo danes sprejema to odločitev?",
    "tip": "text"
  },
  {
    "id": "odlocitev_podatki",
    "label": "Katere informacije ali podatke potrebuje za odločitev?",
    "tip": "textarea"
  },
  {
    "id": "odlocitev_pravila",
    "label": "Katera glavna pravila mora upoštevati?",
    "tip": "textarea"
  },
  {
    "id": "odlocitev_izjeme",
    "label": "Katere izjeme se najpogosteje pojavljajo?",
    "tip": "textarea"
  },
  {
    "id": "odlocitev_posledica",
    "label": "Kakšna je posledica napačne ali prepozne odločitve?",
    "tip": "textarea"
  },
  {
    "id": "odlocitev_razlicno",
    "label": "Ali različni zaposleni ob podobnem primeru odločajo različno?",
    "tip": "radio",
    "options": [
      "da",
      "delno",
      "ne"
    ]
  },
  {
    "id": "odlocitev_preverljiva",
    "label": "Ali je kakovost odločitve mogoče naknadno preveriti?",
    "tip": "radio",
    "options": [
      "da",
      "delno",
      "ne"
    ]
  },
  {
    "id": "s4",
    "label": "4. Podatki za dokazovanje trenutnega stanja",
    "tip": "section"
  },
  {
    "id": "podatki_dokazi",
    "label": "Kateri preverjeni podatki ali dejstva dokazujejo problem? Navedite tudi vir.",
    "tip": "textarea"
  },
  {
    "id": "podatki_manjkajo",
    "label": "Kateri pomembni podatki še manjkajo?",
    "tip": "textarea"
  },
  {
    "id": "podatki_domneve",
    "label": "Katere domneve moramo še preveriti?",
    "tip": "textarea"
  },
  {
    "id": "s5",
    "label": "5. Merjenje uspeha",
    "tip": "section",
    "namig": "Izberite največ tri kazalnike, ki bodo pokazali, ali je rešitev uspešna."
  },
  {
    "id": "kazalniki",
    "label": "Kazalniki uspešnosti",
    "tip": "table",
    "vrstice": 3,
    "columns": [
      "Kazalnik",
      "Začetno stanje",
      "Želeni rezultat",
      "Vir podatkov"
    ]
  },
  {
    "id": "s6",
    "label": "6. Obseg in odgovornosti",
    "tip": "section"
  },
  {
    "id": "obseg_vkljuceno",
    "label": "Kaj vključuje prvi obseg projekta?",
    "tip": "textarea"
  },
  {
    "id": "obseg_izkljuceno",
    "label": "Kaj v prvi fazi ni vključeno?",
    "tip": "textarea"
  },
  {
    "id": "lastnik_cilja",
    "label": "Lastnik poslovnega cilja",
    "tip": "text"
  },
  {
    "id": "lastnik_procesa",
    "label": "Lastnik procesa oziroma ključne odločitve",
    "tip": "text"
  },
  {
    "id": "pilot_sodelujoci",
    "label": "Kdo bo sodeloval pri pilotu?",
    "tip": "textarea"
  },
  {
    "id": "vodstvo_podpira",
    "label": "Ali vodstvo podpira izvedbo?",
    "tip": "radio",
    "options": [
      "da",
      "delno",
      "še ni potrjeno",
      "ne"
    ]
  },
  {
    "id": "s7",
    "label": "7. Primernost za AI in omejitve",
    "tip": "section"
  },
  {
    "id": "ai_pomoc",
    "label": "Kako bi lahko pomagala umetna inteligenca?",
    "tip": "checkbox_multi",
    "drugo": true,
    "options": [
      "predlog odločitve",
      "preverjanje pravil",
      "primerjava možnosti",
      "analiza podatkov",
      "opozorila na izjeme",
      "utemeljitev"
    ]
  },
  {
    "id": "brez_ai",
    "label": "Bi lahko problem enostavneje rešili brez AI?",
    "tip": "radio",
    "options": [
      "ne",
      "morda",
      "da"
    ]
  },
  {
    "id": "brez_ai_pojasnilo",
    "label": "Pojasnilo",
    "tip": "textarea"
  },
  {
    "id": "omejitve",
    "label": "Katere pomembne omejitve že poznamo?",
    "tip": "checkbox_multi",
    "drugo": true,
    "options": [
      "manjkajoči ali nezanesljivi podatki",
      "osebni podatki",
      "zakonodaja ali kolektivna pogodba",
      "tehnične omejitve in integracije",
      "pomanjkanje časa"
    ]
  },
  {
    "id": "acenta_resitev",
    "label": "Ali ima Acenta za ta proces že preverjeno rešitev?",
    "tip": "radio",
    "options": [
      "da",
      "delno",
      "ne"
    ]
  },
  {
    "id": "acenta_resitev_posebnosti",
    "label": "Če da ali delno, katere posebnosti hotela moramo preveriti?",
    "tip": "textarea"
  },
  {
    "id": "s8",
    "label": "8. Odločitev svetovalca in naslednji korak",
    "tip": "section"
  },
  {
    "id": "odlocitev_svetovalca",
    "label": "Odločitev",
    "tip": "radio",
    "options": [
      "nadaljuj z obstoječo Acentino rešitvijo",
      "pridobi manjkajoče podatke in nato pripravi ponudbo",
      "izvedi dodatno diagnostiko",
      "najprej organizacijsko uredi proces",
      "ne nadaljuj"
    ]
  },
  {
    "id": "utemeljitev",
    "label": "Utemeljitev odločitve",
    "tip": "textarea"
  },
  {
    "id": "naslednji_korak",
    "label": "Naslednji korak",
    "tip": "textarea"
  },
  {
    "id": "odgovorna_oseba_rok",
    "label": "Odgovorna oseba in rok",
    "tip": "text"
  }
]$qq$::jsonb,
  '', '', '', '',
  TRUE, 'proces'
)
ON CONFLICT (slug) DO NOTHING;
