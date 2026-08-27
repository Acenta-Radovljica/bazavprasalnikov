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

// Odloži klic, dokler uporabnik neha tipkati. Brez tega vsak pritisk tipke
// sproži zahtevo na strežnik.
function debounce(fn, ms = 300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ── Navigacija ────────────────────────────────────────────────────────────
// EN nabor postavk za VSE strani. Prej sta v aplikaciji obstajala dva
// navigacijska sistema: "Pregled" je imel premium stransko vrstico, ostale
// strani pa temno vrhnjo — z različnima seznamoma postavk, tako da Procesov
// v stranski vrstici sploh ni bilo. Zdaj je vir en sam.
// Vrstni red in skupine sledita potrjeni maketi (design-prototype/, smer A+B):
// najprej "Danes" (kaj je treba narediti), potem delo, potem analiza.
const NAV_POSTAVKE = [
  {
    kljuc: 'pregled', naslov: 'Danes', href: '/admin/',
    ikona: '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h7"/>',
    // Stevilo nalog v vedru "Ukrepaj"; napolni ga napolniZnackoNalog().
    znacka: 'nav-ukrepaj',
  },
  {
    skupina: 'Delo',
    kljuc: 'procesi', naslov: 'Procesi', href: '/admin/procesi.html',
    ikona: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  },
  {
    kljuc: 'podjetja', naslov: 'Podjetja', href: '/admin/podjetja.html',
    ikona: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    // Na strani Danes se pod to postavko izpiše seznam podjetij.
    podseznam: true,
  },
  {
    kljuc: 'questionnaires', naslov: 'Vprašalniki', href: '/admin/questionnaires.html',
    ikona: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',
  },
  {
    skupina: 'Analiza',
    kljuc: 'search', naslov: 'Iskanje', href: '/admin/search.html',
    ikona: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  },
  {
    kljuc: 'insights', naslov: 'Cross-client', href: '/admin/insights.html',
    ikona: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  },
];

// Stare strani so uporabljale druge ključe (npr. 'home' za Podjetja). Da
// klicev po straneh ni treba popravljati, jih preslikamo.
const NAV_VZDEVKI = { home: 'podjetja', kanban: 'podjetja', questionnaires: 'questionnaires' };

function svgIkona(pot, velikost = 20) {
  return `<svg width="${velikost}" height="${velikost}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${pot}</svg>`;
}

// Zgradi HTML stranske vrstice. Vrne niz.
function sidebarHtml(active = '') {
  const aktiven = NAV_VZDEVKI[active] || active;

  const postavke = NAV_POSTAVKE.map(p => {
    const jeAktivna = p.kljuc === aktiven;
    const razred = `sidebar-item${jeAktivna ? ' active' : ''}`;
    const naslovSkupine = p.skupina ? `<div class="sidebar-group">${esc(p.skupina)}</div>` : '';
    const znacka = p.znacka ? `<span class="badge-count" id="${p.znacka}" hidden></span>` : '';

    if (p.podseznam) {
      // Razširljiva postavka: klik odpre/zapre podseznam podjetij.
      // Puščico in podseznam prikažemo samo, kadar ju stran zna napolniti
      // (Pregled) — sicer bi bila to mrtva kontrola.
      return `
        ${naslovSkupine}
        <div>
          <a href="${p.href}" class="${razred}">
            ${svgIkona(p.ikona, 16)}
            <span class="flex-1">${esc(p.naslov)}</span>
            <span id="chev-ovoj" class="hidden">
              <svg id="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400">
                <polyline points="6 9 12 15 18 9"/></svg>
            </span>
          </a>
          <div id="sub" class="mt-1 space-y-0.5"></div>
        </div>`;
    }

    return `
      ${naslovSkupine}
      <a href="${p.href}" class="${razred}">
        ${svgIkona(p.ikona, 16)}
        <span>${esc(p.naslov)}</span>
        ${znacka}
      </a>`;
  }).join('');

  return `
    <div class="flex items-center gap-2.5 mb-4 px-1">
      <div class="brand-mark">a</div>
      <div class="min-w-0">
        <div class="font-semibold leading-tight ellipsis" style="font-size:13px; letter-spacing:-0.01em;">Acenta baza</div>
        <div class="text-muted ellipsis" style="font-size:11px">ai@acenta.si</div>
      </div>
    </div>

    <nav class="space-y-0.5 flex-1">${postavke}</nav>

    <div style="border-top:1px solid var(--hairline); padding-top:10px; font-size:11px" class="text-muted ellipsis" id="nav-noga">Admin</div>`;
}

// Napolni stevec nalog v navigaciji. Tiho odneha, ce ruta ni dosegljiva —
// znacka je pripomocek, ne pogoj za delovanje strani.
async function napolniZnackoNalog() {
  const el = document.getElementById('nav-ukrepaj');
  if (!el) return;
  try {
    const r = await apiFetch('/api/naloge');
    const n = r?.skupno?.ukrepaj ?? 0;
    if (n > 0) { el.textContent = n; el.hidden = false; }
  } catch { /* brez znacke */ }
}

// Drsna vrstica za ozke zaslone, kjer stranske vrstice ni.
function mobilnaVrsticaHtml(active = '') {
  const aktiven = NAV_VZDEVKI[active] || active;
  return NAV_POSTAVKE.map(p => {
    const jeAktivna = p.kljuc === aktiven;
    return `<a href="${p.href}" class="font-medium" style="color:${jeAktivna ? '#5eead4' : '#cbd5e1'}">${esc(p.naslov)}</a>`;
  }).join('');
}

// Poskrbi, da je stranska vrstica na ozkem zaslonu SKRITA in nadomescena z
// drsno vrstico, ter da vsebina stoji v svojem stolpcu.
//
// Klice se za obe vrsti strani: tiste, ki ovojnico ze imajo v HTML
// (index.html, questionnaires.html, procesi.html, proces-seja.html), in
// tiste, ki so prej uporabljale vrhnjo vrstico. Logika je zato na ENEM mestu
// — prej je fiksna w-64 vrstica na 390px prelivala celo stran.
function poskrbiZaOdzivnost(aside, active) {
  aside.classList.add('hidden', 'md:flex', 'shrink-0');

  const vrsta = aside.parentElement;
  if (!vrsta) return;

  // Ce je desni stolpec ze postavljen, samo osvezimo vrstico.
  let desno = vrsta.querySelector(':scope > [data-vsebina]');
  if (desno) {
    const obstojeca = desno.querySelector('[data-mobilna-nav]');
    if (obstojeca) obstojeca.innerHTML = mobilnaVrsticaHtml(active);
    return;
  }

  const vsebina = vrsta.querySelector(':scope > main') || document.querySelector('main');
  if (!vsebina) return;

  desno = document.createElement('div');
  desno.setAttribute('data-vsebina', '');
  desno.className = 'flex-1 min-w-0 flex flex-col';

  const mobilna = document.createElement('div');
  mobilna.setAttribute('data-mobilna-nav', '');
  mobilna.className = 'md:hidden flex gap-4 overflow-x-auto whitespace-nowrap px-4 py-3 text-sm';
  mobilna.style.background = '#101828';
  mobilna.style.color = '#fff';
  mobilna.innerHTML = mobilnaVrsticaHtml(active);

  vsebina.parentNode.insertBefore(desno, vsebina);
  desno.appendChild(mobilna);
  desno.appendChild(vsebina);

  // Nekatere strani imajo na <main> max-w in mx-auto, misljena za celo sirino
  // zaslona. Ob stranski vrstici to pusti prevec praznega prostora na desni.
  vsebina.classList.remove('mx-auto');
  vsebina.classList.add('w-full');
}

// Napolni <aside id="sidebar">. Uporabljajo strani, ki ovojnico ze imajo
// v svojem HTML (index.html, questionnaires.html, procesi.html, proces-seja.html).
function renderSidebar(active = '') {
  zagotoviStile();
  const el = document.getElementById('sidebar');
  if (!el) {
    console.warn('[nav] na strani ni <aside id="sidebar">');
    return;
  }
  el.innerHTML = sidebarHtml(active);
  poskrbiZaOdzivnost(el, active);
  napolniZnackoNalog();
}

// Poskrbi, da so nalozeni skupni stili in pisave. Stare strani nalagajo samo
// Tailwind CDN in brez tega premium razredi (.card, .sidebar-item, .display)
// ne bi imeli stilov.
function zagotoviStile() {
  if (!document.querySelector('link[href="/admin/admin.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/admin/admin.css';
    document.head.appendChild(l);
  }
  if (!document.querySelector('link[href*="fonts.googleapis.com"]')) {
    const f = document.createElement('link');
    f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(f);
  }
}

// Vzdevek zaradi zgodovine: stare strani klicejo renderNav('home') in imajo
// <header id="nav"></header> ter <main>. Namesto vrhnje vrstice jim tu
// SESTAVIMO ovojnico s stransko vrstico — tako dobijo enotno navigacijo,
// ne da bi bilo treba urejati vsako stran posebej.
function renderNav(active = '') {
  zagotoviStile();

  // Strani, ki ovojnico ze imajo v svojem HTML, gredo po isti poti.
  if (document.getElementById('sidebar')) {
    renderSidebar(active);
    return;
  }

  const glava = document.getElementById('nav');
  const vsebina = document.querySelector('main');
  if (!vsebina) {
    console.warn('[nav] stran ni <main>, navigacije ne morem vstaviti');
    return;
  }

  // Sestavimo ovojnico, kakrsno imajo nove strani ze v HTML — potem
  // odzivnost uredi ista funkcija za vse.
  const ovoj = document.createElement('div');
  ovoj.className = 'flex min-h-screen';

  const aside = document.createElement('aside');
  aside.id = 'sidebar';
  aside.className = 'w-52 app-sidebar p-3 flex flex-col';
  aside.innerHTML = sidebarHtml(active);

  vsebina.parentNode.insertBefore(ovoj, vsebina);
  ovoj.appendChild(aside);
  ovoj.appendChild(vsebina);

  poskrbiZaOdzivnost(aside, active);
  napolniZnackoNalog();

  if (glava) glava.remove();
  document.body.classList.remove('bg-gray-50');
}

// Privzeti toggle podseznama. Stran Pregled ima svojo razlicico, ki to
// funkcijo povozi (definirana je pozneje v dokumentu).
function toggleSub() {
  const sub = document.getElementById('sub');
  if (sub) sub.classList.toggle('hidden');
}

// Spinner / loading state helper.
function showLoading(targetId, msg = 'Nalagam...') {
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = `<div class="text-center text-gray-500 py-12">${esc(msg)}</div>`;
}

function showError(targetId, msg) {
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded">${esc(msg)}</div>`;
}
