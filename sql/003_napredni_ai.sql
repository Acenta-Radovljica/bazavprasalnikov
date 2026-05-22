-- ────────────────────────────────────────────────────────────────────────────
-- Migracija 003 — vprasalnik "Napredni AI" (interno, lead qualification)
-- Cilj: kvalificirati napredne AI uporabnike, ki bi bili dobri leadi Acenta.si
-- za svetovanje / delavnice za napredne / implementacijo / mentoring / outsourcing.
-- ON CONFLICT (slug) DO NOTHING — varno za ponovni zagon, ne prepise rocnih
-- sprememb v admin UI.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO questionnaires (
  slug, naziv_prikaz, opis, questions,
  povzetek_system_prompt, povzetek_user_template,
  priporocila_system_prompt, priporocila_user_template,
  aktivna
) VALUES (
  'napredni-ai',
  'Napredni AI — anketa',
  'Anketa za napredne uporabnike AI. Pomaga razumeti njihove procese, izzive in cilje, da Acenta lahko ponudi prilagojene resitve. Anonimna, ~5 minut.',
  $q$[
    {
      "id": "q1_zrelost",
      "label": "Kako bi opisali zrelost uporabe AI v vašem podjetju?",
      "tip": "radio",
      "obvezno": true,
      "options": [
        "Posamezni uporabniki (ad hoc uporaba)",
        "Standardizirana uporaba v ekipah",
        "Integrirano v procese (workflowi, avtomatizacije)",
        "AI kot del produkta/storitve",
        "AI-first podjetje"
      ]
    },
    {
      "id": "q2_procesi",
      "label": "Koliko procesov imate trenutno avtomatiziranih z AI?",
      "tip": "radio",
      "obvezno": true,
      "options": ["0–5", "6–15", "15–30", "30+"]
    },
    {
      "id": "q3_resitve",
      "label": "Katere tipe rešitev uporabljate? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "ChatGPT, Claude / LLM orodja",
        "Custom GPT / Claude agenti",
        "API integracije (OpenAI, Anthropic …)",
        "No-code/low-code (Zapier, Make …)",
        "Lastni AI modeli",
        "RPA + AI kombinacije"
      ]
    },
    {
      "id": "q4_implementacija",
      "label": "Kako implementirate AI rešitve? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "Ročna uporaba (chat)",
        "Popolnoma avtomatizirani procesi",
        "Integrirano v interne sisteme (CRM, ERP …)",
        "Lastni produkti"
      ]
    },
    {
      "id": "q5_orodja",
      "label": "Katere tehnologije ali orodja uporabljate? (npr. n8n, LangChain, Pinecone, Cursor …)",
      "tip": "textarea",
      "obvezno": false
    },
    {
      "id": "q6_agenti",
      "label": "Ali uporabljate AI agente ali robote? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "Ne",
        "Da — enostavni (task-based)",
        "Da — kompleksni (multi-step, memory, tool use)",
        "Drugo"
      ]
    },
    {
      "id": "q7_vrednost",
      "label": "Kje AI trenutno ustvarja največjo vrednost? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "Marketing",
        "Prodaja",
        "Operativa",
        "Podpora strankam",
        "Razvoj (dev)",
        "Analitika",
        "Drugo"
      ]
    },
    {
      "id": "q8_uspesnost",
      "label": "Kako merite uspešnost AI rešitev? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "Prihranek časa",
        "Znižanje stroškov",
        "Povečanje prihodkov",
        "KPI-ji (npr. conversion rate)",
        "Ne merimo sistematično"
      ]
    },
    {
      "id": "q10_vpliv_produktivnost",
      "label": "Vpliv AI na produktivnost (1 = ni vpliva, 5 = velik pozitiven vpliv)",
      "tip": "select",
      "obvezno": true,
      "options": ["1", "2", "3", "4", "5"]
    },
    {
      "id": "q11_vpliv_prihodki",
      "label": "Vpliv AI na prihodke (1 = ni vpliva, 5 = velik pozitiven vpliv)",
      "tip": "select",
      "obvezno": true,
      "options": ["1", "2", "3", "4", "5"]
    },
    {
      "id": "q12_vpliv_stroski",
      "label": "Vpliv AI na stroške (1 = ni vpliva, 5 = velik prihranek)",
      "tip": "select",
      "obvezno": true,
      "options": ["1", "2", "3", "4", "5"]
    },
    {
      "id": "q13_vpliv_kakovost",
      "label": "Vpliv AI na kakovost dela (1 = ni vpliva, 5 = velik pozitiven vpliv)",
      "tip": "select",
      "obvezno": true,
      "options": ["1", "2", "3", "4", "5"]
    },
    {
      "id": "q14_izzivi",
      "label": "Kateri so vaši največji izzivi pri uporabi AI? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "Integracija v obstoječe sisteme",
        "Kakovost outputov (halucinacije)",
        "Varnost podatkov",
        "Skaliranje rešitev",
        "Stroški (API, infrastruktura)",
        "Znanje zaposlenih",
        "Upravljanje promptov / agentov",
        "Governance / compliance"
      ]
    },
    {
      "id": "q15_ovira",
      "label": "Kaj vas trenutno najbolj zavira pri širši uporabi AI?",
      "tip": "textarea",
      "obvezno": false
    },
    {
      "id": "q16_cilji",
      "label": "Kakšni so vaši cilji za AI v naslednjih 12 mesecih? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "Več avtomatizacije",
        "Razvoj lastnih AI rešitev",
        "Uvedba AI v vse oddelke",
        "AI kot del produkta",
        "Optimizacija obstoječih rešitev"
      ]
    },
    {
      "id": "q17_strategija",
      "label": "Na kateri stopnji ste glede AI strategije?",
      "tip": "radio",
      "obvezno": true,
      "options": [
        "Nimamo strategije",
        "V pripravi",
        "Delno implementirana",
        "Jasno definirana in izvajana"
      ]
    },
    {
      "id": "q18_podpora",
      "label": "Kje potrebujete največ podpore? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "Napredni prompting",
        "AI agenti",
        "Integracije (API, sistemi)",
        "Avtomatizacije workflowov",
        "AI strategija",
        "Varnost in compliance",
        "Optimizacija stroškov",
        "Razvoj produktov z AI"
      ]
    },
    {
      "id": "q19_sodelovanje",
      "label": "Kakšna oblika sodelovanja bi bila za vas najbolj zanimiva? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "Svetovanje",
        "Delavnice za napredne",
        "Implementacija rešitev",
        "Mentoring / coaching",
        "Outsourcing AI rešitev"
      ]
    },
    {
      "id": "q20_usecase",
      "label": "Opišite en konkreten AI use-case, ki vam trenutno prinaša največ vrednosti.",
      "tip": "textarea",
      "obvezno": false
    },
    {
      "id": "q21_problem",
      "label": "Opišite problem ali proces, ki ga še niste uspeli rešiti z AI.",
      "tip": "textarea",
      "obvezno": false
    },
    {
      "id": "q22_budget",
      "label": "Kolikšen je vaš približen mesečni budget za AI?",
      "tip": "radio",
      "obvezno": true,
      "options": ["< 100 €", "100–500 €", "500–2.000 €", "2.000 €+"]
    },
    {
      "id": "q23_email",
      "label": "Email za kontakt (opcijsko — pustite prazno, če želite ostati anonimni)",
      "tip": "email",
      "obvezno": false
    }
  ]$q$::jsonb,

  -- ── POVZETEK system prompt ────────────────────────────────────────────────
  $pp$Si analist agencije Acenta.si. Iz odgovorov ankete "Napredni AI" izlušči kratek povzetek profila respondenta. V slovenščini, konkretno, brez floskul. Vrni TOČNO 5 točk. Vsaka točka <40 besed.$pp$,

  -- ── POVZETEK user template ────────────────────────────────────────────────
  $pp$Odgovori respondenta:

