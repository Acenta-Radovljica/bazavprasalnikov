# BUILD-SPEC: prenos odobrenega prototipa v 13 admin strani

Status: FAZA 1 končana (9. 10. 2026). Temelj je v kodi:
`public/admin/admin.css` (nov design system) in `public/admin/app.js` (nova navigacija, predal, ikone).
Ta dokument je **zavezujoča pogodba** za agente, ki prenašajo strani. Kar tu piše, velja pred
lastno presojo; kjer dokument molči, velja odobreni prototip v `design-prototype/`.

---

## 0. Pravila (veljajo za vsako stran)

1. **Zvestoba prototipu.** Zaslon s prototipom (Danes, Podjetja, Podjetje, Seja, Odgovor) se zgradi
   tako, kot je v prototipu: postavitev, komponente, barve, razmiki, stanja, namizje IN telefon.
   Prototip odpri v brskalniku (`design-prototype/<ime>.html`) in ga primerjaj s svojo stranjo.
2. **Brez mrtvih kontrol.** Vsak gumb, povezava, filter, zavihek, polje ima pravo dejanje
   (handler, ruta, API). Česar ne moreš oživiti, ne izrišeš. Element iz prototipa brez podatkov:
   glej razdelek 6.
3. **Brez spremenjene informacijske arhitekture.** Vse, kar stran zna danes, zna tudi po prenosu
   (inventar spodaj je kontrolni seznam). Spremembe, ki jih je odobril prototip, so naštete pri
   strani pod »Odobrene spremembe«; drugih ni.
4. **Ne urejaj `admin.css` in `app.js`.** Štirje agenti delajo vzporedno. Če komponenta manjka,
   jo napiši v `<style>` svoje strani in to omeni v poročilu (združimo pozneje).
5. **ID-ji iz današnje kode imajo prednost pred ID-ji iz prototipa.** ID-ji v prototipu so bili
   ilustrativni (`btnStatistika`, `footCount` …); stran obdrži današnje (`btn-statistika`,
   `foot-count` …), ker jih bere JS in testi.
6. **Testne kljuke.** Razred, ki ga bere test, ostane na enakovrednem novem elementu kot
   dodaten razred brez stila (npr. `<li class="task naloga">`). Test se spremeni SAMO tam, kjer je
   to spodaj izrecno zapisano, in to z navedeno minimalno spremembo.
7. **Besedila.** Slovenščina, narekovaji »…«, v povedih brez pomišljajev (—): namesto njih vejica,
   dvopičje ali nov stavek. Samostojen »—« kot oznaka prazne vrednosti v tabeli/kazalniku je
   dovoljen (barva `muted`). Naslov zavihka: `Danes · Acenta baza` (ne `Acenta — Danes`); tudi
   `document.title = …` v JS. Brez imen pravih strank (repo je javen).
8. **Barve samo prek spremenljivk** iz `admin.css` (semantični sloj). Nobenega hex v stranskem CSS,
   nobene stare spremenljivke (tabela v razdelku 2.4). Brez dekorativnih senc.
9. **Native `confirm()`, `alert()`, `prompt()` ostanejo**, kjer so danes (vedenje ostane enako).
   Prototip ponekod alert nadomesti z vrstičnim stanjem (`.callout`), to je dovoljeno.
10. **Gumb z ikono:** `<button class="btn …">${ikona('check')}<span>Zaključi</span></button>`, brez
    presledkov med ikono in `<span>`. JS, ki menja besedilo (»Shranjujem …«), menja `span`, ne
    `textContent` celega gumba (sicer ikona izgine). Testi berejo `textContent` gumba.
11. **Ne commitaj, ne deployaj.**

---

## 1. Skelet strani

### 1.1 `<head>`

```html
<!DOCTYPE html>
<html lang="sl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Danes · Acenta baza</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap">
  <link rel="stylesheet" href="/admin/admin.css">
  <!-- samo strani, ki rišejo markdown (company, response, insights): -->
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>/* samo stilom te strani; samo semantične spremenljivke */</style>
</head>
```

Odstrani: `<script src="https://cdn.tailwindcss.com…">` (vključno z `?plugins=typography`),
stare povezave na Inter brez `opsz`, vse Tailwind razrede v HTML in v JS predlogah
(`text-gray-500`, `px-3`, `md:grid-cols-2`, `bg-red-50`, `hidden md:flex` …).
Izjema: razred `hidden` ostane, ker ga `admin.css` definira (`display:none !important`) in ga
berejo testi.

### 1.2 `<body>`

```html
<body>
  <div class="app">
    <aside id="sidebar" class="sidebar"></aside>
    <main class="main">
      <header class="topbar">
        <div class="topbar__title">
          <h1>Danes</h1>
          <span class="topbar__meta">…</span>
        </div>
        <span class="spacer"></span>
        <div class="topbar__actions">
          <a class="btn btn--primary" href="…"><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg>Nov sestanek</a>
        </div>
      </header>
      <div class="page">
        …vsebina…
      </div>
    </main>
  </div>
  <script src="/admin/app.js"></script>
  <script>
    renderNav('pregled');   // ključ aktivne postavke, glej 1.3
    …
  </script>
</body>
```

- `renderNav()` napolni `#sidebar`, doda mobilno vrstico (`.mobilebar`: meni, znamka, iskanje) in
  zaveso (`.scrim`), naloži ikone in priklopi predal, Napredno, števec nalog in Ctrl K.
  `renderSidebar()` je isto (ostane zaradi obstoječih klicev).
- `<header id="nav">` se ne piše več (če ostane, ga `renderNav` odstrani).
- Stran z lastno lepljivo vrstico namesto `.topbar` (Seja): `<body data-mobilebar="static">`.
- Pot (crumbs) namesto naslova: `<nav class="crumbs" aria-label="Pot">` kot v `podjetje.html`.
- Klic `renderNav()` naj bo prvi v skripti strani (ikone obstajajo šele po njem; `<use>` v
  statičnem HTML se razreši sam, ko se ikone vstavijo, to je preverjeno).

### 1.3 Ključi za `renderNav(aktivna)`

| Stran | Ključ (današnji klic) | Aktivna postavka |
|---|---|---|
| index.html | `'pregled'` | Danes |
| procesi.html, proces-seja.html, predloga.html | `'procesi'` | Procesi |
| podjetja.html, kanban.html, company.html, response.html | `'home'` (vzdevek za `podjetja`) | Podjetja |
| questionnaires.html | `'questionnaires'` | Vprašalniki |
| katalog.html | `'katalog'` | Katalog |
| analiza.html | `'analiza'` | Primerjava |
| search.html | `'search'` | Iskanje |
| insights.html | `'insights'` | Vpogledi (skupina Napredno se odpre sama) |

### 1.4 Kaj je zdaj v `app.js` (podpisi nespremenjeni)

`apiFetch, formatDatum, formatDan, esc, qs, md, izpolnjevalec, HONEYPOT, vprasanjaZaPrikaz,
vprasanjaIzObrazca, naslovPred, besediloVprasanja, cistoBesedilo, napisVOvoju, sklon, SKLONI,
debounce, renderNav, renderSidebar, showLoading, showError, svgIkona`.

Novo:
- `ikona(ime, razred = '')` vrne `<svg class="icon …"><use href="#i-ime"/></svg>`.
  Ikone: `alert arrow-down arrow-left arrow-right arrow-up bars book book-open building chart check
  check-square chev-down chev-left chev-right chev-up columns copy download external eye file inbox
  info lock menu merge pencil plus power printer refresh search send sparkles trash x`.
- `md(t)` vsako markdown tabelo ovije v `<div class="doc-table">` (drsi se znotraj okvirja).
- `showLoading(id, msg)` izriše `.loading` (vrtavka + besedilo), `showError(id, msg)` izriše
  `.callout.callout--danger`.

Odstranjeno: `toggleSub()`, `#sub` in `#chev-ovoj` (podseznam podjetij pod »Podjetja« na Danes:
odobreni prototip ga nima), `poskrbiZaOdzivnost()` in drsna mobilna vrstica (nadomesti jo predal).

---

## 2. Design system

### 2.1 Komponente

Celoten katalog razredov z oznako je v **komentarju na vrhu `public/admin/admin.css`**. Na kratko:
lupina (`.app .sidebar .main .topbar .page .crumbs`), gumbi (`.btn` + `--primary --secondary --soft
--ghost --danger --sm --icon --block .is-loading`), `.link`, značke (`.chip` + barve, `.chip--filter`
z `.chip__x`), `.dot`, `.count`, `.avatar`, `.panel` (`__head __title __desc __body __foot`),
`.callout`, `.empty`, `.empty-line`, `.loading`, obrazci (`.field __label __hint __status __req`,
`.input .textarea .select`, `.select-wrap`, `.search`, `.choices/.choice`, `.check`), `.toolbar`,
`.filters`, `.filter-chips`, `.seg`, `.tabs/.tab`, tabela (`.table-scroll .table .table--fixed
.table--stack th.is-sortable .is-sorted .sort-arrow tr.table__group tr.is-link`), `.metrics/.metric`,
`.progress .meter .bar-row .steps`, `.disclosure .sub-disclosure`, `.doc .doc-table .doc--compact`,
dokumentni panel `.docp__*`, zapis (`.ident .qlink .kv .prop`), vprašanja (`.qsec .qa .opts .opt
.scale .ans-*`, obrazec `.q .q--emph .q__clear .grid-input`), seznam `.rows > .row`,
postavitev (`.stack .cluster .split .grid-2 .form-grid .span-all`), pripomočki (`.hidden .sr-only
.ellipsis .muted .spacer .nowrap .num .hide-m .only-m .no-print`).

