// AI Business Score: landing <-> quiz on one page (hash #kviz), one POST at the end.
// Question texts come from /ai-business-score/vprasanja.json (no points: scoring is server-side).
// Flow: questions 0..N-1 first, contact step N last. Nothing is sent before the final button,
// so asking for contact at the end changes only the order, not what the server receives.

const $ = (s) => document.querySelector(s);
const KEY = 'abs-kviz-v2';           // v1 stored the old order (contact = -1); do not reuse it
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let st = load() || { korak: 0, kontakt: {}, odg: {} };
function load() { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } }
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch {} }

const { velikost: VELIKOST, vprasanja: VPRASANJA } = await fetch('/ai-business-score/vprasanja.json').then(r => r.json());
const N = VPRASANJA.length;
const KONTAKT = N;
if (!(st.korak >= 0 && st.korak <= KONTAKT)) st.korak = 0;

// Section labels for the progress bar. Display only: scoring never sees them. A question id that
// is not listed simply joins the previous section, so adding a question cannot break the bar.
const SKLOP = {
  panoga: 'O podjetju', vloga: 'O podjetju',
  uporaba: 'AI danes', sistematicnost: 'AI danes', odgovorna_oseba: 'AI danes', razumevanje: 'AI danes', pravila: 'AI danes',
  izguba_casa: 'Čas in stroški', stroski: 'Čas in stroški', potencial: 'Čas in stroški',
  odziv: 'Procesi', nabavne_cene: 'Procesi',
  ovira: 'Naslednji korak', hitrost: 'Naslednji korak', pomoc: 'Naslednji korak', interpretacija: 'Naslednji korak',
};
const imeSklopa = [];
VPRASANJA.forEach((q, i) => { imeSklopa[i] = SKLOP[q.id] || imeSklopa[i - 1] || ''; });
const segmenti = [];                 // consecutive runs: { ime, od, n }
imeSklopa.forEach((ime, i) => {
  const zadnji = segmenti[segmenti.length - 1];
  if (zadnji && zadnji.ime === ime) zadnji.n++; else segmenti.push({ ime, od: i, n: 1 });
});
segmenti.push({ ime: 'Poročilo', od: KONTAKT, n: 1 });
$('#qprog').replaceChildren(...segmenti.map(s => {
  const d = document.createElement('div'); d.className = 'seg'; d.style.setProperty('--n', s.n);
  d.appendChild(document.createElement('i')); return d;
}));
function paintProgress(k) {
  $('#qprog').querySelectorAll('.seg').forEach((el, i) => {
    const s = segmenti[i];
    el.style.setProperty('--p', Math.min(Math.max(k - s.od + 1, 0), s.n) / s.n);
  });
}

// ── views ──
function show(v) {
  $('#v-landing').hidden = v !== 'landing';
  $('#v-kviz').hidden = v !== 'kviz';
  window.scrollTo(0, 0);
}
function route() {
  if (location.hash === '#kviz') { show('kviz'); zadnjiKorak = null; renderQuiz(); } else show('landing');
}
window.addEventListener('hashchange', route);
document.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => { location.hash = 'kviz'; }));

