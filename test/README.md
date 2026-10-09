# Testi — procesni vprašalniki (FAZA 1)

Pokrivajo modul iz migracije 009: knjižnica vprašalnikov, izpolnjevanje med
sestankom, transkripti, pošiljanje stranki. Javni lead tok je pokrit samo
regresijsko (da ga nova koda ni podrla).

## Zagon

Testi tečejo proti **ločeni testni bazi**, nikoli proti produkciji.

```bash
# 1. Testni Postgres (enkrat)
docker run -d --name bazavp-test \
  -e POSTGRES_PASSWORD=test -e POSTGRES_USER=postgres -e POSTGRES_DB=vprasalniki \
  -p 5435:5432 postgres:16-alpine

# 2. .env.test v korenu projekta (git-ignored)
#    DATABASE_URL=postgres://postgres:test@127.0.0.1:5435/vprasalniki
#    PORT=3399
#    ADMIN_USER=test@acenta.si
#    ADMIN_PASS=testgeslo123

# 3. Strežnik (migracije stečejo same ob zagonu)
(set -a; . ./.env.test; set +a; node src/server.js &)

# 4. Testi
node test/reset-testne-baze.mjs      # VEDNO pred zagonom (tudi med nabori)
node test/procesi-api.test.mjs       # 97 trditev
node test/procesi-ui.test.mjs        # 87 trditev (pravi Chrome)
node test/navigacija.test.mjs        # 126 trditev (vseh 9 admin strani, skupina Napredno)
node test/claude.test.mjs            # 30 trditev (AI odjemalec z laznim fetch, brez baze in API kljuca)
node test/naloge.test.mjs            # 44 trditev (/api/naloge + stran Danes + hash skok na kartico)
node test/analiza.test.mjs           # 106 trditev (/api/procesi/analiza + stran Primerjava)
node test/odgovori.test.mjs          # 47 trditev (kopija vprašalnika ob oddaji + besedila iz HTML)
node test/answers-rev.test.mjs       # 18 trditev (CAS zascita answers_rev, posiljanje_vklopljeno)
node test/save-guard.test.mjs        # 14 trditev (splakniVse pred Zaključi/Pošlji, veriga PATCH-ev)
node test/ujemanje.test.mjs          # 51 trditev (ujemanje podjetij: domena, kratice, mozen dvojnik; lazen AI)
node test/katalog.test.mjs           # 68 trditev (katalog resitev + interne opombe: API, stran Katalog z vsemi gumbi in telefonom, opombe na podjetju, ZIP)
node test/izvoz.test.mjs             # 87 trditev (izvoz za Claude: ZIP, prevod odgovorov, imena datotek, navodila; brez streznika)
node test/izvoz-api.test.mjs         # 43 trditev (/api/companies/:id/izvoz + gumb na strani podjetja + regresija strani odgovora)
node test/prodajni-predlog.test.mjs  # 47 trditev (jedro prodajnega predloga: vhod, razclenitev, preverjanje izhoda, en popravek; lazen AI, brez baze)
node test/prodajni-predlog-api.test.mjs # 47 trditev (API pripravi/preberi/PDF, stran podjetja namizje+telefon, izbira podjetja pri zapisu sestanka)
# prodajni-predlog-api rabi streznik BREZ AI (ANTHROPIC_API_KEY= in brez CLAUDE_SDK) in s
# PUPPETEER_EXECUTABLE_PATH na Chrome (PDF). Pravi Opus samo na Maksovo besedo, prek CLAUDE_SDK=1.
```

### AI Business Score (migracija 013)

```bash
node test/score.test.mjs             # 39 trditev (cista funkcija tockovanja, brez streznika in baze)
node test/porocilo-besedilo.test.mjs # 54 trditev (v3: ena tema en prostor; slaba alineja se izpusti, slab odstavek zavrne; predloga prestane isto preverjanje)
node test/claude-sdk.test.mjs        # 14 trditev (CLAUDE_SDK=1: narocnina prek Agent SDK, lazni query(), brez klicev in brez API kljuca)
node test/vzvodi.test.mjs            # 19 trditev ("Kako do visje ocene" = pravi tockovalnik, porocilo ne vraca odgovorov)
node test/score-v2.test.mjs          # 85 trditev (v2: vprasanja iz Matjazevega Worda, razvejitev po 11.1, dejstva, ena tema en prostor, dopolnitev iz predloge)
# score-api rabi streznik z lazno MailerLite (test sam odpre mock na :3397):
#   MAILERLITE_API_URL=http://127.0.0.1:3397 MAILERLITE_API_KEY=test-ml MAILERLITE_GROUP_ID=999
#   SCORE_OUTBOX_MS=500 SCORE_MAX_V_OKNU=100 ANTHROPIC_API_KEY=
node test/score-api.test.mjs         # 58 trditev (oddaja v1 iz starega zavihka + oddaja v2, porocilo z vzvodi, outbox, kvalifikacija, CSV)
```