### 2.2 Stanja

`.active` in `.is-active` pomenita isto, prav tako `aria-selected="true"`, `aria-pressed="true"`,
`aria-checked="true"` (zavihki, segmenti, navigacija). **Ko JS preklaplja razred, uporabi
`.active`**: testi berejo `.tab.active`, `[data-dok].active`, `a.active`. Dodaj še ustrezen `aria-*`.

`hidden` atribut in razred `.hidden` oba skrijeta (`!important`). Kjer test bere
`className.includes('hidden')`, mora JS preklapljati **razred** (`#statistika`, `#novaSeja`,
`#opozorilo`, `#pNiVklopljeno`, `#obrazec-ovoj` do spremembe testa, glej Odgovor); kjer bere
`.hidden` lastnost (`#urejanje`, `#btn-izbrisi`, `#napaka` na Katalogu, `[data-panel]`), atribut.

### 2.3 Preloma

- **narrow `@media (max-width: 1100px)`**: dvostolpčni zapisi gredo v en stolpec, `.split` en stolpec.
- **mobile `@media (max-width: 760px)`**: stranska vrstica postane predal, kontrole zrastejo
  (`--control-h 40`, `--field-h 44`), `.topbar` se ovije, tabele z `.table--stack` postanejo kartice.

Stranski CSS iz prototipov prepiši na ta preloma: `899px → 760px`, `1099px / 1179px → 1100px`,
`699px → 760px`. Okvirji »Druga stanja« (`.frames`) iz prototipov se ne prenašajo: ta stanja so
prava stanja strani (prazno, nalaganje, napaka, teče …).

### 2.4 Stare spremenljivke → nove

| Staro | Novo |
|---|---|
| `--ink`, `--acenta-navy` | `--text` |
| `--ink-2` | `--text-secondary` |
| `--muted` | `--text-muted` |
| `--muted-2` | `--text-muted` (besedilo) ali `--text-faint` (samo ikone, okras) |
| `--hairline`, `--card-border` | `--border` |
| `--hairline-2` | `--border-strong` |
| `--row-line` | `--border-subtle` |
| `--bg`, `--bg-sub` | `--bg-canvas` / `--bg-subtle` |
| `--card-bg` | `--bg-surface` |
| `--hover` | `--bg-hover` |
| `--track`, `--periods` | `--bg-hover` / `--bg-subtle` |
| `--accent`, `--acenta-teal` | `--accent` |
| `--acenta-teal-2`, `--accent-hover` (svetlejša) | `--accent-hover` (zdaj temnejša) ali `--accent-muted` |
| `--accent-soft`, `--accent-softer`, `--acenta-teal-soft` | `--accent-subtle` / `--accent-subtle-hover` |
| `--acenta-teal-line` | `--accent-border` |
| `--accent-ink`, `--info` | `--accent-text` |
| `--warn`, `--peach-ink` / `--warn-soft`, `--peach` / `--warn-line` | `--warning-text` / `--warning-bg` / `--warning-border` |
| `--danger` (kot besedilo) / `--danger-soft` / `--danger-line` | `--danger-text` / `--danger-bg` / `--danger-border` |
| `--good` | `--success` / `--success-text` |
| `--sev1`, `--sev3`, `--lime`, `--mint` | ni zamenjave: uporabi stanje (`--danger`, `--text-faint` …) |
| `--r-xs`, `--r-sm`, `--r`, `--r-lg` | `--radius-sm`, `--radius-md`, `--radius-lg` |
| `--ease` | `--ease-out` |
| `--shadow-lift` | brez sence: rob `--border-strong` ob prehodu miške |

Pozor: `--accent-hover` in `--danger` imata v novem sistemu drug pomen kot prej.

### 2.5 Stari razredi → novi (najpogostejši)

| Staro | Novo |
|---|---|
| `page-head` + `display` + `sub` | `.topbar` + `h1` + `.topbar__meta` |
| `e-wrap`, `e-crumb`, `e-title`, `e-eyebrow` | `.page`, `.crumbs`, `.topbar` ali `.ident` |
| `card`, `e-panel` + `card-head` | `.panel` + `.panel__head` / `.panel__body` |
| `kpis` / `kpi .k .v .d` | `.metrics` / `.metric .metric__label .metric__value .metric__note` |
| `btn-primary`, `btn-dark`, `e-btn` | `.btn.btn--primary` |
| `btn-secondary`, `e-btn-soft` | `.btn.btn--secondary` (ali `--soft` za sekundarno akcentno dejanje) |
| `btn-mini`, `btn-mini dark` | `.btn.btn--secondary.btn--sm` / `.btn.btn--soft.btn--sm` |
| `e-btn-danger`, `btn-danger` | `.btn.btn--danger` |
| `e-btn-ghost`, `e-btn-white` | `.btn.btn--ghost` / `.btn.btn--secondary` |
| `tag`, `tag ok/info/warn`, `e-chip ok/warn/bad/cold/layer`, `badge-*`, `pill` | `.chip` + `--success/--info/--warning/--danger/--cold/(brez)` |
| `e-periods > button` | `.seg > .seg__item` |
| `e-select`, `select` | `<span class="select-wrap"><select class="select">` |
| `e-search` | `.search` |
| `e-table`, `app-table`, `e-table-scroll`, `scroll-x` | `.table`, `.table-scroll` |
| `e-panel-foot` | `.panel__foot` |
| `e-empty`, `prazno`, `prazno-stanje` | `.empty` (z naslovom in naslednjim korakom) ali `.empty-line` |
| `e-note warn/bad`, `opozorilo`, `banner` | `.callout.callout--warning / --danger` |
| `e-warnbar` | `.callout.callout--warning` (ali `--info` za »teče«) |
| `e-reco`, `prose` | `.doc` |
| `e-switch`, `e-tabs` | `.tabs > .tab` (ali `.seg`) |
| `meter .track .fill` | `.meter > .progress > .progress__fill` + `.meter__val` |
| `list-row`, `row-lift` | `.rows > .row` |
| `field-label`, `field-help` | `.field__label`, `.field__hint` |

---

## 3. Delitev dela in testi

### 3.1 Predlagana razdelitev na 4 agente

| Agent | Strani | Testne datoteke (UI del) | Edini, ki sme urejati |
|---|---|---|---|
| A: Delo, seznami | index (Danes), podjetja, kanban, procesi | `naloge`, `procesi-ui` (del Procesi), `navigacija` | (nobene spremembe testov) |
| B: Zapisi | company, response, search, insights | `prodajni-predlog-api` (del podjetje), `izvoz-api`, `odgovori`, `katalog` (del podjetje) | `prodajni-predlog-api.test.mjs`, `izvoz-api.test.mjs`, `odgovori.test.mjs` |
| C: Seja | proces-seja, predloga | `procesi-ui` (del seja), `save-guard`, `prodajni-predlog-api` (del seja), `naloge` (skok na `#kartaTranskript`) | `procesi-ui.test.mjs` (ena vrstica, glej Seja) |
| D: Urejanje in analiza | questionnaires, katalog, analiza | `katalog` (del Katalog), `analiza` | (nobene spremembe testov) |

Tako nobena testna datoteka nima dveh urednikov.

### 3.2 Zagon testov

Strežnik `http://127.0.0.1:3402`, baza `postgres://postgres:test@127.0.0.1:5478/vprasalniki`.
**Obe spremenljivki v ISTEM ukazu**; več testov ima privzeto bazo na `:5435`, ki je baza drugega
projekta.

```bash
TEST_BASE=http://127.0.0.1:3402 TEST_DB_URL=postgres://postgres:test@127.0.0.1:5478/vprasalniki node test/naloge.test.mjs
```

- Vsi agenti si delijo isti strežnik in bazo. Testi štejejo vrstice (npr. »knjižnica pokaže 1
  predlogo«), zato **teste poganjaj enega naenkrat** z zaklepom:
  `until mkdir "$TEMP/bazavp-test.lock" 2>/dev/null; do sleep 5; done; <test>; rmdir "$TEMP/bazavp-test.lock"`
  (v Git Bashu je `$TEMP` uporabnikova začasna mapa). Zaklep vedno sprosti, tudi ko test pade.
- `test/reset-testne-baze.mjs` poganja samo koordinator.
- Strežnika ne zaganjaj znova (zahtevajo ga tudi drugi). Strani so statične, osvežitev brskalnika
  zadošča. Sprememba na strežniku gre prek koordinatorja (razdelek 6).
- AI ni vklopljen in se ne vklaplja (brez `ANTHROPIC_API_KEY`, brez `CLAUDE_SDK`).

### 3.3 Merilo »končano« za vsako stran

1. Primerjava s prototipom (ali s sistemom in najbližjim prototipom) pri **1440 in 390 px**:
   postavitev, barve, tipografija, razmiki, vsa stanja (prazno, nalaganje, napaka, polno).
2. Vsaka kontrola iz inventarja je kliknjena in naredi, kar je naredila prej.
3. Brez vodoravnega drsenja strani pri 1440 in 390 px; brez napak v konzoli.
4. Testi iz tabele 3.1 zeleni (z zaklepom), `navigacija` zelen za tvoje strani.
5. V `<head>` ni Tailwinda; v strani ni hex barv ali starih spremenljivk.

---

## 4. Strani s prototipom

### 4.1 Danes (`public/admin/index.html`)

**Vir:** `design-prototype/danes.html` (1:1). Stranski CSS (`.focus`, `.buckets`, `.task*`,
`.stats`, `.chart`) prekopiraj iz prototipa; `.metrics` in `.rows` sta že v `admin.css`.