// ── contact step ──
const seg = $('#velikost');
for (const v of VELIKOST) {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = v.text; b.dataset.id = v.id;
  b.onclick = () => { st.kontakt.velikost = v.id; save(); paintSeg(); $('#fld-velikost').classList.remove('err'); };
  seg.appendChild(b);
}
function paintSeg() {
  seg.querySelectorAll('button').forEach(b => {
    const on = b.dataset.id === st.kontakt.velikost;
    b.classList.toggle('sel', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
const POLJA = ['ime', 'priimek', 'email', 'telefon', 'podjetje'];
for (const id of POLJA) $('#' + id).addEventListener('input', e => { st.kontakt[id] = e.target.value; save(); e.target.parentElement.classList.remove('err'); });
$('#soglasje').addEventListener('change', e => { st.kontakt.soglasje = e.target.checked; save(); $('#c1').classList.remove('err'); });
$('#marketing').addEventListener('change', e => { st.kontakt.marketing = e.target.checked; save(); });

function preveriKontakt() {
  let ok = true, prvo = null;
  for (const id of POLJA) {
    const v = (st.kontakt[id] || '').trim();
    const bad = !v || (id === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) || (id === 'telefon' && v.replace(/\D/g, '').length < 8);
    $('#' + id).parentElement.classList.toggle('err', bad);
    if (bad) { ok = false; prvo ||= $('#' + id); }
  }
  if (!st.kontakt.velikost) { $('#fld-velikost').classList.add('err'); ok = false; prvo ||= seg.querySelector('button'); }
  if (!st.kontakt.soglasje) { $('#c1').classList.add('err'); ok = false; prvo ||= $('#soglasje'); }
  prvo?.focus();
  return ok;
}

// ── questions ──
const CRKE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let zadnjiKorak = null;
function napaka(msg) { const e = $('#qerr'); e.textContent = msg || ''; e.hidden = !msg; }

function renderQuiz() {
  const k = st.korak, kontakt = k === KONTAKT;
  const nov = k !== zadnjiKorak;
  napaka('');
  $('#step-kontakt').hidden = !kontakt;
  $('#step-q').hidden = kontakt;
  $('#nazaj').style.visibility = k === 0 ? 'hidden' : 'visible';
  paintProgress(k);
  $('#qcount').textContent = kontakt ? 'Zadnji korak' : `Vprašanje ${k + 1} od ${N}`;
  const btn = $('#naprej');

  if (kontakt) {
    for (const id of POLJA) $('#' + id).value = st.kontakt[id] || '';
    $('#soglasje').checked = !!st.kontakt.soglasje; $('#marketing').checked = !!st.kontakt.marketing;
    paintSeg();
    $('#qstage').classList.remove('wide');
    btn.textContent = 'Pokaži moje poročilo'; btn.disabled = false; btn.hidden = false;
    $('#qkeys').textContent = '';
    if (nov) vstop($('#step-kontakt'), $('#ktitle'));
    zadnjiKorak = k;
    return;
  }

  const q = VPRASANJA[k];
  $('#qsklop').textContent = imeSklopa[k];
  $('#qtitle').textContent = q.text;
  $('#qhint').textContent = q.tip === 'vec' ? `Izberite največ ${q.max}.` : '';
  const box = $('#qopts');
  // Keep a keyboard user's place on re-render. After a mouse click focus is dropped on purpose,
  // otherwise Enter would re-press the option (toggling it off) instead of going to "Naprej".
  const a = document.activeElement;
  const fokus = !nov && a?.matches(':focus-visible') ? [...box.children].indexOf(a) : -1;
  box.innerHTML = '';
  const dolgo = q.moznosti.length > 6;
  box.classList.toggle('long', dolgo); $('#qstage').classList.toggle('wide', dolgo);
  const cur = st.odg[q.id];
  const izbrane = q.tip === 'vec' ? (cur || []) : (cur ? [cur] : []);
  q.moznosti.forEach((o, i) => {
    const b = document.createElement('button');
    const on = izbrane.includes(o.id);
    b.type = 'button'; b.className = 'opt' + (q.tip === 'vec' ? ' multi' : '') + (on ? ' sel' : '');
    if (q.tip === 'vec' && izbrane.length >= q.max && !on) b.classList.add('off');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = '<span class="mk" aria-hidden="true"></span><span class="tx"></span><kbd class="key" aria-hidden="true"></kbd>';
    b.querySelector('.tx').textContent = o.text;
    b.querySelector('.key').textContent = CRKE[i] || '';
    b.onclick = () => izberi(q, o.id);
    box.appendChild(b);
  });
  if (fokus >= 0) box.children[fokus]?.focus();
  btn.textContent = 'Naprej';
  btn.hidden = q.tip !== 'vec' && !cur;
  btn.disabled = q.tip === 'vec' ? izbrane.length === 0 : !cur;
  $('#qkeys').textContent = q.tip === 'vec' ? 'Črka izbere, Enter nadaljuje' : 'Izberite s črko';
  if (nov) vstop($('#step-q'), $('#qtitle'));
  zadnjiKorak = k;
}

// New step: short rise-in, focus the heading for screen readers, back to the top on phones.
function vstop(el, naslov) {
  window.scrollTo(0, 0);
  naslov.focus({ preventScroll: true });
  if (reduce) return;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
}

function izberi(q, id) {
  if (q.tip === 'vec') {
    let a = [...(st.odg[q.id] || [])];
    const nevtralno = q.moznosti.find(m => m.id === id)?.nevtralno;
    if (a.includes(id)) a = a.filter(x => x !== id);
    else if (nevtralno) a = [id];                       // "Ne vem" clears the others
    else { a = a.filter(x => !q.moznosti.find(m => m.id === x)?.nevtralno); if (a.length < q.max) a.push(id); }
    st.odg[q.id] = a; save(); renderQuiz();
  } else {
    st.odg[q.id] = id; save(); renderQuiz();
    const tu = st.korak;
    setTimeout(() => { if (st.korak === tu) { st.korak++; save(); renderQuiz(); } }, 260);
  }
}

const NAPAKE = {
  too_many_requests: 'Iz tega omrežja je bilo v kratkem času oddanih preveč ocen. Poskusite znova čez nekaj minut.',
  invalid_answer: 'Eno od vprašanj nima veljavnega odgovora. Preverite odgovore in poskusite znova.',
};
async function oddaj() {
  const btn = $('#naprej');
  btn.disabled = true; btn.textContent = 'Pripravljamo poročilo …';
  try {
    const res = await fetch('/f/ai-business-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...Object.fromEntries(POLJA.map(id => [id, (st.kontakt[id] || '').trim()])),
        velikost: st.kontakt.velikost,
        gdpr_consent: !!st.kontakt.soglasje,
        marketing_consent: !!st.kontakt.marketing,
        company_url: $('#hp_sidro').value,
        odgovori: st.odg,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.reportUrl) { sessionStorage.removeItem(KEY); location.href = d.reportUrl; return; }
    if (res.status === 400 && d.field && POLJA.concat('velikost').includes(d.field)) {
      preveriKontakt();
      $('#' + (d.field === 'velikost' ? 'fld-velikost' : d.field)).closest('.fld')?.classList.add('err');
      btn.disabled = false; btn.textContent = 'Pokaži moje poročilo';
      return;
    }
    if (res.status === 400 && d.field) {
      const i = VPRASANJA.findIndex(q => q.id === d.field);
      if (i >= 0) { st.korak = i; save(); renderQuiz(); }
    }
    napaka(NAPAKE[d.error] || 'Oddaja ni uspela. Poskusite znova ali nas pokličite na 041 669 785.');
  } catch {
    napaka('Povezava ni uspela. Preverite internet in poskusite znova.');
  }
  if (st.korak === KONTAKT) { btn.disabled = false; btn.textContent = 'Pokaži moje poročilo'; }
}

$('#naprej').onclick = () => {
  if (st.korak < KONTAKT) { st.korak++; save(); renderQuiz(); return; }
  if (preveriKontakt()) oddaj();
};
$('#nazaj').onclick = () => { if (st.korak > 0) { st.korak--; save(); renderQuiz(); } };

// Keyboard: a letter picks an option, Enter goes on. Inputs keep their own keys (Enter submits).
document.addEventListener('keydown', e => {
  if ($('#v-kviz').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const btn = $('#naprej');
  if (st.korak === KONTAKT) {
    if (e.key === 'Enter' && e.target.matches?.('#fkontakt input:not([type=checkbox])')) { e.preventDefault(); if (!btn.disabled) btn.click(); }
    return;
  }
  if (e.target.matches?.('input, textarea')) return;
  if (e.key === 'Enter') {
    if (e.target.closest?.('button')) return;           // native click on a focused button
    if (!btn.hidden && !btn.disabled) { e.preventDefault(); btn.click(); }
    return;
  }
  const i = e.key.length === 1 ? CRKE.indexOf(e.key.toUpperCase()) : -1;
  const q = VPRASANJA[st.korak];
  if (i >= 0 && q && i < q.moznosti.length) {
    e.preventDefault();
    const b = $('#qopts').children[i];
    if (!b.classList.contains('off')) izberi(q, q.moznosti[i].id);
  }
});

route();