{podatki}

Pripravi povzetek v 5 točkah:
1. PROFIL: stopnja AI zrelosti (Q1) + približno število avtomatiziranih procesov (Q2) + ključne tehnologije (Q5)
2. KJE USTVARJA VREDNOST: top 2 področji (Q7) + 1 konkreten use case (Q20, če je naveden)
3. IZZIVI: top 2 izziva (Q14) + glavna ovira pri širšem prevzemu (Q15, če je navedena)
4. CILJI 12M: top 2 cilja (Q16) + stopnja strategije (Q17)
5. FIT ZA ACENTO: tip podpore (Q18) + oblika sodelovanja (Q19) + budget (Q22) + kvalifikacija leada (HOT / WARM / COLD) z enim stavkom razlage

Brez uvoda, samo 5 točk.$pp$,

  -- ── PRIPOROCILA system prompt ─────────────────────────────────────────────
  $pp$Si svetovalec Acenta.si za napredne AI projekte. Iz ene ankete pripravi konkretno priporočilo za prvi sestanek — kako kvalificirati lead, kaj predlagati, katera Acenta storitev je najbolj smiselna. V slovenščini, brez floskul. Bodi operativen.$pp$,

  -- ── PRIPOROCILA user template ─────────────────────────────────────────────
  $pp$Respondent (en anketni vnos):
{respondenti}

Pripravi:

## 1. KVALIFIKACIJA LEADA
Stopnja: HOT / WARM / COLD. V 2 stavkih razloži, zakaj — upoštevaj AI zrelost (Q1), budget (Q22), jasnost problema (Q21) in oblike sodelovanja, ki jih iščejo (Q19).

## 2. PREDLAGANA NASLEDNJA AKCIJA
Konkretno: discovery klic, delavnica za napredne, takojšen pilot, mentoring? Z razlogom v enem stavku.

## 3. TEHNIČNI FIT — KATERA ACENTA STORITEV
Izberi 1–2 storitvi (svetovanje / delavnica za napredne / implementacija / mentoring / outsourcing) in v enem stavku za vsako razloži, zakaj se ujema z njihovim profilom.

## 4. PRIPRAVA NA SESTANEK
3 konkretna vprašanja, ki naj jih komercialist postavi na prvem klicu. Ne ponavljaj vprašanj, ki so že odgovorjena v anketi.

## 5. ROI ZA RESPONDENTA
1–2 stavka: kaj bi konkretno pridobili z Acento glede na nerešen problem (Q21) in ovire (Q15).$pp$,

  TRUE
)
ON CONFLICT (slug) DO NOTHING;
