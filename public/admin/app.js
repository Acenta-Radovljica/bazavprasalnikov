// ── Skupne helper funkcije za vse admin strani ────────────────────────────
// Vse strani so za isti origin in basic auth se prenese avtomatsko (brskalnik
// cache-a kredencije po prvi prijavi).

// API fetch — vrne JSON ali null ob napaki.
async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(path, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      console.error('[api] HTTP', res.status, path);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('[api] fetch napaka:', err.message);
    return null;
  }
}

// Format datuma — slovensko, brez sekund.
function formatDatum(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('sl-SI', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Samo datum, brez ure. Sprejme tudi gol niz "YYYY-MM-DD" (DATE stolpci pridejo
// iz baze kot niz — glej opombo o setTypeParser v src/db.js).
function formatDan(v) {
  if (!v) return '—';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${+m[3]}. ${+m[2]}. ${m[1]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

// HTML escape — varno za injection v innerHTML.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Query parameter helper.
function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Markdown AI besedila v HTML. Surov HTML v besedilu se ubezi: AI povzetek
// nastane iz odgovorov stranke, zato ga ne vstavljamo kot kodo. Brez knjiznice
// `marked` na strani vrne ubezano besedilo z ohranjenimi prelomi.
function md(t) {
  const varno = String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (typeof marked === 'undefined') return `<p style="white-space:pre-wrap">${varno}</p>`;
  // Wide markdown tables scroll inside their own frame (.doc-table in
  // admin.css) instead of stretching the page on a phone.
  return marked.parse(varno)
    .replace(/<table>/g, '<div class="doc-table"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

// ── Izpolnjevalec ─────────────────────────────────────────────────────────
// Kdo je vprasalnik izpolnil. Obrazci nimajo enotnega polja za ime (lead
// obrazec ima `ime`, custom HTML `kontakt`, anketa pred delavnico je lahko
// anonimna), zato se ime isce najprej po znanih kljucih, nato po besedilu
// vprasanja. Brez imena pade na e-naslov, brez obojega na "Anonimni odgovor".
const KLJUCI_IME = /^(ime[_ ]?(in[_ ]?)?priimek|polno[_ ]?ime|full[_ ]?name|name|ime|kontaktna[_ ]?oseba|kontakt[_ ]?oseba|oseba|kontakt|izpolnjevalec|udelezenec|udeleženec)$/i;
const OZNAKE_IME = /(ime in priimek|vaše ime|vase ime|polno ime|kontaktna oseba|kdo izpolnjuje|^ime\b)/i;
const KLJUCI_MAIL = /^(e[-_]?mail|mail|e[-_]?naslov|email[_ ]?naslov)$/i;
const KLJUCI_VLOGA = /^(vloga|funkcija|delovno[_ ]?mesto|pozicija|polozaj|položaj|role)$/i;

function izpolnjevalec(raw, questions) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kratek = (v) => (typeof v === 'string' && v.trim() && v.trim().length <= 80) ? v.trim() : '';
  const jeMail = (v) => /\S+@\S+\.\S+/.test(v);
  // Telefonska stevilka v polju "kontakt" ni ime.
  const niIme = (v) => jeMail(v) || /^[+\d\s\/().-]{6,}$/.test(v) || /^https?:/i.test(v);

  let ime = '';
  for (const [k, v] of Object.entries(r)) {
    const s = kratek(v);
    if (s && !niIme(s) && KLJUCI_IME.test(k)) { ime = s; break; }
  }
  // "ime" + "priimek" kot loceni polji
  if (ime && kratek(r.priimek) && !ime.includes(r.priimek.trim())) ime = `${ime} ${r.priimek.trim()}`;
  if (!ime) {
    for (const q of (Array.isArray(questions) ? questions : [])) {
      const s = kratek(r[q.id]);
      if (s && !niIme(s) && OZNAKE_IME.test(q.label || '')) { ime = s; break; }
    }
  }

  let mail = '';
  for (const [k, v] of Object.entries(r)) {
    const s = kratek(v);
    if (s && (KLJUCI_MAIL.test(k) || (jeMail(s) && !/url|web|stran/i.test(k)))) { mail = s; break; }
  }
  let vloga = '';
  for (const [k, v] of Object.entries(r)) {
    const s = kratek(v);
    if (s && KLJUCI_VLOGA.test(k)) { vloga = s; break; }
  }

  const prikaz = ime || mail || 'Anonimni odgovor';
  const zacetnice = ime
    ? ime.split(/\s+/).filter(Boolean).slice(0, 2).map(b => b[0].toUpperCase()).join('')
    : (mail ? mail[0].toUpperCase() : '?');
  const podnaslov = [vloga, ime ? mail : ''].filter(Boolean).join(' · ');
  return { ime: prikaz, imaIme: !!ime, zacetnice, podnaslov, mail, vloga };
}

// ── Vprasanja odgovora ────────────────────────────────────────────────────
// Besedila vprasanj nad odgovorom. Uporabljata jih stran odgovora (prikaz) in
// stran podjetja (izvoz za Claude), zato so tu in ne na eni od strani.

// Polje honeypota ni vprašanje, ampak past za robote. Pri pravi oddaji je
// prazno; če ni, je to podatek o botu in ne odgovor stranke.
const HONEYPOT = 'company_url';

// Vprašanja za prikaz, po vrsti:
//   1. kopija vprašanj ob oddaji (navadni obrazci),
//   2. besedila, izluščena iz shranjenega HTML obrazca (custom_html),
//   3. besedila iz DANAŠNJEGA HTML obrazca (stare vrstice brez kopije),
//   4. današnja vprašanja vprašalnika.
// Brez 2. in 3. se pri custom_html obrazcih odgovori prikažejo pod surovimi
// ključi (`podrocje_karoserija`), ker ti obrazci nimajo polja `questions` —
// vprašalnik je pri njih prav ta HTML.
function vprasanjaZaPrikaz(r) {
  if (Array.isArray(r.vprasanja_za_prikaz) && r.vprasanja_za_prikaz.length) {
    return r.vprasanja_za_prikaz;
  }
  const html = r.custom_html_snapshot || r.q_custom_html;
  if (html) {
    const izHtml = vprasanjaIzObrazca(html);
    if (izHtml.length) return izHtml;
  }
  return r.q_questions || [];
}

// Iz HTML obrazca izlušči vprašanja v vrstnem redu, v katerem so bila na
// zaslonu. Vrstni red je sam po sebi podatek: ključi v raw_data so v
// poljubnem zaporedju, obrazec pa ima svojega.
//
// Bere se samo besedilo. DOMParser skript ne izvaja, zato je razčlenjevanje
// shranjenega tujega HTML varno.
function vprasanjaIzObrazca(html) {
  let doc;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); }
  catch { return []; }

  const najdena = [];
  const videni = new Set();

  for (const polje of doc.querySelectorAll('input[name], textarea[name], select[name]')) {
    const ime = polje.getAttribute('name');
    if (!ime || videni.has(ime)) continue;
    const tip = (polje.getAttribute('type') || polje.tagName.toLowerCase()).toLowerCase();
    if (tip === 'hidden' || tip === 'submit' || tip === 'button') continue;
    // Skrito polje (honeypot) ni vprašanje.
    if (ime === HONEYPOT || polje.closest('[aria-hidden="true"]')) continue;
    videni.add(ime);
    // Skupina radiov/checkboxov: zberemo vse izbire, da jih stran lahko
    // pokaze kot v obrazcu (izbrana oznacena, ostale bledo).
    let options;
    const skupina = doc.querySelectorAll(`[name="${CSS.escape(ime)}"]`);
    if ((tip === 'radio' || tip === 'checkbox') && skupina.length > 1) {
      options = [...skupina].map((el) => {
        const oznaka = (el.id && doc.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
        const value = el.getAttribute('value') ?? 'on';
        return { value, label: (oznaka && cistoBesedilo(oznaka)) || value };
      });
    } else if (tip === 'select') {
      options = [...polje.querySelectorAll('option')]
        .filter((o) => (o.getAttribute('value') ?? o.textContent).trim() !== '')
        .map((o) => ({ value: o.getAttribute('value') ?? o.textContent.trim(), label: o.textContent.trim() }));
    }
    najdena.push({
      id: ime, tip, options,
      label: besediloVprasanja(doc, polje, ime),
      sklop: naslovPred(doc, polje),
    });
  }

  // Ista oznaka pri dveh poljih je za bralca neuporabna: obrazec ima
  // "car.advisor" enkrat v seznamu portalov in enkrat pri dostopih.
  // Podvojene zato ločimo s sklopom, ostale pustimo kratke.
  const stevec = new Map();
  for (const q of najdena) stevec.set(q.label, (stevec.get(q.label) || 0) + 1);
  for (const q of najdena) {
    if (stevec.get(q.label) > 1 && q.sklop) q.label = `${q.sklop}: ${q.label}`;
  }

  return najdena;
}

// Naslov sklopa, pod katerega polje spada: zadnji naslov pred njim.
function naslovPred(doc, polje) {
  let zadnji = '';
  for (const naslov of doc.querySelectorAll('h1, h2, h3, h4, legend')) {
    const jePred = naslov.compareDocumentPosition(polje) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (!jePred) break;
    zadnji = cistoBesedilo(naslov);
  }
  return zadnji;
}

// Poišče besedilo vprašanja za dano polje. Zaporedje poskusov je pomembno:
// pri skupinah (radio, checkbox) je `label for=` besedilo POSAMEZNE izbire
// ("Imamo dostop"), ne vprašanja, zato se pri njih najprej pogleda ovoj.
function besediloVprasanja(doc, polje, ime) {
  const jeSkupina = doc.querySelectorAll(`[name="${CSS.escape(ime)}"]`).length > 1;
  const ovoj = polje.closest('.q, .field, .form-group, fieldset');

  // Locnica je SKUPINA, ne tip polja. Kadar si ime deli vec kontrol
  // (radio "da/ne"), je oznaka ob posamezni kontroli besedilo izbire in
  // vprasanje je nad njimi. Kadar je ime svoje (samostojen checkbox
  // "Prodaja novih vozil", "Google"), pa je prav ta oznaka vprasanje —
  // polje in izbira sta takrat ista stvar.
  const kandidati = jeSkupina
    ? [
        () => ovoj?.querySelector('legend, .qlabel'),
        // Cez vec ravni: napis vrstice je pogosto SESTRA ovoja z izbirami
        // (`<div class="pname">Google Business Profile</div>` poleg `.opts`),
        // ne njegov otrok.
        () => napisVOvoju(polje),
      ]
    : [
        () => (polje.id ? doc.querySelector(`label[for="${CSS.escape(polje.id)}"]`) : null),
        () => polje.closest('label'),
        () => ovoj?.querySelector('legend, .qlabel, label'),
        () => napisVOvoju(polje),
      ];

  for (const najdi of kandidati) {
    const el = najdi();
    if (!el) continue;
    const besedilo = cistoBesedilo(el);
    if (besedilo) return besedilo;
  }

  const nadomestno = polje.getAttribute('aria-label') || polje.getAttribute('placeholder');
  return (nadomestno || '').trim() || ime;
}

// Besedilo elementa brez vsebine kontrol in brez drobnih pojasnil.
// Pojasnilo je pogosto znotraj oznake (`<span class="sublabel">`); če ga
// pustimo notri, se vprašanje razvleče čez tri vrstice.
function cistoBesedilo(el) {
  const kopija = el.cloneNode(true);
  kopija.querySelectorAll('input, textarea, select, button').forEach((x) => x.remove());
  kopija.querySelectorAll('.sublabel, .hint, .help, small').forEach((x) => x.remove());
  return (kopija.textContent || '').replace(/\s+/g, ' ').trim();
}

// Zadnja pot: nekateri obrazci vprašanja ne zapišejo v <label>, ampak v
// navaden element ob poljih (`<div class="pname">Google Business Profile</div>`
// nad skupino radiov). Zato se povzpnemo največ štiri ravni navzgor in na
// vsaki poiščemo prvi element z besedilom, ki sam ne vsebuje nobene kontrole.
function napisVOvoju(polje, maxRavni = 4) {
  let ovoj = polje.parentElement;
  for (let raven = 0; raven < maxRavni && ovoj && ovoj.tagName !== 'FORM'; raven++) {
    for (const kandidat of ovoj.children) {
      if (kandidat.querySelector?.('input, textarea, select, button')) continue;
      if (kandidat.matches?.('input, textarea, select, button')) continue;
      if (cistoBesedilo(kandidat)) return kandidat;
    }
    ovoj = ovoj.parentElement;
  }
  return null;
}

// Stevilo s pravilno sklanjanim samostalnikom: 1 seja, 2 seji, 3 seje, 5 sej.
// oblike = [ednina, dvojina, mnozina 3-4, rodilnik 5 in vec].
//
// ZAKAJ: "2 svetovalcev" in "3 osnutkov" v vmesniku bereta kot strojni prevod.
// Slovenscina ima dvojino, zato pogoj `n === 1 ? a : b` NI dovolj.
function sklon(n, oblike) {
  const d = Math.abs(Math.trunc(n)) % 100;
  const i = d === 1 ? 0 : d === 2 ? 1 : (d === 3 || d === 4) ? 2 : 3;
  return `${n} ${oblike[i]}`;
}

// Najpogostejsi nabori, da jih ni treba pisati na vsaki strani znova.
const SKLONI = {
  seja:       ['seja', 'seji', 'seje', 'sej'],
  stranka:    ['stranka', 'stranki', 'stranke', 'strank'],
  vprasanje:  ['vprašanje', 'vprašanji', 'vprašanja', 'vprašanj'],
  svetovalec: ['svetovalec', 'svetovalca', 'svetovalci', 'svetovalcev'],
  vprasalnik: ['vprašalnik', 'vprašalnika', 'vprašalniki', 'vprašalnikov'],
  osnutek:    ['osnutek', 'osnutka', 'osnutki', 'osnutkov'],
};

// Odloži klic, dokler uporabnik neha tipkati. Brez tega vsak pritisk tipke
// sproži zahtevo na strežnik.
function debounce(fn, ms = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ── Ikone ─────────────────────────────────────────────────────────────────
// One SVG sprite for every admin page (same set as design-prototype/).
// renderNav() injects it once; markup uses <svg class="icon"><use href="#i-plus"/></svg>
// and page JS can call ikona('plus'). Lucide-style paths, 24x24, stroke only.
const IKONE = {
  'alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7M19 12H5"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
  'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
  'bars': '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  'book': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2zM9 7h7M9 11h5"/>',
  'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'building': '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  'chart': '<path d="M12 20V10M18 20V4M6 20v-4"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'check-square': '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  'chev-down': '<path d="m6 9 6 6 6-6"/>',
  'chev-left': '<path d="m15 18-6-6 6-6"/>',
  'chev-right': '<path d="m9 18 6-6-6-6"/>',
  'chev-up': '<path d="m18 15-6-6-6 6"/>',
  'columns': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
  'copy': '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  'external': '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'eye': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'file': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
  'inbox': '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'info': '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  'lock': '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  'menu': '<path d="M4 6h16M4 12h16M4 18h16"/>',
  'merge': '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  'pencil': '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  'plus': '<path d="M12 5v14M5 12h14"/>',
  'power': '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  'printer': '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  'refresh': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'search': '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  'send': '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  'sparkles': '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  'trash': '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  'x': '<path d="M18 6 6 18M6 6l12 12"/>',
};

// <svg> that points to a sprite symbol. `razred` adds e.g. 'icon--sm'.
function ikona(ime, razred = '') {
  return `<svg class="icon${razred ? ' ' + razred : ''}" aria-hidden="true"><use href="#i-${ime}"/></svg>`;
}

// Inject the sprite once, as the first child of <body>. <use> elements in
// static page markup above the script resolve as soon as the symbols exist.
function vstaviIkone() {
  if (document.getElementById('ikone')) return;
  const simboli = Object.entries(IKONE)
    .map(([ime, pot]) => `<symbol id="i-${ime}" viewBox="0 0 24 24">${pot}</symbol>`).join('');
  document.body.insertAdjacentHTML('afterbegin',
    `<svg id="ikone" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${simboli}</svg>`);
}

// ── Navigacija ────────────────────────────────────────────────────────────
// ONE set of items for ALL pages, labeled sidebar as in the approved
// prototype (design-prototype/danes.html, October 2026): Danes, group Delo,
// group Analiza, folded group Napredno, user block at the bottom.
// test/navigacija.test.mjs reads: #sidebar, nav a.sidebar-item (label = first
// <span>), a.active, #naprednoToggle, #naprednoSeznam, #nav-ukrepaj.
const NAV_POSTAVKE = [
  // Count of tasks in the "Ukrepaj" bucket; filled by napolniZnackoNalog().
  { kljuc: 'pregled', naslov: 'Danes', href: '/admin/', ikona: 'inbox', znacka: 'nav-ukrepaj' },
  { skupina: 'Delo', kljuc: 'procesi', naslov: 'Procesi', href: '/admin/procesi.html', ikona: 'check-square' },
  { kljuc: 'podjetja', naslov: 'Podjetja', href: '/admin/podjetja.html', ikona: 'building' },
  // 25. 9. 2026: back from "Napredno" to Delo, questionnaires are edited regularly.
  { kljuc: 'questionnaires', naslov: 'Vprašalniki', href: '/admin/questionnaires.html', ikona: 'file' },
  // What Acenta can build; read by the sales proposal (migration 014).
  { kljuc: 'katalog', naslov: 'Katalog', href: '/admin/katalog.html', ikona: 'book' },
  { skupina: 'Analiza', kljuc: 'analiza', naslov: 'Primerjava', href: '/admin/analiza.html', ikona: 'chart' },
  { kljuc: 'search', naslov: 'Iskanje', href: '/admin/search.html', ikona: 'search', bliznjica: true },
];

// Technical page the sales person does not need (AI analysis across clients).
// Folded into "Napredno" at the bottom; the browser remembers open/closed.
// If the active page is in the group, the group is forced open.
const NAPREDNO_POSTAVKE = [
  { kljuc: 'insights', naslov: 'Vpogledi', href: '/admin/insights.html', ikona: 'book-open' },
];

const NAPREDNO_LS_KLJUC = 'nav_napredno_odprto';

function jeNaprednoOdprto(aktiven) {
  if (NAPREDNO_POSTAVKE.some(p => p.kljuc === aktiven)) return true;
  try { return localStorage.getItem(NAPREDNO_LS_KLJUC) === '1'; } catch { return false; }
}

// Old pages used other keys (e.g. 'home' for Podjetja); map them so call
// sites do not have to change.
const NAV_VZDEVKI = { home: 'podjetja', kanban: 'podjetja', questionnaires: 'questionnaires' };

// Kept for compatibility: inline SVG from raw path markup.
function svgIkona(pot, velikost = 20) {
  return `<svg width="${velikost}" height="${velikost}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${pot}</svg>`;
}

// "Ctrl K" on Windows/Linux, "⌘K" on Apple keyboards.
function oznakaBliznjice() {
  const apple = /Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  return apple ? '⌘K' : 'Ctrl K';
}

// One nav item. Label is the FIRST <span> (the test reads it that way).
function navPostavkaHtml(p, aktiven) {
  const jeAktivna = p.kljuc === aktiven;
  const znacka = p.znacka ? `<span class="nav-item__count" id="${p.znacka}" hidden></span>` : '';
  const bliznjica = p.bliznjica ? `<span class="nav-item__kbd" aria-hidden="true">${oznakaBliznjice()}</span>` : '';
  return `<a class="nav-item sidebar-item${jeAktivna ? ' active' : ''}" href="${p.href}"${jeAktivna ? ' aria-current="page"' : ''}>`
    + `${ikona(p.ikona)}<span class="nav-item__label">${esc(p.naslov)}</span>${znacka}${bliznjica}</a>`;
}

// Sidebar contents. Returns a string.
function sidebarHtml(active = '') {
  const aktiven = NAV_VZDEVKI[active] || active;
  const postavke = NAV_POSTAVKE.map(p =>
    (p.skupina ? `<div class="nav-group">${esc(p.skupina)}</div>` : '') + navPostavkaHtml(p, aktiven)).join('');

  return `
    <div class="sidebar__brand">
      <span class="brand-mark" aria-hidden="true">a</span>
      <span class="sidebar__brand-text"><b>Acenta baza</b><small>Interna konzola</small></span>
      <button class="btn btn--ghost btn--icon sidebar__close" type="button" id="navZapri" data-nav-close aria-label="Zapri meni">${ikona('x')}</button>
    </div>
    <nav class="nav" aria-label="Glavna navigacija">
      ${postavke}
      ${naprednoHtml(aktiven)}
    </nav>
    <div class="sidebar__foot">
      <span class="avatar" aria-hidden="true">MZ</span>
      <div class="ellipsis"><b class="ellipsis">ai@acenta.si</b><span class="ellipsis" id="nav-noga">Admin</span></div>
    </div>`;
}

// Folded group "Napredno" at the bottom of the sidebar.
function naprednoHtml(aktiven) {
  const odprto = jeNaprednoOdprto(aktiven);
  return `
    <button class="nav-item nav-item--toggle" type="button" id="naprednoToggle" aria-expanded="${odprto}" aria-controls="naprednoSeznam">
      ${ikona('chev-down', 'nav-item__chev')}<span class="nav-item__label">Napredno</span>
    </button>
    <div class="nav-sub" id="naprednoSeznam"${odprto ? '' : ' hidden'}>
      ${NAPREDNO_POSTAVKE.map(p => navPostavkaHtml(p, aktiven)).join('')}
    </div>`;
}

// Mobile bar (only visible at <= 760 px): menu button, brand, search.
function mobilnaVrsticaHtml() {
  return `
    <button class="btn btn--ghost btn--icon" type="button" id="navOdpri" data-nav-open-btn aria-label="Odpri meni" aria-controls="sidebar" aria-expanded="false">${ikona('menu', 'icon--lg')}</button>
    <a class="mobilebar__brand" href="/admin/"><span class="brand-mark" aria-hidden="true">a</span>Acenta baza</a>
    <span class="spacer"></span>
    <a class="btn btn--ghost btn--icon" href="/admin/search.html" aria-label="Iskanje">${ikona('search', 'icon--lg')}</a>`;
}

// Ctrl/Cmd+K and "/" open search. The nav item is a plain link, so the
// shortcut is a speed-up, not a requirement.
function vezaviTipkovnice() {
  if (window.__bliznjiceVezane) return;
  window.__bliznjiceVezane = true;
  document.addEventListener('keydown', (e) => {
    const vTipkanju = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')
      || e.target?.isContentEditable;
    const jeK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
    const jePosevnica = e.key === '/' && !vTipkanju && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (!jeK && !jePosevnica) return;
    e.preventDefault();
    if (location.pathname.endsWith('/search.html')) {
      document.querySelector('main input')?.focus();
    } else {
      location.href = '/admin/search.html';
    }
  });
}

// Fill the task counter in the nav. Fails silently: the badge is a helper,
// not a requirement for the page to work.
async function napolniZnackoNalog() {
  const el = document.getElementById('nav-ukrepaj');
  if (!el) return;
  try {
    const r = await apiFetch('/api/naloge');
    const n = r?.skupno?.ukrepaj ?? 0;
    if (n > 0) {
      el.textContent = n;
      el.setAttribute('aria-label', `${sklon(n, ['naloga', 'nalogi', 'naloge', 'nalog'])} na tebi`);
      el.hidden = false;
    }
  } catch { /* no badge */ }
}

// Drawer on narrow screens: open/close, Escape, focus, inert content.
function priklopiPredal() {
  if (window.__predalVezan) return;
  window.__predalVezan = true;
  const telo = document.body;
  const odpriGumb = () => document.getElementById('navOdpri');
  const vsebina = () => document.querySelector('.app > .main');

  function odpri() {
    telo.setAttribute('data-nav-open', '');
    odpriGumb()?.setAttribute('aria-expanded', 'true');
    if (vsebina()) vsebina().inert = true;
    document.getElementById('navZapri')?.focus();
  }
  function zapri(vrniFokus = true) {
    if (!telo.hasAttribute('data-nav-open')) return;
    telo.removeAttribute('data-nav-open');
    odpriGumb()?.setAttribute('aria-expanded', 'false');
    if (vsebina()) vsebina().inert = false;
    if (vrniFokus) odpriGumb()?.focus();
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-nav-open-btn]')) { odpri(); return; }
    if (e.target.closest('[data-nav-close]')) { zapri(); return; }
    // Following a link inside the drawer closes it (matters for #hash links).
    if (e.target.closest('#sidebar a[href]')) zapri(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') zapri(); });
  // Growing past the breakpoint with the drawer open must not leave the page inert.
  window.matchMedia('(min-width: 761px)').addEventListener('change', (m) => { if (m.matches) zapri(false); });
}

// Click on "Napredno" opens/closes the group and remembers the state.
function priklopiNapredno() {
  const gumb = document.getElementById('naprednoToggle');
  const seznam = document.getElementById('naprednoSeznam');
  if (!gumb || !seznam) return;
  gumb.addEventListener('click', (e) => {
    e.preventDefault();
    const odpri = seznam.hidden;
    seznam.hidden = !odpri;
    gumb.setAttribute('aria-expanded', String(odpri));
    try { localStorage.setItem(NAPREDNO_LS_KLJUC, odpri ? '1' : '0'); } catch { /* private mode */ }
  });
}

// Make sure the shared stylesheet and the font are loaded (pages should
// link both in <head>; this covers pages that forget).
function zagotoviStile() {
  if (!document.querySelector('link[href*="fonts.googleapis.com/css2?family=Inter:opsz"]')) {
    const f = document.createElement('link');
    f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap';
    document.head.appendChild(f);
  }
  if (!document.querySelector('link[href="/admin/admin.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/admin/admin.css';
    document.head.appendChild(l);
  }
}

// Build the app shell around the page:
//   <div class="app"> .mobilebar  aside#sidebar.sidebar  .scrim  main.main </div>
// Pages provide <div class="app"><aside id="sidebar"></aside><main>…</main></div>;
// a page with only <main> (or the old <header id="nav">) gets the wrapper
// built here, so both keep working.
function zgradiOvojnico(active) {
  const vsebina = document.querySelector('main');
  let aside = document.getElementById('sidebar');
  if (!aside && !vsebina) {
    console.warn('[nav] page has neither <aside id="sidebar"> nor <main>');
    return;
  }
  if (!aside) {
    aside = document.createElement('aside');
    aside.id = 'sidebar';
    let ovoj = vsebina.parentElement;
    if (!ovoj || ovoj === document.body || ovoj.tagName === 'HTML') {
      ovoj = document.createElement('div');
      vsebina.parentNode.insertBefore(ovoj, vsebina);
      ovoj.appendChild(vsebina);
    }
    ovoj.insertBefore(aside, vsebina);
  }

  const ovoj = aside.parentElement;
  ovoj.className = 'app';
  aside.className = 'sidebar';
  aside.setAttribute('aria-label', 'Glavna navigacija');
  aside.innerHTML = sidebarHtml(active);

  if (!ovoj.querySelector(':scope > .mobilebar')) {
    const vrstica = document.createElement('header');
    vrstica.className = 'mobilebar';
    vrstica.innerHTML = mobilnaVrsticaHtml();
    ovoj.insertBefore(vrstica, aside);
  }
  if (!ovoj.querySelector(':scope > .scrim')) {
    const zavesa = document.createElement('div');
    zavesa.className = 'scrim';
    zavesa.setAttribute('data-nav-close', '');
    aside.after(zavesa);
  }
  const glavna = ovoj.querySelector(':scope > main') || vsebina;
  glavna?.classList.add('main');

  // The old dark top bar is gone for good.
  document.getElementById('nav')?.remove();
}

// Entry point for every admin page: renderNav('procesi') etc.
function renderNav(active = '') {
  zagotoviStile();
  vstaviIkone();
  zgradiOvojnico(active);
  priklopiNapredno();
  priklopiPredal();
  napolniZnackoNalog();
  vezaviTipkovnice();
}

// Same as renderNav(); pages that already had <aside id="sidebar"> call this.
function renderSidebar(active = '') {
  renderNav(active);
}

// Loading state inside an element.
function showLoading(targetId, msg = 'Nalagam …') {
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = `<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>${esc(msg)}</div>`;
}

// Error state inside an element.
function showError(targetId, msg) {
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = `<div class="callout callout--danger" role="alert">${ikona('alert')}<div>${esc(msg)}</div></div>`;
}