**Komponente:** `.topbar` (h1 »Danes«, meta `#datum` · `#osvezeno`; dejanja `#btn-statistika`
`.btn--secondary` z `i-bars` in oznako v `<span>`, `a.btn--primary` »Nov sestanek«) → `section.focus`
(`#h-num`, `#h-naslov`, `#h-opis`, `dl` z `#h-caka`, `#h-zakljuceno`) → `.metrics`
(`style="--metrics-cols:5"`, 5× `.metric`) → `.buckets` (3× `article.panel`: `.panel__head` s `.dot`,
`.panel__title`, `.count#c-*`, namig; `ul.tasks#v-*`) → `#statistika` (skrita; panel »Glavni podatki«
z izbiro vprašalnika in `.metrics` 4×, panel grafa, panel »Aktivnost podjetij« z `ul.rows`).

**Inventar (vse ostane):**

| Element | Danes | Dejanje / API | Nova oznaka |
|---|---|---|---|
| Statistika | `#btn-statistika` onclick `preklopiStatistiko()` | preklopi razred `hidden` na `#statistika`, preimenuje v »Skrij statistiko«, drsi do nje | `.btn--secondary` + `i-bars` + `<span>` z oznako |
| Nov sestanek | `a.btn-dark` | `/admin/procesi.html#nov` | `a.btn.btn--primary` + `i-plus` |
| Kazalniki | `#s-podjetja #d-podjetja #s-odgovori #spark-odgovori #d-odgovori #s-seje #d-seje #s-brez #s-zastarela` | `/api/stats`, `/api/procesi/seje`; `deltaBadge()`, `renderSparkline()` | `.metric` (`.metric__value`, `.metric__note`, `svg.spark`); »Brez priporočil« in »Zastarela« z `.dot--warning` v oznaki; `deltaBadge` piše `.delta-up/.delta-down` |
| Poudarek dneva | `#h-num #h-naslov #h-opis #h-caka #h-zakljuceno` | `/api/naloge` `skupno`; `izrisiHero()` (sklon, 0 = »Nič ni na tebi«, ≥ 5 poudarek) | `.focus__num` (modifikatorja za 0 in ≥ 5 v stranskem CSS: `--success-text` / `--warning-text`) |
| Vedra | `#v-ukrepaj #v-caka #v-zakljuceno`, `#c-*` | `/api/naloge`; `opisNaloge()`, `izrisiVedro()` | `li.task.naloga`; ton: nujno `.dot--danger`, opozorilo `.dot--warning`, mirno `.dot--accent`; glavni gumb `a.btn.btn--soft.btn--sm`, ostali `a.btn.btn--secondary.btn--sm`; značka Poslano `.chip--accent`, Zaključeno `.chip--success` |
| Gumbi nalog | `a.btn-mini` | `proces-seja.html?id=…` (+ `#kartaPosiljanje` / `#kartaTranskript`), `podjetja.html`, `company.html?id=…` | povezave in hashi NESPREMENJENI (prototip ima `#posiljanje`, to ni prav) |
| Filter vprašalnika | `#filter-q` onchange `spremeniFilter()` | hash `#q=ID`, `/api/companies?questionnaire_id=ID` | `.select-wrap` + `select.select.select--sm` |
| Graf 30 dni | `#timeline-chart`, `#timeline-meta` | `stats.timeline`; `renderTimelineChart()` | SVG z razredi `.grid .axis .area .line .pt` iz prototipa (brez hex barv v JS) |
| Aktivnost podjetij | `#aktivnost` vrstice | `company.html?id=…`; značka AI ✓ / zastarela / — | `ul.rows > li > a.row` (`.avatar`, `.row__txt`, `.chip`) |
| Odpri seznam | `a` | `/admin/podjetja.html` | `a.link` |

**Odstrani:** `toggleSub()` in del `renderiraj_seznam()`, ki piše v `#sub` / `#chev-ovoj` (sicer JS
napaka; test `navigacija` zdaj pade prav zaradi tega). Ostali del (Aktivnost) ostane.

**Odobrene spremembe:** ni podseznama podjetij v stranski vrstici. Ker je filter `#q=ID` prej viden
predvsem tam, naj stran ob `#q=` v naslovu **sama odpre Statistiko** (tako povezava »N odgovorov →«
z Vprašalnikov pokaže filtrirano aktivnost).

**Testne kljuke (`naloge.test.mjs`):** prvi `h1` = »Danes«; `#s-podjetja` ni »—« po nalaganju;
`#h-num` pisava ≥ 36 px (prototip 40 px); `#h-naslov` začne s sklonom (»2 nalogi sta …«,
0 = »Nič ni na tebi«); `#h-caka`, `#h-zakljuceno`; `#v-ukrepaj .naloga`; `#c-ukrepaj`;
vse povezave v `#v-ukrepaj a, #v-caka a, #v-zakljuceno a` se začnejo z `/admin/`, hashi le
`kartaPosiljanje`/`kartaTranskript`; `#statistika` razred `hidden`; `#btn-statistika` vsebuje »Skrij«,
ko je odprta; `#timeline-chart svg`; `#nav-ukrepaj` (app.js). Brez JS napak.

**Odzivnost:** ≤ 1100 vedra v en stolpec, kazalniki se razporedijo sami; ≤ 760 poudarek se zloži,
kazalniki 2 stolpca (»Odgovori (7 dni)« čez celo širino, kot prototip), gumbi nalog čez širino.

### 4.2 Podjetja (`public/admin/podjetja.html`)

**Vir:** `design-prototype/podjetja.html`. Stranski CSS: stolpci `.ctable` in vrstni red kartic na
telefonu (prepiši na 760 px); `.toolbar` in `.table--stack` sta v `admin.css`.

**Komponente:** `.topbar` (h1, meta `#meta`, `a.btn--secondary` »Kanban pogled« + `i-columns`) →
`.toolbar` (`label.search` z `#filter`; skupina »Ocena« `.seg#filterKval`; `.spacer`; skupina
»Status« `.select-wrap` z `#filterStatus`) → `section.panel` (`.table-scroll#content` z
`table.table.table--fixed.table--stack.ctable`; `.panel__foot` z `#foot-count` in namigom `.hide-m`).

**Inventar:**

| Element | Danes | Dejanje / API | Nova oznaka |
|---|---|---|---|
| Iskanje | `#filter` input | `applyFilters()` (v brskalniku) | `label.search > input#filter` |
| Ocena | `#filterKval button[data-kval]` | `fKval`, preklop `.active`, `applyFilters()` | `.seg__item[data-kval]` + `.active` + `aria-pressed` |
| Status (filter) | `#filterStatus` change | `applyFilters()`; možnosti iz `STATUSI` | `.select-wrap > select.select` |
| Vrstica | `tr onclick` | `/admin/company.html?id=…` | `tr.is-link` + `tabindex="0"`, klik in Enter odpreta (kot prototip) |
| Status v vrstici | `select` onchange `spremeniStatus()` | `PATCH /api/companies/:id {status}`, ob napaki alert in povrnitev; klik ne odpre vrstice | `.select-wrap > select.select.select--sm` |
| Prazen rezultat | `e-empty` | besedilo | `.empty.empty--center` + »Počisti filtre« (`.btn--secondary`, ponastavi vse tri filtre) |
| Podatki | | `GET /api/companies` | |

**Odobrene spremembe:** stolpec `#` (zaporedna številka) odpade; »AI« postane »Priporočila« (značka
samo, ko je treba ukrepati: »Brez priporočil«, »Zastarelo«; sicer tiho »pripravljeno«); nov stolpec
**»Prodajni predlog«: nima podatkov, glej razdelek 6.1** (dokler ga ni v API-ju, se stolpec ne izriše).

**Testi:** samo `navigacija` (brez preliva pri 1400/390, brez napak).

**Odzivnost:** ≤ 760 vrstice postanejo kartice (ime + puščica, status čez širino, ocena, predlog,
priporočila, pod imenom »N odgovorov · zadnji D«), orodna vrstica se zloži, segment čez širino.

### 4.3 Podjetje (`public/admin/company.html`)

**Vir:** `design-prototype/podjetje.html` in `podjetje.html#delavnica`. Stranski CSS: `.record`
(območja doc/props/work/answers/meta), `.work*`, `.resp*`, tiskanje `body.tisk-delavnica`.
`.ident`, `.qlink`, `.docp__*`, `.prop`, `.kv`, `.bar-row`, `.steps` so v `admin.css`.

**Komponente:** `.topbar` (`.crumbs` Podjetja › ime; dejanje `#btn-izvoz` `.btn--secondary` +
`i-download`) → `#mozni-dvojnik` (`.callout--warning`, ko obstaja) → `.ident` (začetnice, h1, meta:
»N odgovorov · zadnji D«, `a.qlink[data-tab]` za vsak vprašalnik s `.count`) → `.record`:
`section.panel#prodajni-predlog` (dokumentni panel) | `.a-props` (panel lastnosti: Interne opombe,
Ocena leada, Prodajni status) | `details.disclosure.work#delavnica` | `section.panel#odgovori-section`
| `.stack` (Po vprašalnikih, Upravljanje + `.kv` Normaliziran naziv).

**Inventar:**

