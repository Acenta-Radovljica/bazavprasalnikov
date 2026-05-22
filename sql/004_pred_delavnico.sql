-- ────────────────────────────────────────────────────────────────────────────
-- Migracija 004 — vprasalnik "Pred delavnico" (anketa pred AI izobrazevanjem)
-- Cilj: zbrati nivo znanja, pricakovanja in pain pointe udelezencev delavnice,
-- da Acenta prilagodi vsebino in primere njihovi praksi.
-- Anonimna, ~5 minut, brez email kontakta (udelezenci so ze znani).
-- ON CONFLICT (slug) DO NOTHING — varno za ponovni zagon, ne prepise rocnih
-- sprememb v admin UI.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO questionnaires (
  slug, naziv_prikaz, opis, questions,
  povzetek_system_prompt, povzetek_user_template,
  priporocila_system_prompt, priporocila_user_template,
  aktivna
) VALUES (
  'pred-delavnico',
  'AI delavnica — anketa pred izobraževanjem',
  'Anketa pred AI delavnico. Zbira nivo znanja, izkušnje, potrebe in pričakovanja udeležencev, da delavnico vsebinsko in praktično prilagodimo njihovemu delu. Anonimna, ~5 minut.',
  $q$[
    {
      "id": "q1_pogostost",
      "label": "Kako pogosto trenutno uporabljate orodja AI?",
      "tip": "radio",
      "obvezno": true,
      "options": [
        "Vsak dan",
        "Pogosto (večkrat na teden)",
        "Občasno (1–2× na teden)",
        "Redko (1–2× na mesec)",
        "Nikoli"
      ]
    },
    {
      "id": "q2_kje",
      "label": "Kje AI orodja največ uporabljate? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "V službi",
        "Doma",
        "Pri učenju / raziskovanju",
        "Trenutno jih ne uporabljam"
      ]
    },
    {
      "id": "q4_razumevanje",
      "label": "Kako ocenjujete svoje splošno razumevanje AI? (1 = slabo, 4 = zelo dobro)",
      "tip": "select",
      "obvezno": true,
      "options": ["1", "2", "3", "4"]
    },
    {
      "id": "q5_orodja_znanje",
      "label": "Kako dobro poznate konkretna AI orodja (npr. ChatGPT, Copilot, Gemini …)? (1 = slabo, 4 = zelo dobro)",
      "tip": "select",
      "obvezno": true,
      "options": ["1", "2", "3", "4"]
    },
    {
      "id": "q6_prompti",
      "label": "Kako dobro znate pisati učinkovite prompte za AI? (1 = slabo, 4 = zelo dobro)",
      "tip": "select",
      "obvezno": true,
      "options": ["1", "2", "3", "4"]
    },
    {
      "id": "q7_omejitve",
      "label": "V kolikšni meri ste seznanjeni z omejitvami, tveganji in etičnimi vprašanji pri uporabi AI? (1 = slabo, 4 = zelo dobro)",
      "tip": "select",
      "obvezno": true,
      "options": ["1", "2", "3", "4"]
    },
    {
      "id": "q8_zelje",
      "label": "Kaj bi si najbolj želeli pridobiti na AI delavnici? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "Ideje, kako AI vključiti v vsakodnevne procese",
        "Osnovno razumevanje, kaj AI zmore in česa ne",
        "Praktične primere za moje delo",
        "Primerjavo različnih AI orodij",
        "Opozorila glede napak, varnosti in etike"
      ]
    },
    {
      "id": "q9_primeri",
      "label": "Kateri tipi primerov bi vam bili najbolj koristni? (možnih je več odgovorov)",
      "tip": "checkbox",
      "obvezno": true,
      "options": [
        "Pisanje besedil (e-maili, objave, opisi)",
        "Analiza podatkov / povzetki",
        "Marketing / oglaševanje",
        "Prodaja",
        "Podpora strankam",
        "Interni procesi",
        "Drugo"
      ]
    },
    {
      "id": "q10_naloge",
      "label": "Katere naloge pri svojem delu bi najraje optimizirali z AI?",
      "tip": "textarea",
      "obvezno": false
    },
    {
      "id": "q11_ovira",
      "label": "Kaj vam je pri uporabi AI trenutno največja težava ali ovira?",
      "tip": "textarea",
      "obvezno": false
    },
    {
      "id": "q12_ideja",
      "label": "Ali imate idejo za uporabo AI, vendar ne veste, kako jo izvesti? Opišite jo.",
      "tip": "textarea",
      "obvezno": false
    },
    {
      "id": "q13_orodja_poznana",
      "label": "Katera AI orodja že poznate in jih uporabljate?",
      "tip": "textarea",
      "obvezno": false
    }
  ]$q$::jsonb,

  -- ── POVZETEK system prompt ────────────────────────────────────────────────
  $pp$Si analist agencije Acenta.si. Iz odgovorov ankete "Pred delavnico" izlušči kratek profil udeleženca AI delavnice. V slovenščini, konkretno, brez floskul. Vrni TOČNO 4 točke. Vsaka točka <40 besed.$pp$,

  -- ── POVZETEK user template ────────────────────────────────────────────────
  $pp$Odgovori udeleženca:

{podatki}

Pripravi povzetek v 4 točkah:
1. NIVO ZNANJA: pogostost uporabe AI (Q1) + povprečje samoocen (Q4-Q7 lestvice 1-4) + ali ima napreden/začetniški profil
2. KJE UPORABLJA AI: konteksti (Q2) + konkretna orodja, ki jih že pozna (Q13, če navedena)
3. PRIČAKOVANJA OD DELAVNICE: top 2 stvari, ki si jih želi pridobiti (Q8) + tip primerov, ki bi mu koristili (Q9)
4. KLJUČNA OVIRA / PRILOŽNOST: 1 stavek o glavni oviri (Q11) + 1 stavek o nerealizirani ideji (Q12) — fokus na to, kar lahko delavnica neposredno reši

Brez uvoda, samo 4 točke.$pp$,

  -- ── PRIPOROCILA system prompt ─────────────────────────────────────────────
  $pp$Si AI trener pri Acenta.si. Iz ene ankete pred delavnico pripravi konkretno priporočilo, kako prilagoditi vsebino delavnice za tega udeleženca. V slovenščini, brez floskul. Operativno — predavatelj mora po branju vedeti, kaj točno pokazati v živo.$pp$,

  -- ── PRIPOROCILA user template ─────────────────────────────────────────────
  $pp$Udeleženec (en anketni vnos):
{respondenti}

Pripravi:

## 1. PROFIL UDELEŽENCA
Nivo (začetnik / srednje napreden / napreden) z razlago v 1 stavku — utemelji s pogostostjo uporabe (Q1) in povprečjem samoocen (Q4-Q7).

## 2. PRILAGODITEV VSEBINE DELAVNICE
Razdelitev časa: koliko % osnov vs naprednih tem. Konkreten predlog (npr. "30 min osnov + 90 min naprednih primerov", "60 min osnov + 60 min praks").

## 3. KONKRETNI PRIMERI ZA UPORABO V ŽIVO
3 primere, prilagojene njihovim pričakovanjem (Q8) in tipom (Q9). Vsak primer v 1 stavku z navedbo, katero AI orodje uporabiti.

## 4. KATERA ORODJA DEMONSTRIRATI
1-2 orodji, ki ju še ne uporabljajo (primerjaj Q13 z mainstream orodji) in bi jima takoj koristili. Z razlogom.

## 5. NAJBOLJ DRAGOCEN MOMENT
1 stavek: ena tema/primer, ki bo zanj/zanjo najbolj transformativen — pogosto je to neposredna rešitev za Q11 (ovira) ali Q12 (nerealizirana ideja). Predavatelj naj ta moment poudari.$pp$,

  TRUE
)
ON CONFLICT (slug) DO NOTHING;