Zadnji zeleni zagon AI Business Score naborov: 2. 10. 2026 (vprasanja v2): score 39, porocilo-besedilo 54,
claude-sdk 14, vzvodi 19, score-v2 85, score-api 58. Prehod skozi kviz v Chromu (7 poti x racunalnik in telefon)
je bil v scratchpadu seje (e2e-v2.cjs, 138/0), ni v repu.

`test/porocilo-kakovost.mjs` NI del zagona: 6 pravih klicev Sonnet (pregled besedil na eni strani). Samo na Maksovo besedo in s streznikom na narocnini (CLAUDE_SDK=1).

`TEST_DB_URL` prepiše bazo (privzeto port 5435). Pozor: na 5435 zna teči baza
katerega drugega projekta (25. 9. 2026 je bila tam Zlata Ribica) — preveri
`docker ps` in po potrebi podaj svoj kontejner na drugem portu. `reset-testne-baze.mjs`
in `odgovori.test.mjs` brez `TEST_DB_URL` ciljata prav 5435, zato ga vedno nastavi.

`TEST_BASE` prepiše naslov strežnika (privzeto `http://127.0.0.1:3399`) — uporabno,
kadar teče sveža koda na drugem portu.

`CHROME_PATH` prepiše pot do Chroma, če ni na privzeti Windows lokaciji.

## Zakaj je ponastavitev obvezna

Oba nabora trdita marsikaj o **številu** sej in vprašanj. Brez
`reset-testne-baze.mjs` drugi zagon meri smete prvega. To me je pri gradnji
dvakrat ujelo: enkrat je `page.type()` prilepil besedilo na vsebino prejšnjega
zagona (`Zadovoljstvo ekZadovoljstvo ekipeipe`) in test je izgledal kot napaka
v shranjevanju, čeprav je bila napaka v testu.

Ponastavitev naredi dvoje: sprazni `process_*` tabele in **vrne predlogo na
seedano stanje** (API test ji med tekom doda vprašanje, zato bi naslednji zagon
startal z 52 namesto 51).

## Kaj testi posebej varujejo

- **`questions_snapshot` je ločen od predloge.** Urejanje predloge NE spremeni
  že začete seje; nova seja pa dobi novo različico. To je nosilna odločitev
  modula — če pade ta test, je zgodovina izpolnjenih vprašalnikov lažniva.
- **Procesni vprašalnik ni dosegljiv na `/f/:slug`.** Javna pot je brez auth;
  brez te varovalke bi bil interni obrazec viden zunaj in bi POST lahko pisal
  smeti v `responses`.
- **Autosave nikoli ne zavrne celote.** Med sestankom bi 400 pomenil izgubljen
  zapis. Neveljavne vrednosti se zavržejo posamično in vrnejo kot `opozorila`.
- **Nobeno polje vprašalnika ni nedosegljivo.** Prvotno jih je bilo pet, med
  njimi „Sodelujoči predstavniki hotela“, ker glava obrazca ni bila izrisana.
- **Datum se ne premakne za dan.** `pg` je `DATE` vračal kot `Date`, JSON pa ga
  serializiral v UTC → vpisani 24. 8. je v vmesniku postal 23. 8.
- **Neuspelo pošiljanje ni tiho.** Manjkajoč Resend ključ vrne 502 in se zapiše
  v `process_emails`, da komercialist ne misli, da je stranka dopis dobila.
  Od 31. 8. UI do tega sploh ne pride: brez ključa je gumb onemogočen z razlago
  (`posiljanje_vklopljeno` v GET seje/:id).
- **Zaključi/Pošlji nikoli s praznimi rokami.** Klik najprej splakne VSE
  neshranjene odgovore in meta polja (`splakniVse`); če shranjevanje pade, je
  dejanje blokirano z vidno napako. Brez tega gre stranki po e-pošti zastarela
  različica iz baze. Zapisi iz enega zavihka tečejo zaporedno (veriga obljub),
  med zavihki pa jih varuje `answers_rev` CAS (409 + en retry s svežo revizijo).
- **Imenovalec v cross-analizi je pošten.** Vprašanje, ki obstaja v dveh od treh
  snapshotov, ima pokritost „1 od 2", nikoli „1 od 3". Deljenje s številom vseh
  sej bi tiho izumilo manjkajoče odgovore, trditev iz takih številk pa bi šla
  na sestanek. Test to pokrije s sejo, ki ji je vprašanje odstranjeno.
- **Odgovor nosi kopijo vprašalnika iz časa oddaje.** Urejanje vprašalnika ne sme
  spremeniti prikaza starega odgovora: preimenovano vprašanje mora nad starim
  odgovorom ostati staro, izbrisano mora ostati vidno, novega tam ne sme biti.
  To je edina stvar v aplikaciji, ki je ni mogoče popraviti za nazaj — ko je
  odgovor shranjen brez kopije in nekdo uredi vprašalnik, prava vprašanja iz
  tistega dne ne obstajajo več nikjer.
- **Večizbirno vprašanje ni odstotek stotih.** Pri `checkbox_multi` je vsota
  izbir lahko večja od števila sej; odstotek je delež sej z odgovorom, ne delež
  izbir. Vpisano pod „drugo" se nikoli ne šteje kot možnost.