| Element | Danes | Dejanje / API | Nova oznaka |
|---|---|---|---|
| Izvoz za Claude (ZIP) | `#btn-izvoz` `izvoziZaClaude()` | `GET /api/companies/:id/izvoz` + `/admin/izvoz.js` (`sestaviDatoteke`, `zip`, `imeMape`), prenos ZIP; gumb med delom onemogočen | topbar, `.btn--secondary` + `i-download`, besedilo ostane »Izvoz za Claude (ZIP)« |
| Prodajni predlog (gumb v glavi) | `#btn-predlog` (drsenje do predloga) | | **odpade** (predlog je prvi na strani) |
| ← Vsa podjetja | `a` | `/admin/podjetja.html` | povezava »Podjetja« v `.crumbs` |
| Vprašalniki v glavi | `.e-links a[data-tab]` | `izberiTab(qid)` + drsenje do `#delavnica` | `a.qlink[data-tab]` + `.count`; ob kliku delavnica tudi odpre (`details.open = true`) |
| Možni dvojnik | »Združi v #ID« `zdruziZDvojnikom()`, »Ni isto podjetje« `niDvojnik()` | `POST /api/companies/:id/merge {target_id}`; `PATCH {mozni_dvojnik_id:null}` | `.callout--warning` z `.btn--sm` gumboma |
| Zavihka predloga | `[data-dok="direktor"/"matjaz"]` | `predlogDok`, `renderPredlog()` | `.tabs.e-switch > button.tab[data-dok]` + `.active` |
| Pripravi (znova) | `#pp-pripravi` | potrditev, `GET /api/companies/:id/izvoz` + `sestaviDatoteke`, `POST /api/companies/:id/prodajni-predlog {datoteke}`; 409 → osveži; spremljanje vsakih 5 s | `.btn--secondary` + `i-refresh`; v praznem stanju `.btn--primary` »Pripravi prodajni predlog« |
| PDF | `#pp-pdf` | `/api/companies/:id/prodajni-predlog/pdf` (download) | `a.btn.btn--primary` + `i-printer` »Natisni / PDF za direktorja« |
| Kopiraj | `#pp-kopiraj` | `navigator.clipboard.writeText()` markdowna aktivnega dokumenta, »Kopirano« 1,6 s | `.btn--secondary` + `i-copy`; oznaka v `<span>` (besedilo gumba mora biti točno »Kopirano«) |
| Stanja predloga | `#pp-tece`, `#pp-napaka`, `#pp-opozorila` | iz `GET /api/companies/:id/prodajni-predlog` | `.docp__note` + `.callout--info` s `.pulse` (teče), `.callout--danger` (napaka), `.callout--warning` z `ul` (opozorila, samo za direktorja) |
| Pokaži vse (predlog) | `#pp-vec` | zlaganje dolgega besedila | **odpade** (prototip kaže dokument v celoti) |
| Interne opombe | `#opombe`, `#opombe-stanje` | shrani po 900 ms premora in ob `blur`: `PATCH {interne_opombe}`; `beforeunload` | `section.prop` z `textarea.textarea#opombe`, `.prop__foot#opombe-stanje` |
| Ocena leada | gumbi hot/warm/cold/AI `nastaviKval()` | `PATCH {kvalifikacija}` (null = prepusti AI) | `.seg.seg--block` z `.seg__item--hot/--warm/--cold/--ai` (`role="radio"`, `aria-checked`); vir v `.chip` (»Ocenil AI« / »Ročno« / »Še ni ocenjeno«); razlog v `.prop__note` |
| Prodajni status | `select` `nastaviStatus()` | `PATCH {status}`; faze in »spremenjeno D« | `section.prop` z `.select-wrap > select.select`, `.prop__meta` »N od 6 faz«, `.steps` (`.steps--lost` za izgubljen), `.prop__foot` |
| Delavnica: vprašalnik | `.e-switch [data-tab]` | `izberiTab(qid)` | `.tabs.work__tabs > .tab[data-tab]` + `.count` |
| Regeneriraj priporočila / vse | `regeneriraj(qid, 'priporocila'/'vse')` | potrditev, `POST /api/companies/:id/regenerate-ai {mode, questionnaire_id}` | `.work__tools` `.btn--secondary`; namesto alerta sme `.callout--info` v vrstici (prototip `[data-status]`) |
| Izvozi PDF | `a` | `/api/companies/:id/pdf?questionnaire_id=…` | `a.btn.btn--ghost` + `i-download` |
| Natisni | `window.print()` | | `.btn--ghost` + `i-printer`; doda `body.tisk-delavnica` in natisne samo priporočila (prototip) |
| Zastarelo | `e-warnbar` | `novejsi` odgovori po generaciji | `.chip--warning` v povzetku + `.callout--warning` z navodilom (prototip) |
| Odgovori: zavihki | `.e-tabs [data-tab]` | `izberiTab()` | `.tabs > .tab[data-tab]` + `.count` |
| Odgovor: odpri | `a.btn-odpri` | `/admin/response.html?id=…` | `a.btn.btn--secondary.btn--sm` »Odpri vprašalnik« |
| Odgovor: celoten povzetek | `.sum-more` | odpre odrezan povzetek (samo, ko je res odrezan) | `button.link` |
| Pokaži vse / manj | `vsiOdgovori` | prikaže vse odgovore (MAX 5) | `.panel__foot` `.btn--secondary.btn--sm` |
| Združi z drugim podjetjem | `odpriMerge()` | `prompt` ID, potrditev, `POST /merge`, preusmeritev | `.btn--secondary.btn--sm` + `i-merge` |
| GDPR izbris | `izbrisiPodjetje()` | dvojna potrditev, `DELETE /api/companies/:id`, na `/admin/` | `.btn--danger.btn--sm` + `i-trash` |
| Podatki | | `GET /api/companies/:id`, `GET /api/companies/:id/prodajni-predlog` | |

**Testne kljuke** (`prodajni-predlog-api`, `izvoz-api`, `katalog`), ohrani kot dodatne razrede:
- `#prodajni-predlog` (panel), naslov panela `h2.lbl` z besedilom »Prodajni predlog«, podnaslov
  `p.e-feature-sub` točno v obliki `Pripravljeno D. M. LLLL iz N odgovora/odgovorov in N zapisov
  sestankov`; dokument `article.doc.pp-dok`; dejanja `.docp__actions.e-feature-actions`
  (gumbi »Pripravi znova«, »Natisni / PDF za direktorja«, »Kopiraj«); zavihki `.tabs.e-switch`
  (na telefonu čez > 80 % širine panela, kar `.docp__bar .tabs` že naredi).
- Prazno stanje: `.empty.e-reco-prazno` z **`<b class="empty__title">`** »Prodajni predlog še ni
  pripravljen« in **`<p class="empty__text">`** (»… vse odgovore tega podjetja (N), zapise
  sestankov (N) …«), gumb `#pp-pripravi`; brez `[data-dok]` in brez `.e-feature-actions`.
- `#delavnica h2` = »Priprava na delavnico«; opis `p.desc` vsebuje »AI priporočila · {vprašalnik}«;
  delavnica stoji POD predlogom.
- Stranski stolpec: ovoj `.a-props.pp-stran` (desno od predloga na namizju), panel lastnosti
  `aside.panel.props.e-side` s **prvim** otrokom = Interne opombe; razdelek statusa `section.prop.e-sidecard`
  s `select.select.e-select`; `#opombe`, `#opombe-stanje` (»Neshranjeno …« med tipkanjem,
  »Shranjeno …« po shranjevanju).
- Telefon: predlog → opombe (`.pp-stran`) → `#delavnica` po vrsti od zgoraj.
- `#btn-izvoz` z besedilom »Izvoz za Claude (ZIP)«, po izvozu spet omogočen.
- `#pp-tece`, `#pp-napaka` in `#pp-opozorila` se **izrišejo ali ne izrišejo** (ne samo skrijejo):
  test čaka, da `#pp-tece` izgine iz DOM, in preveri, da `#pp-opozorila` na zavihku »Za Matjaža«
  ne obstaja.
- `#pp-kopiraj`: test primerja `textContent` brez obrezovanja s točno »Kopirano«, zato v gumbu
  ni presledkov ali novih vrstic med ikono in `<span>` (`${ikona('copy')}<span>Kopiraj</span>`).

**Obvezni spremembi testov (agent B):**
1. `test/prodajni-predlog-api.test.mjs`, v `page.evaluate` zamenjaj vrstico
   `glava: [...document.querySelectorAll('#header .e-actions > *')].map(e => \`${e.className}:${e.textContent.trim()}\`),`
   z
   `glava: [...document.querySelectorAll('.topbar__actions > *')].map(e => e.textContent.trim()).concat(document.querySelector('.crumbs a[href="/admin/podjetja.html"]') ? ['Podjetja'] : []),`
   in pričakovanje v `t('glava: …')` z `JSON.stringify(['Izvoz za Claude (ZIP)', 'Podjetja'])`,
   ime trditve: `'glava: Izvoz za Claude (ZIP) in pot nazaj na Podjetja'`.
2. `test/izvoz-api.test.mjs`: `b.closest('.e-title')` → `b.closest('.topbar')`.

**Odzivnost:** ≤ 1100 `.record` en stolpec (doc, props, work, answers, meta), lastnosti niso več
lepljive; ≤ 760 `.ident` zložen, dejanja predloga nad zavihki, primarni gumb čez širino (prototip).

**Opomba (popravek pravilnosti):** opis delavnice »generirano D iz N odgovorov« danes šteje VSE
današnje odgovore. Prav je `odgZaTab.length - novejsi` (odgovori, ki so obstajali ob generaciji).

### 4.4 Seja (`public/admin/proces-seja.html`)

**Vir:** `design-prototype/seja.html`. Stranski CSS: `.sessionbar*`, `.prog`, `.save`, `.seja__grid`,
`.idx*`, `.kartica__grid`, `.q-edit`, `.q-add`, `.tr-item*`, `.row-actions`, fiksna spodnja vrstica
dejanj na telefonu. `.q`, `.grid-input`, `.qsec`, `.sub-disclosure`, `.grid-2`, `.form-grid` so v
`admin.css`. `<body data-mobilebar="static">`.

