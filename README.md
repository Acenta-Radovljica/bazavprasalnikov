# bazavprasalnikov

Baza vprašalnikov delavnice "Moj AI načrt" za Acenta.si. Sprejema Formspree webhooke, shranjuje odgovore v Postgres in (od Faze 3 naprej) generira AI povzetke + priporočila.

## Faze projekta

- **Faza 1 (MVP)** — Postgres + Express webhook, samo shranjevanje ← **trenutno**
- **Faza 2** — AI matching podjetij (`match_company` s Claude Haiku)
- **Faza 3** — AI povzetki + priporočila (async)
- **Faza 4** — Admin web UI (vanilla HTML + Tailwind)
- **Faza 5** — Cross-client insights (tedenski cron)

## Lokalni razvoj

```bash
npm install
cp .env.example .env       # nato uredi .env z resnicnimi vrednostmi
npm run migrate            # zazene SQL migracije
npm run dev                # razvoj (auto-restart)
```

## Endpointi

| Metoda | Pot | Auth | Namen |
|---|---|---|---|
| GET | `/` | — | Info |
| GET | `/health` | — | Health check (uporablja ga Dokploy) |
| POST | `/webhook/formspree` | — | Sprejema Formspree webhook |

## Deploy

Produkcija teče na `nacrt-api.deploy.acenta.si` (Dokploy na Hetzner serverju).
Glej `~/.claude/projects/.../memory/infrastructure_dokploy.md` za Dokploy API podrobnosti.

## Struktura

```
src/
  server.js              # Express app + start
  db.js                  # Postgres pool + dbQuery wrapper
  migrate.js             # SQL migracije runner
  routes/
    webhook.js           # POST /webhook/formspree
  utils/
    normalize.js         # normalizirajNaziv, hashIp
sql/
  001_init.sql           # zacetna shema (companies, responses, insights)
Dockerfile               # produkcijska slika
```

## Konvencije

- ESM (`import`/`export`)
- Moduli vracajo `null` na napaki, ne `throw` (Acenta pattern)
- Slovenski komentarji za netrivialne dele
- `.env` NIKOLI v git
