-- ── 010: kopija vprasalnika ob oddaji odgovora ─────────────────────────────
--
-- Do zdaj se je pri odgovoru shranil SAMO raw_data (odgovori). Vprasanja so se
-- ob prikazu pripela iz vprasalnika, kakrsen je DANES (api.js JOIN questionnaires).
-- Posledice, vse tri tihe:
--   1. preimenovano vprasanje -> novo besedilo nad starim odgovorom,
--   2. izbrisano vprasanje    -> odgovor ostane, a pod surovim kljucem,
--   3. custom_html obrazci    -> questions je prazen, zato besedil vprasanj ni sploh.
--
-- To je ista napaka, ki jo process_sessions.questions_snapshot (migracija 009)
-- resuje eno plast visje. Tu jo resimo se pri lead odgovorih.
--
-- custom_html se hrani cel, ker je pri teh obrazcih vprasalnik prav ta HTML in
-- ne questions polje. Pri obsegu tega orodja (nekaj deset oddaj) je to nekaj MB
-- na leto; ce bi kdaj naraslo, se blob preseli v loceno tabelo razlicic.

ALTER TABLE responses ADD COLUMN IF NOT EXISTS questions_snapshot   JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS custom_html_snapshot TEXT;

-- ── Zapolnitev za nazaj ────────────────────────────────────────────────────
-- NA SPLOSNO SE NE DELA. Pravih vprasanj iz casa starih oddaj ni nikjer, zato
-- bi vpis danasnjih pomenil izmisljeno zgodovino; take vrstice raje ostanejo
-- prazne in jih vmesnik oznaci.
--
-- IZJEMA (Maksova odlocitev 28. 8. 2026): oddaja Avtohise Radanovic na
-- vprasalniku review-agent-avto-intake. Tam vpis NI ugibanje, ampak dejstvo:
-- vprasalnik je bil nazadnje urejen 11. 8. 2026, oddaja je z 26. 8. 2026, zato
-- je danasnji custom_html natanko tista razlicica, ki jo je stranka videla.
--
-- Pogoj r.submitted_at >= q.updated_at to preveri v sami migraciji: ce kdo
-- vprasalnik odslej uredi, se blok tiho ne izvede in laznega zapisa ni.
-- Pogoj custom_html_snapshot IS NULL naredi migracijo idempotentno (poganja se
-- ob vsakem bootu) in prepreci, da bi kdaj povozila pravi, ob oddaji zajet zapis.
UPDATE responses r
   SET custom_html_snapshot = q.custom_html,
       questions_snapshot   = q.questions
  FROM questionnaires q
 WHERE q.id = r.questionnaire_id
   AND q.slug = 'review-agent-avto-intake'
   AND r.custom_html_snapshot IS NULL
   AND q.custom_html IS NOT NULL
   AND q.custom_html <> ''
   AND r.submitted_at >= q.updated_at;