**Komponente:** `header.sessionbar` (namesto `.topbar`): nazaj »Procesi«, `#glavaNaslov`
(h1 stranka + `.chip` status), dejanja `#btnUredi` / `#btnZakljuci` (primarni) / `#btnPoslji`;
druga vrstica `#glavaPod`, napredek (`#glavaNapredek` kot gumb, `.progress`), stanje shranjevanja
`#shranjeno` → `#opozorilo` (`.callout`) → mreža: `nav.idx` | stolpec obrazca (`#kartica`,
`form#obrazec`, `#kartaTranskript`, `#kartaPosiljanje`).

**Inventar:**

| Element | Danes | Dejanje / API | Nova oznaka |
|---|---|---|---|
| ← Procesi | `a` | `/admin/procesi.html` | `a.btn.btn--ghost.btn--sm` + `i-arrow-left` |
| Uredi vprašanja | `#btnUredi` | preklop `urejanjeVprasanj`, besedilo »Končaj urejanje«, opozorilo »samo za ta sestanek«, ponoven izris | `.btn--secondary` + `i-pencil`; oznaki `<span class="lbl-long" data-uredi>` in `<span class="lbl-short">`; aktivno stanje `aria-pressed="true"` |
| Zaključi | `#btnZakljuci` | `splakniVse()`, `POST /zakljuci`; 422 → seznam manjkajočih + `#vsiliZakljucek` (`{vsiljeno:true}`) | `.btn--primary` + `i-check`; 422 → `.callout--danger` s seznamom, »Pojdi na prvo polje« (novo, glej 6) in »Vseeno zaključi« `#vsiliZakljucek` |
| Pošlji stranki (glava) | `#btnPoslji` | drsi do `#kartaPosiljanje`, fokus `#pEmail` | `.btn--secondary` + `i-send` |
| Napredek | `#glavaNapredek` | »X/Y izpolnjenih · N obveznih manjka« | `button.prog__txt#glavaNapredek`; klik skoči na prvo manjkajoče obvezno polje (novo, podatki so v brskalniku) |
| Shranjevanje | `#shranjeno` | `nastaviShranjeno()` (»Spremembe...«, »Shranjujem...«, »Shranjeno HH.MM«, »NI shranjeno«) | `span.save[data-s]` z `.dot` in `span#shranjeno` z istimi besedili |
| Opozorilo | `#opozorilo` | `pokaziOpozorilo(html, vrsta)`, `skrijOpozorilo()` | `.callout` + `--info/--warning/--danger/--success`; skrivanje z **razredom** `hidden` |
| Kazalo sklopov | `#sklopNav a[data-navza]` | sidra `#sklop-N` | `nav.idx` > `p.idx__title` + **`div#sklopNav`** (samo sklopi, `a.idx__item` + števec »X/Y«) + `.idx__sep` + povezavi `#kartaTranskript`, `#kartaPosiljanje` (zunaj `#sklopNav`) |
| Kartica sestanka | `[data-meta]` `#mStranka #mProces #mOddelek #mSvetovalec #mDatum`, `#mPodjetje` | vnos → 900 ms → `PATCH` meta; stranka obvezna; `#mPodjetje` iz `GET /api/companies` | `section.panel.qsec#kartica` z `.form-grid` (3 stolpci), `.field__label--sm`, `#mPodjetjeNamig` `.field__hint` (`a.link` »Odpri podjetje« ali opozorilo `--warning-text`) |
| Polja vprašalnika | `[data-qid]`, `[data-tip]`, `[data-r][data-c]` | `oninput/onchange` → `preberiPolje()`, debounce 900 ms → `PATCH {answers, answers_rev}` (409 enkrat ponovi) | `section.panel.qsec#sklop-N` > `div.q[data-polje]` (+ `.q--emph.poudarek`), **prvi `<label>` v `[data-polje]` je besedilo vprašanja**; radio/izbira → `.choices > label.choice`; več izbir + »drugo« `input.input.q__drugo`; tabela `.grid-scroll > table.grid-input`; datum `.input` |
| Počisti izbiro | `[data-pocisti]` | počisti radio | `button.q__clear[data-pocisti]` |
| Urejanje | `[data-labelza] [data-obveznoza] [data-odstrani] [data-dodajvsekcijo]` | `shraniUrejanjeVprasanj()`, `dodajVprasanje()` (prompt), odstrani (potrditev) | `.q-edit` vrstica, `button.q-add[data-dodajvsekcijo]` (»Dodaj vprašanje v ta sklop«) |
| Transkript | `#tUrl #tPrenesi #tRocnoOvoj #tBesedilo #tShraniRocno #tStatus #tSeznam` | `POST /api/procesi/seje/:id/transkript {soniox_url}` ali `{besedilo}`; neuspeh odpre ročni vnos | `.row-actions`, `details.sub-disclosure#tRocnoOvoj`, `.tr-item` (shranjen / ni prenesen, »Pokaži začetek« `sub-disclosure`) |
| Pošiljanje | `#pEmail #pZadeva #pSporocilo #pPdf #pPredogled #pPredogledInterno #pPdfLink #pPoslji #pNiVklopljeno #pStatus #pZgodovina` | potrditev, `splakniVse()`, `POST /poslji` (422 osnutek → potrditev → `vsiljeno`); brez Resend gumb onemogočen z razlago | `.grid-2` polj, `.textarea`, `label.check`, povezave `a.btn.btn--secondary` + `i-external` (`target="_blank"`), `#pPoslji` `.btn--primary` + `i-send`, `#pNiVklopljeno` `.callout--info` (razred `hidden`), zgodovina kot seznam |
| Skok na hash | `skociNaHash()` | `#kartaPosiljanje` / `#kartaTranskript` (+ vzdevka `#posiljanje`, `#transkript`), fokus prvega polja | id-ja kartic ostaneta `kartaTranskript` in `kartaPosiljanje` |
| `beforeunload` | | opozorilo ob neshranjenem | ostane |
| Podatki | | `GET /api/procesi/seje/:id`, `PATCH`, `/zakljuci`, `/transkript`, `/poslji`, `/predogled`, `/pdf` | |

**Testne kljuke** (`procesi-ui`, `save-guard`, `prodajni-predlog-api`, `naloge`): `#glavaNaslov`
vsebuje stranko in »Osnutek« (status v istem elementu) in na 390 px ni odrezan (ime se ovije,
brez tropičja); `#glavaNapredek` vsebuje »izpolnjenih«; `#obrazec section` = število sklopov (9);
`#sklopNav a` = 9; `[data-qid=…]` za vsa polja (tudi glava pred prvim sklopom: »Osnovni podatki«);
`#obrazec textarea[data-qid]`, `input[type=radio][data-qid]`, `input[type=checkbox][data-qid]`,
`input[data-tip=table]` (12); `#obrazec .poudarek` z namigom; `#mDatum`; `#shranjeno`
(»Spremembe«, »Shranjeno«, »NI shranjeno«); `[data-pocisti="…"]` po izbiri; `[data-odstrani]`,
`[data-dodajvsekcijo]` (9), `[data-labelza]` samo v urejanju; `[data-polje="problem"] label`;
`#opozorilo` razred `hidden`, besedilo »samo za ta sestanek«, »zaključen«; `#btnZakljuci`
(onemogočen med shranjevanjem, besedilo »Zaključi«); `#vsiliZakljucek`; `#tSeznam` »Še ni
shranjenega«; `#pZadeva` vsebuje stranko; `#pSporocilo` začne s »Pozdravljeni,«; `#pPredogled`
href točno `/api/procesi/seje/{id}/predogled?namen=stranka`; `#pPredogledInterno` `namen=interno`;
`#pPdfLink` `/pdf`; `#pPoslji` onemogočen + besedilo; `#pNiVklopljeno` brez razreda `hidden`;
`#mPodjetje` (prva možnost »Ni izbrano«), `#mPodjetjeNamig` (»prodajni predlog ne vidi«,
»Odpri podjetje«). **Vsak omogočen `<button>` ima `id`, `data-odstrani/pocisti/dodajvsekcijo` ali
besedilo; nobene `a[href="#"]`** (povezave predogledov dobijo href ob nalaganju).

**Obvezna sprememba testa (agent C), samo če gumb dobi kratko oznako:** v
`test/procesi-ui.test.mjs` trditev »gumb se preimenuje nazaj« bere
`(e.querySelector('[data-uredi]') || e).textContent.trim()` namesto `e.textContent.trim()`.

**Odzivnost:** ≤ 1100 kazalo postane vodoravni trak sklopov; ≤ 760 kompaktna vrstica seje,
dejanja v fiksni spodnji vrstici (prototip), en stolpec, mobilna vrstica se odpelje (`data-mobilebar`).

### 4.5 Odgovor (`public/admin/response.html`)

**Vir:** `design-prototype/odgovor.html`. Stranski CSS: `.record` (sum/side/qs), `.side`, `.sum__*`,
`.stat__*`, `.qs__title`, `.pager*`, `.form-copy`. `.ident`, `.kv`, `.qsec`, `.qa`, `.opts`, `.scale`,
`.ans-*` so v `admin.css`.

**Komponente:** `.topbar` (`.crumbs` Podjetja › podjetje › oseba; dejanja: mini pager
`.pager-mini` (glej 6), `#btn-csv`) → `div.page#content` → `.ident` (`.ident__av` + `--anon`,
`h1.r-ime`, `.ident__who` vloga · e-naslov, meta: `a.qlink` podjetje, `.qlink` vprašalnik, »Oddano
D ob HH.MM«) → `#izvor` opozorilo o izvoru vprašanj (`.callout--warning/--danger`, ko ni kopije) →
`.record`: AI povzetek (`.panel` z `.doc`) | stranski stolpec (Izpolnjenost, Podatki oddaje + »Pokaži
ključe polj«) | Vprašalnik (`.qsec` po sklopih z `article.qa.q-item`) + `nav.pager` +
`details.disclosure.form-copy#obrazec-ovoj` (samo, ko obstaja `custom_html_snapshot`).

