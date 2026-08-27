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
node test/procesi-ui.test.mjs        # 85 trditev (pravi Chrome)
node test/navigacija.test.mjs        # 84 trditev (vseh 7 admin strani)
```

Skupaj 266 trditev. Zadnji zeleni zagon: 27. 8. 2026.

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