**Inventar:**

| Element | Danes | Dejanje / API | Nova oznaka |
|---|---|---|---|
| Prenesi CSV | `#btn-csv` | `prenesiCsv(r)` (BOM, `odgovor-{slug}-{id}.csv`) | `.btn--secondary` + `i-download` |
| Pokaži obrazec | `#btn-obrazec` | prvič nastavi `srcdoc` na `iframe#obrazec[sandbox=""]`, preklopi prikaz, drsi | `summary#btn-obrazec` v `details.disclosure#obrazec-ovoj`; `srcdoc` ob dogodku `toggle` (prvič), `sandbox=""` ostane |
| ← Podjetje | `a` | `/admin/company.html?id=…` | povezava v `.crumbs` in `a.qlink` |
| Podjetje (Podatki oddaje) | `a` | isto | `.kv dd a` |
| Odgovori | `renderVprasalnik()`, `izrisOdgovora()` | lestvica, izbire (vse možnosti, izbrane označene), dolgo/kratko besedilo, objekti | `.qsec`, `article.qa.q-item` (+ `.qa--empty`), `.qa__n`, `h3.qa__label.q-label` (+ `.field__req`), `.qa__key.q-kljuc`, `.qa__ans.q-answer` z `.scale`, `.opts > .opt(.is-on)`, `.ans-short`, `.ans-long`, `.ans-none`, `pre.ans-code` |
| Opozorilo o izvoru | `opozoriloOIzvoru(r)` | ko ni kopije vprašalnika | `.callout--warning` / `--danger` |
| Podatki | | `GET /api/responses/:id` | |

**Testne kljuke** (`odgovori`, `izvoz-api`): `#content` vsebuje vsa besedila vprašanj in odgovorov;
`#content .q-item` z `.q-kljuc` (besedilo ostane v DOM tudi skrito), `.q-label`, `.q-answer`;
`.r-ime`; `#btn-obrazec`; `#obrazec-ovoj`; `#obrazec` `srcdoc` in `sandbox=""`; `.q-label` za
izluščena vprašanja custom_html.

**Obvezna sprememba testa (agent B):** v `test/odgovori.test.mjs` tri trditve, ki berejo
`#obrazec-ovoj` `className.includes('hidden')`, preberejo `open`:
`'okvir je privzeto skrit'` → `await page.$eval('#obrazec-ovoj', (e) => !e.open)`,
`'klik odpre obrazec'` → `e.open`, `'drugi klik zapre obrazec'` → `!e.open`.

**Odobrene spremembe:** ključi polj so privzeto skriti (»Pokaži ključe polj«); gumb »← Podjetje«
nadomesti pot; dodan pager (glej 6.2).

**Odzivnost:** ≤ 1100 en stolpec (povzetek, stranski stolpec v dveh stolpcih, vprašalnik);
≤ 760 stranski stolpec en stolpec, pager en stolpec.

---

## 5. Strani brez prototipa (sistem + najbližji prototip)

### 5.1 Procesi (`public/admin/procesi.html`)

**Najbližje:** `podjetja.html` (orodna vrstica, tabela, noga panela) in `danes.html` (zavihki s števci).

**Komponente:** `.topbar` (h1 »Procesi«, meta `#stevec`, `a.btn--secondary` »Knjižnica« → `#knjiznica`,
`#btnNova` `.btn--primary` + `i-plus` »Nov sestanek«) → `nav.tabs#pogledi` → `section.panel#novaSeja`
(razred `hidden`; `.panel__head` »Nov sestanek«, `.panel__body` z `.form-grid` `--form-cols:3`, dejanja)
→ panel filtrov (`.panel__body` > `.filters` 8 polj + `.filter-chips#cipi`) → `section.panel` >
`.table-scroll#seje` → `section.panel#knjiznica`.

**Inventar:**

| Element | Danes | Dejanje / API | Nova oznaka |
|---|---|---|---|
| Pogledi | `#pogledi .tab[data-pogled]` + `.num` | `uporabiPogled()` nastavi `fStatus/fTranskript/fPoslano`; `osveziAktivenPogled()` | `button.tab[data-pogled]` + `.active` + `span.count` |
| Nov sestanek | `#btnNova` | preklop razreda `hidden` na `#novaSeja`, datum danes, fokus `#nsStranka`; `#nov` v naslovu odpre | `.btn--primary` |
| Obrazec | `#nsPredloga* #nsStranka* #nsProces #nsOddelek #nsSvetovalec #nsDatum` | `#nsShrani` → `POST /api/procesi/seje` → `proces-seja.html?id=`; validacija v `#nsNapaka`; `#nsPreklici` zapre | `.field` + `.field__label--sm` + `.field__req`; `#nsShrani` `.btn--primary` + `i-arrow-right`, `#nsPreklici` `.btn--secondary`, `#nsNapaka` `.field__status` v `--danger-text` |
| Filtri | `#fStranka` (input, debounce 220), `#fPredloga #fSvetovalec #fStatus #fObdobje #fNapredek #fTranskript #fPoslano` (change) | `uporabiFiltre()` v brskalniku | `.filters > .field` (`#fStranka` v `.field--grow`), selecti v `.select-wrap`, `.select--sm`/`.input--sm` |
| Značke filtrov | `#cipi .cip` + `[data-pocisti-filter]`, `#pocistiVse` | počisti en / vse filtre | `.filter-chips#cipi` > `span.chip.chip--filter.cip` + `button.chip__x[data-pocisti-filter]` (`aria-label`), `button.link#pocistiVse`; brez filtrov besedilo »Ni aktivnih filtrov.« |
| Razvrščanje | `th[data-sort]` | `razvrsti`, `.aktiven` | `th.is-sortable[data-sort]` (+ `.is-sorted.aktiven`, `span.sort-arrow` ▲/▼) |
| Vrstica seje | `tr[data-odpri]` | `/admin/proces-seja.html?id=` | `tr.is-link[data-odpri]` |
| Skupine | `tr.skupina` | V teku / Zaključeno, čaka pošiljanje / Poslano / Arhiv | `tr.table__group.skupina` |
| Napredek | `napredekBar()` | % | `.meter > .progress > .progress__fill[style=width]` (+ `--low` pod 40 %) + `.meter__val` |
| Status | `statusBadge()` | | `.chip` (osnutek), `.chip--success` (zaključen), `.chip--info` (poslan), `.chip` (arhiv) |
| Knjižnica | `#predloge` tabela, `#stPredlog` | povezava »Uredi vprašanja« → `/admin/predloga.html?id=` | `.panel__head` + `.count#stPredlog` + `.panel__desc`; `table.table` z `a.link` |
| Podatki | | `GET /api/procesi/seje?status=vse`, `GET /api/procesi/predloge` | |

**Testne kljuke** (`procesi-ui`, `naloge`): h1 »Procesi«; `#seje tbody tr[data-odpri]` z elementom
`[style*="width"]`; `#predloge tbody tr`; `#novaSeja` razred `hidden`; `#btnNova`; `#nsDatum`;
`#nsPredloga option`; `#nsShrani` → `#nsNapaka` vsebuje »stranko«; `#nsPreklici`; `#fStranka`;
**`#seje thead th` natanko 10, besedila (brez ▲▼) vključno »Stranka«, »Proces«, »Oddelek«; noben
naslov ni odrezan (`scrollWidth ≤ clientWidth + 1`); vrstice nižje od 56 px; tabela se pri 1440 px
prilega ovoju `#seje` (izmeri, ne ugibaj)**; `th[data-sort="stranka_naziv"]` in `.aktiven`;
`tr.skupina`; `#cipi` »Ni aktivnih filtrov« / »Transkript«; `#stevec` `/\d+ od \d+ sestan\w*/`;
`#cipi [data-pocisti-filter="fTranskript"]`; `#cipi .cip` (2); `#pocistiVse`; `#fSvetovalec`,
`#fPredloga option:nth-child(2)`; `#nov`; `#pogledi [data-pogled="transkript"]`;
`#pogledi .tab.active[data-pogled]`.

**Odzivnost:** ≤ 1100 filtri v več vrstic; ≤ 760 obrazec en stolpec, filtri po dva v vrsti, tabela
sej kot kartice (`.table--stack`: stranka, status, napredek, datum) ali drsenje znotraj
`.table-scroll` (stran ne sme drseti vodoravno).

### 5.2 Kanban (`public/admin/kanban.html`)

**Najbližje:** `podjetja.html` (glava, značke).

**Komponente:** `.topbar` (h1 »Kanban«, meta `#meta` »N podjetij«, `a.btn--secondary` »Seznam« →
`/admin/podjetja.html`) → namig (`p.muted`) → `#board` (stranski CSS): 7 stolpcev; stolpec = glava
(`.dot` v barvi faze, ime, `.count`) + območje spusta (`--bg-subtle`, `--radius-lg`, min. 60vh);
kartica = `--bg-surface`, rob `--border`, `--radius-md`, ime (500), `.chip--hot/--warm/--cold`,
»N odg.« (`muted`). Barve faz: nov `--text-faint`, kvalificiran `--accent-muted`, kontaktiran
`--accent`, sestanek `--accent-pressed`, ponudba `--warning`, dobljen `--success`, izgubljen `--danger`.

**Inventar:** kartica `draggable` + `zacniVlecenje()`; klik → `/admin/company.html?id=` (razen po
vlečenju, `jeVleklo`); stolpec `ondragover` + `ondrop` `spustiKartico()` → `PATCH /api/companies/:id
{status}`, napaka → alert; `GET /api/companies`. Dovoljena izboljšava: stolpec med vlečenjem dobi
`.is-over` (`--accent-subtle`).

**Testi:** `navigacija`. Tabla drsi znotraj svojega ovoja (`overflow-x:auto`, `min-width:0`), stran pa
ne (1400 in 390 px). Na telefonu stolpci min. 240 px s `scroll-snap`; vlečenje na dotik ne dela,
status se tam spreminja na seznamu Podjetja (kot danes).

### 5.3 Urejanje predloge (`public/admin/predloga.html`)

**Najbližje:** `seja.html` (način urejanja).

**Komponente:** `.topbar` (`.crumbs`: Procesi › Knjižnica (→ `/admin/procesi.html#knjiznica`) › `#naslov`;
meta `#stevec`; `#stanjeShranjeno`; `#btnShrani` `.btn--primary` onemogočen do spremembe) →
`.callout--warning` (»Urejaš predlogo …«) → `#napaka` `.callout--danger` (razred `hidden`) →
`section.panel` > `#seznam`: glava sklopa (`input` brez okvirja, poudarjen, `--bg-subtle` trak),
vrstica vprašanja (`input` brez okvirja, ki ga pokaže fokus; `.chip` tip; `label.check` obvezno;
`button.btn--ghost.btn--sm` »Odstrani« v `--danger-text`), `button.btn.btn--ghost.btn--sm` + `i-plus`
»Dodaj vprašanje v ta sklop«.

**Inventar:** `#seznam` `input` (labela, `obvezno`) → `oznaciSpremenjeno()`; `[data-odstrani]`
(potrditev); `[data-dodajpred]` → `dodajVprasanje()` (3× prompt); `#btnShrani` → `PATCH
/api/procesi/predloge/:id {questions}` (napaka v `#napaka`, »Shranjeno HH.MM«); `beforeunload`;
`GET /api/procesi/predloge/:id`; manjkajoč `?id=` → `.empty`.

**Testi:** `navigacija` (`predloga.html?id=…`, aktivna »Procesi«). **Odzivnost:** ≤ 760 vrstica
vprašanja se ovije (besedilo čez širino, tip/obvezno/odstrani pod njim).

### 5.4 Vprašalniki (`public/admin/questionnaires.html`)

**Najbližje:** `podjetja.html` (seznam) in `podjetje.html` / `seja.html` (paneli z obrazci).

**Komponente:** dva pogleda (`#view-list`, `#view-editor`; preklop z `hidden` namesto
`style.display`). Seznam: `.topbar` (h1 »Vprašalniki«, meta, `.btn--primary` »Nov vprašalnik«) →
`section.panel` > `ul.rows` (`.avatar` začetnica, ime, `.row__txt span` z `/f/slug ↗` (zunanja
povezava), »N vprašanj«, `a.link` »N odgovorov →« na `/admin/#q=ID`, »N podjetij«; desno `.chip--info`
Shramba / `.chip` Lead, `.chip--success` Aktivna / `.chip` Ugasnjena, `a.link` »Predogled« +
`i-external`). Urejevalnik: `.topbar` (`button.btn--ghost.btn--sm` + `i-arrow-left` »Vprašalniki«,
h1 `#editor-naslov`, meta `#editor-podnaslov`, `#editor-akcije`: `a.btn--secondary` »Predogled
obrazca« + `i-external`, `.btn--danger` »Ugasni« + `i-power`) → paneli (`.panel__head` + `.panel__body`):
Osnovni podatki (`.form-grid`), Vprašanja (`#vprasanja-list` vrstice `.q-row#q-row-N` v stranskem CSS:
`.chip` #N in tip, gumbi `btn--ghost btn--icon btn--sm` `i-arrow-up` / `i-arrow-down` / `i-x` z
`aria-label`), Custom HTML (`textarea.textarea--mono`), Povzetek (Haiku), Priporočila (Opus) → noga
(`#napaka` `.field__status` `--danger-text`, Prekliči `.btn--secondary`, `#btn-shrani` `.btn--primary`).

**Inventar:** `odpriUrejevalnik(null|id)` (`GET /api/questionnaires/:id`), `zapriUrejevalnik()`
(+ `nalozi()` `GET /api/questionnaires`), `osveziNamen()` (`#f-namen` skrije `#card-povzetek` in
`#card-priporocila`), `dodajVprasanje()`, `premakniVprasanje(idx, ±1)` (onemogočen na robu),
`odstraniVprasanje(idx)` (potrditev), `posodobiPolje()` (`data-field` id/label, tip, obvezno),
`posodobiOpcije()`, `shrani()` (`POST /api/questionnaires` ali `PATCH /:id`, napake v `#napaka`),
`ugasniVprasalnik(id)` (`DELETE /:id`, potrditev), `publicFormUrl(slug)` (nacrt-admin → nacrt),
polja `#f-slug #f-naziv #f-opis #f-namen #f-aktivna #f-custom-html #f-povzetek-sys #f-povzetek-usr
#f-priporocila-sys #f-priporocila-usr`, `#vprasanja-prazno`. Klik na vrstico odpre urejevalnik,
povezave v vrstici ne (`stopPropagation`).

**Besedila brez pomišljajev:** »Povzetek (Haiku)«, »Priporočila (Opus)«, »Lead: generiraj AI povzetek
in priporočila«, »Shramba: samo shrani obrazec (brez AI)«, »Aktivna: obrazec sprejema oddaje«.

**Testi:** `navigacija`. **Odzivnost:** ≤ 760 vrstica seznama: značke pod imenom; urejevalnik en
stolpec, mreža vprašanja (`md:grid-cols-12`) v en stolpec.

### 5.5 Katalog (`public/admin/katalog.html`)

**Najbližje:** `podjetja.html` (orodna vrstica, tabela, kartice na telefonu) in `podjetje.html`
(panel z obrazcem).

**Komponente:** `.topbar` (h1 »Katalog rešitev«, meta »Kaj Acenta zna narediti. To prebere AI, ko
pripravlja prodajni predlog.«, `#btn-dodaj` `.btn--primary` + `i-plus`) → `section.panel#urejanje`
(atribut `hidden`; `h2#urejanje-naslov`, `.panel__desc`, `form#obrazec.form-grid` s `.span-all`,
dejanja: `#btn-shrani` primary, `#btn-preklici` secondary, `.spacer`, `#btn-izbrisi` danger + `i-trash`,
`#napaka` `.callout--danger`) → `.toolbar` (»Status« `.seg#filterStatus`, `.spacer`, »Panoga«
`.select-wrap` `#filterPanoga`) → `section.panel` (`#seznam` z `.kat-tabela` in `.kat-kartice`;
`.panel__foot` `#foot-count` + namig) → `section.panel` »Česa ne priporočamo« (`#ne-priporocamo`
`.textarea`, `#btn-shrani-ne`, `#ne-shranjeno`).

**Inventar:** `#btn-dodaj` → `odpriUrejanje(null)`; vrstica / kartica / `button[data-id]` »Uredi« →
`odpriUrejanje(r)`; `#btn-shrani` + submit → `POST /api/katalog` ali `PATCH /api/katalog/:id`
(validacija imena); `#btn-preklici`; `#btn-izbrisi` (potrditev, `DELETE`); `#filterStatus
button[data-status]` (samo uporabljeni statusi s števci); `#filterPanoga` (panoge iz podatkov) in
`datalist#panoge`; `#btn-shrani-ne` → `PUT /api/katalog/ne-priporocamo`; `GET /api/katalog`.
Statusne značke: produkcija `.chip--success`, pilot `.chip--info`, prototip `.chip--warning`,
ponudba in ideja `.chip`, ustavljeno `.chip--danger`.

**Testne kljuke** (`katalog`): `nav a.sidebar-item.active` »Katalog« (app.js); `.kat-tabela tbody tr`
z `.kat-ime` in `.kat-pod` (»posodobljeno«, »smemo omeniti«); gumb v vrstici je znotraj
`.kat-tabela` in `table` ni širša od ovoja; `#ne-priporocamo`; `#urejanje` (atribut `hidden`);
`#btn-dodaj #btn-shrani #btn-preklici #btn-izbrisi` (atribut `hidden`); `#napaka` (atribut, besedilo
z »ime«); `#f-naziv #f-tezava #f-kje #f-panoga #f-status #f-omeniti`; **`#filterStatus button`
besedila točno »Vse 3«, »V produkciji 1« …: med oznako in števcem mora biti presledek
(`Vse <span class="count">3</span>`)**; `button[data-status="pilot"]`, `button[data-status=""]`;
`#foot-count` »1 od 3«; `#filterPanoga option` vrednosti; `.kat-tabela tbody tr:nth-child(2)`;
`.kat-tabela button[data-id]`; `#btn-shrani-ne`, `#ne-shranjeno` (»Shranjujem«, »Shranjeno«);
telefon (390, `isMobile`): `.kat-kartice` viden, `.kat-tabela` `display:none`, `.kat-kartica` klik;
prazno: `#seznam` vsebuje »Katalog je prazen«.

**Odzivnost:** ≤ 760 kartice namesto tabele (obstoječe pravilo, prelom 760 ostane), obrazec en stolpec.

### 5.6 Primerjava (`public/admin/analiza.html`)

**Najbližje:** `podjetja.html` (filtri), `danes.html` (`.metrics`), `podjetje.html` (zavihki).
Matrika, porazdelitve in odgovori so stranski CSS.

**Komponente:** `.topbar` (h1 »Primerjava vprašalnikov«, meta `#stevec`, `a.btn--secondary` »Seznam sej«
→ `/admin/procesi.html`) → panel filtrov (`.filters`: `#fStatus #fPredloga #fOd #fDo #fSvetovalec #fStranka`,
`#bPocisti` `.btn--secondary.btn--sm`; `.filter-chips#znacke`) → `#opozorila` (`.callout--warning` z `ul`)
→ `.metrics#kpi` (4) → `nav.tabs#zavihki` (4× `button.tab[data-zavihek]` + `span.count#n-*`) → paneli
`[data-panel]` (atribut `hidden`).

**Inventar:** filtri (select in datum `change`, besedilo `input` z debounce 400) → `nalozi()`
`GET /api/procesi/analiza?…` in zapis v URL; `nastaviFiltreIzUrl()`; `#bPocisti` in
»Počisti filtre« v praznem stanju → `pocisti()`; značke `[data-odstrani]` in `#znackePocisti`;
zavihki → `preklopi()` (+ `zavihek=` v URL); `#iskanjeOdgovori` (debounce 200) → `filtrirajOdgovore()`;
`#bRazpri` / `#bStrni`; povezave na seje (`/admin/proces-seja.html?id=`); `GET /api/procesi/predloge`
za `#fPredloga`.

**Testne kljuke** (`analiza`): `#stevec`; `.sidebar-item.active[href="/admin/analiza.html"]` (app.js);
**`#kpi .kpi .v`** (`.metric.kpi` z `.metric__value.v`), `#kpi` besedilo s pravilnim sklonom;
`#opozorila` (»osnutk«, »filter je preozek«); `#matrika thead th.seja` + `a` na sejo;
`#matrika tbody tr:not(.skupina)` = število vprašanj (skupinske vrstice imajo razred `skupina`);
`#matrika .ni-vprasanja`; `[data-panel]`, `[data-zavihek]`, **`.tab.active[data-zavihek]`**;
`#porazdelitve .vrsta-moznosti` s **`.stolpic i`** (inline `width` = odstotek) in **`.st` z `b` in `.pc`**
(brez »·«), besedilo »več izbir«; `details.vprasanje-blok`; `#bRazpri #bStrni #iskanjeOdgovori`;
`#kazalniki table.kaz tbody tr`; `#fStatus`, **`#znacke .chip.active`** (aktiven filter je
`span.chip.chip--filter.active[data-odstrani]`, klik odstrani filter); `#fStranka`; prazen nabor:
vsak `[data-panel]` vsebuje »Nobena seja ne ustreza filtrom«; `#bPocisti`; vse `main a[href]` se
začnejo z `/admin/`; 390 px brez preliva, `#sidebar` brez `offsetParent` (predal to izpolni).

**Odzivnost:** ≤ 760 filtri po dva, kazalniki 2 stolpca, matrika drsi znotraj panela (prvi stolpec
lepljiv, ožji kot danes: 150 px), odgovori en stolpec.

### 5.7 Iskanje (`public/admin/search.html`)

**Najbližje:** `podjetja.html` (iskalno polje) in `odgovor.html` (bralni slog).

**Komponente:** `.topbar` (h1 »Iskanje«, meta »Polnotekstovno po vseh odgovorih«) → `form#form` z
`label.search.search--lg` (`i-search`, `input#q`) → `#results`: števec (`p.muted`), `ul.rows` ali
paneli zadetkov (povezava »{podjetje}: odgovor #{id}« → `/admin/response.html?id=`, datum `muted`,
izsek `highlight` z `<b>` označbami: stranski CSS `.zadetek b { background: var(--warning-bg);
color: var(--text); border-radius: var(--radius-xs); padding: 0 2px; }`). Brez iskanja: `.empty`
(»Vpišite iskalno geslo …«); brez zadetkov: `.empty` z geslom v »…«.

**Inventar:** `qs('q')` ob nalaganju, submit → `history.replaceState` `?q=` in `iskanje(q)` →
`GET /api/search?q=`; `showLoading`, `showError`. Ctrl K / »/« na tej strani fokusira `main input`
(app.js).

**Testi:** `navigacija`. **Odzivnost:** zadetki en stolpec, povezava se lahko ovije.

### 5.8 Vpogledi (`public/admin/insights.html`)

**Najbližje:** `podjetje.html` (dokumentni panel `.docp` + `.doc`).

**Komponente:** `.topbar` (h1 »Vpogledi čez kliente«, meta »AI analiza vzorcev čez vse kliente«,
`.btn--secondary` + `i-sparkles` »Generiraj nove (Opus, ~$0,30)«) → `#content`: `section.panel` z
`.docp__head` (»Generirano D«, meta vrstica »N klientov · N respondentov · zadnjih N dni«),
dejanje »Natisni« (`button.btn--ghost.btn--sm` + `i-printer`, `window.print()`), `.docp__body` >
`article.doc` (**`md(content)`** namesto `marked.parse`: varno in tabele ovite); ne-markdown →
`pre.ans-code`. Prazno: `.empty` z razlago, ki napoti na gumb v glavi (brez drugega gumba za isto).

**Inventar:** `regenerirajInsights()` (potrditev, `POST /api/insights/regenerate`, alert);
`GET /api/insights`; tiskanje.

**Testi:** `navigacija` (skupina Napredno odprta, Vpogledi aktivni). **Odzivnost:** dokument čez
širino, tabele drsijo v `.doc-table`.

---

## 6. Elementi prototipa brez podatkov (in priporočila)

| # | Element (zaslon) | Stanje podatkov | Priporočilo |
|---|---|---|---|
| 6.1 | Stolpec **»Prodajni predlog«** na Podjetjih (Pripravljen / Pripravlja se / ni) | `GET /api/companies` ga ne vrača | **Majhen dodatek na strežniku** v `src/routes/api.js` (seznam podjetij): `EXISTS (SELECT 1 FROM prodajni_predlogi pp WHERE pp.company_id = c.id AND pp.status = 'ok') AS ima_prodajni_predlog, EXISTS (SELECT 1 FROM prodajni_predlogi pp WHERE pp.company_id = c.id AND pp.status = 'pripravlja') AS prodajni_predlog_tece` (indeksa obstajata). Izvede koordinator (en ponoven zagon strežnika, ko nihče ne testira). Brez tega: stolpec se ne izriše. |
| 6.2 | **Pager** na Odgovoru (»1 od 12«, prejšnji / naslednji z imenom) | ni na `GET /api/responses/:id`, je na `GET /api/companies/:company_id` (`responses` z `raw_data`, `vprasanja`, `questionnaire_id`, urejeno po `submitted_at DESC`) | **Ožiči na obstoječi API**, brez dodatka na strežniku: drugi klic, filter na isti vprašalnik, ime iz `izpolnjevalec()`. Prvi/zadnji: onemogočen gumb oz. »To je prvi odgovor«. |
| 6.3 | »iz N odgovorov« pri Pripravi na delavnico | števec je danes napačen ob zastarelih priporočilih | Popravek v brskalniku: `odgZaTab.length - novejsi`. |
| 6.4 | Števci po sklopih v kazalu Seje (»4/6«) in skok na prvo manjkajoče obvezno polje | podatki so v brskalniku (`vprasanja`, `odgovori`, `jeIzpolnjeno`) | Ožiči v brskalniku. »Pojdi na prvo polje« po 422 uporabi `manjka[0].id` (API vrača `{id, label}`). |
| 6.5 | »Pokaži ključe polj« na Odgovoru | ključi obstajajo | Preklop razreda `.show-keys` na ovoju vprašalnika. |
| 6.6 | Vloga in e-naslov pod imenom na Odgovoru | `izpolnjevalec()` vrne `mail` in `vloga` | Ožiči (`mailto:`). |
| 6.7 | Segment »AI · Warm« v Oceni leada | AI vrednost se ob ročni oceni ne hrani posebej (`kvalifikacija_rocna`) | Vrednost ob »AI« prikaži samo, ko ocena ni ročna; sicer samo »AI« (klik = prepusti AI, kot danes). |
| 6.8 | Uporabniški blok v stranski vrstici (MZ, ai@acenta.si, Admin) | API za prijavljenega uporabnika ne obstaja (basic auth) | Ostane statičen kot doslej (ni nova obljuba). |
| 6.9 | »Počisti filtre« v praznem stanju Podjetij | | Ožiči v brskalniku (ponastavi tri filtre). |

Vse ostalo v prototipih ima podatke že danes (kazalniki in iskrica na Danes iz `/api/stats`,
vedra iz `/api/naloge`, stanja priporočil iz `has_priporocila` / `priporocila_updated_at`,
faze statusa, opombe z `interne_opombe_updated_at`, `kvalifikacija_razlog`).

---

## 7. Hitri pregled testnih sprememb

| Test | Kdo | Sprememba |
|---|---|---|
| `navigacija.test.mjs` | FAZA 1 (narejeno) | mobilno »navigacija dosegljiva« zdaj odpre predal (`#navOdpri`) in preveri, da je »Procesi« res viden |
| `prodajni-predlog-api.test.mjs` | B | trditev o glavi (glej 4.3) |
| `izvoz-api.test.mjs` | B | `.e-title` → `.topbar` |
| `odgovori.test.mjs` | B | `#obrazec-ovoj` `hidden` → `open` (3 trditve) |
| `procesi-ui.test.mjs` | C | samo če `#btnUredi` dobi kratko oznako: branje `[data-uredi]` |

Ostale kljuke se ohranijo kot dodatni razredi oz. ID-ji (seznami zgoraj).
