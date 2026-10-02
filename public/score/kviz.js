// AI Business Score: landing <-> quiz on one page (hash #kviz), one POST at the end.
// Question texts come from /ai-business-score/vprasanja.json (no points: scoring is server-side).
// Flow: the visible questions first, the contact step last. Nothing is sent before the final button,
// so asking for contact at the end changes only the order, not what the server receives.

import { vidnaVprasanja } from './razvejitev.js';

const $ = (s) => document.querySelector(s);
const KEY = 'abs-kviz-v3';           // v2 stored the v1 question set (29. 9.); do not reuse it
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let st = load() || { korak: 0, kontakt: {}, odg: {} };
function load() { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } }
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch {} }

const JS = await fetch('/ai-business-score/vprasanja.json').then(r => r.json());
const { velikost: VELIKOST, vprasanja: VPRASANJA } = JS;
// v2: after "one process in 90 days" the respondent gets only the follow-up block of that area.
// The same rule (razvejitev.js) decides on the server which answers are required.
const PODROCJA = JS.podrocja || [];
const NAZIV = JS.podrocjeNaziv || {};
const vidna = () => vidnaVprasanja(VPRASANJA, st.odg, PODROCJA);
const kontaktKorak = () => vidna().length;     // the contact step comes after the last question
// Before the area is picked, the counter and the bar already include its 3 questions.
const BLOK = 3;
const cakaPodrocje = () => VPRASANJA.some(q => q.id === 'proces90') && !st.odg.proces90;
if (!(st.korak >= 0 && st.korak <= kontaktKorak())) st.korak = 0;

// Section labels for the progress bar. Display only: scoring never sees them. A question id that
// is not listed simply joins the previous section, so adding a question cannot break the bar.
// Follow-up questions are labelled with their area's name.
const SKLOP = {
  uporaba: 'Uporaba AI', naloge: 'Uporaba AI', sistematicnost: 'Uporaba AI', odgovorna_oseba: 'Uporaba AI',
  razumevanje: 'Znanje in pravila', pravila: 'Znanje in pravila', ovira: 'Znanje in pravila',
  izguba_casa: 'Procesi', stroski: 'Procesi', potencial: 'Procesi', proces90: 'Procesi',
  odziv: 'Procesi', nabavne_cene: 'Procesi',
  cilj: 'Naslednji korak', hitrost: 'Naslednji korak', pomoc: 'Naslednji korak', interpretacija: 'Naslednji korak',
  panoga: 'O podjetju', vloga: 'O podjetju',
};
let segmenti = [], imeSklopa = [], polno = [], podpis = '';
function zgradiNapredek() {
  const vid = vidna();
  const p = vid.map(q => q.id).join() + '|' + cakaPodrocje();
  if (p === podpis) return;
  podpis = p;
  imeSklopa = [];
  vid.forEach((q, i) => { imeSklopa[i] = (q.podrocje && NAZIV[q.podrocje]) || SKLOP[q.id] || imeSklopa[i - 1] || ''; });
  segmenti = [];                     // consecutive runs: { ime, od, n }
  imeSklopa.forEach((ime, i) => {
    const zadnji = segmenti[segmenti.length - 1];
    if (zadnji && zadnji.ime === ime) zadnji.n++; else segmenti.push({ ime, od: i, n: 1 });
  });
  // Area not picked yet: a placeholder section right after "Procesi", later sections shift by 3.
  if (cakaPodrocje()) {
    const i90 = vid.findIndex(q => q.id === 'proces90');
    const za = segmenti.findIndex(s => s.od > i90);
    segmenti.forEach(s => { if (s.od > i90) s.od += BLOK; });
    segmenti.splice(za < 0 ? segmenti.length : za, 0, { ime: 'Vaše področje', od: i90 + 1, n: BLOK });
  }
  segmenti.push({ ime: 'Poročilo', od: skupajVprasanj(), n: 1 });
  polno = [];
  $('#qprog').replaceChildren(...segmenti.map(s => {
    const d = document.createElement('div'); d.className = 'seg'; d.style.setProperty('--n', s.n);
    d.appendChild(document.createElement('i')); return d;
  }));
}
const skupajVprasanj = () => vidna().length + (cakaPodrocje() ? BLOK : 0);
// Answers of a follow-up block the respondent no longer sees (area changed) are dropped.
function pocistiSkrite() {
  const vid = new Set(vidna().map(q => q.id));
  for (const q of VPRASANJA) if (q.podrocje && !vid.has(q.id)) delete st.odg[q.id];
}
function paintProgress(k) {
  $('#qprog').querySelectorAll('.seg').forEach((el, i) => {
    const s = segmenti[i];
    const p = Math.min(Math.max(k - s.od + 1, 0), s.n) / s.n;
    el.style.setProperty('--p', p);
    // A section that just filled up flashes once (only when moving forward into completion).
    if (p === 1 && polno[i] === false && !reduce) { el.classList.remove('done'); void el.offsetWidth; el.classList.add('done'); }
    polno[i] = p === 1;
  });
}

// ── views ──
function show(v) {
  $('#v-landing').hidden = v !== 'landing';
  $('#v-kviz').hidden = v !== 'kviz';
  if (v === 'landing') document.querySelectorAll('[data-hq-opt].sel').forEach(b => b.classList.remove('sel'));
  window.scrollTo(0, 0);
}
function route() {
  if (location.hash === '#kviz') { show('kviz'); zadnjiKorak = null; renderQuiz(); } else show('landing');
}
window.addEventListener('hashchange', route);

// Landing -> quiz. From the hero question the card morphs into the quiz step (View Transitions);
// from any other button only the page cross-fades, so nothing flies in from off-screen.
const heroQ = $('[data-hq]');
function vKviz(izHero) {
  if (heroQ && !izHero) heroQ.style.viewTransitionName = 'none';
  const zamenjaj = () => { history.pushState(null, '', '#kviz'); show('kviz'); zadnjiKorak = null; renderQuiz(); };
  if (document.startViewTransition && !reduce) {
    document.startViewTransition(zamenjaj).finished.finally(() => { if (heroQ) heroQ.style.viewTransitionName = ''; });
  } else { zamenjaj(); if (heroQ) heroQ.style.viewTransitionName = ''; }
}
document.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', () => vKviz(false)));

// The hero shows question 1 itself: texts refresh from vprasanja.json, a click stores the answer
// and opens the quiz on the next question.
const PRVO = VPRASANJA.findIndex(q => q.id === 'uporaba');
const heroOpts = [...document.querySelectorAll('[data-hq-opt]')];
if (PRVO >= 0) for (const b of heroOpts) {
  const o = VPRASANJA[PRVO].moznosti.find(m => m.id === b.dataset.hqOpt);
  if (!o) { b.hidden = true; continue; }
  b.querySelector('.tx').textContent = o.text;
  b.addEventListener('click', () => {
    b.classList.add('sel');
    // Someone who already went further (back button, then the hero again) keeps their place.
    st.odg.uporaba = o.id; st.korak = Math.min(Math.max(st.korak, PRVO + 1), kontaktKorak()); save();
    // Only the hero card morphs; the closing copy of the question just cross-fades.
    setTimeout(() => vKviz(!!b.closest('[data-hq]')), reduce ? 0 : 170);
  });
}

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
  zgradiNapredek();
  const vid = vidna();
  if (st.korak > vid.length) st.korak = vid.length;
  const k = st.korak, kontakt = k === vid.length;
  const nov = k !== zadnjiKorak;
  const nazaj = zadnjiKorak !== null && k < zadnjiKorak;
  napaka('');
  $('#step-kontakt').hidden = !kontakt;
  $('#step-q').hidden = kontakt;
  $('#nazaj').style.visibility = k === 0 ? 'hidden' : 'visible';
  paintProgress(k);
  $('#qcount').textContent = kontakt ? 'Zadnji korak' : `Vprašanje ${k + 1} od ${skupajVprasanj()}`;
  const btn = $('#naprej');

  if (kontakt) {
    for (const id of POLJA) $('#' + id).value = st.kontakt[id] || '';
    $('#soglasje').checked = !!st.kontakt.soglasje; $('#marketing').checked = !!st.kontakt.marketing;
    paintSeg();
    $('#qstage').classList.remove('wide');
    btn.textContent = 'Pokaži moje poročilo'; btn.disabled = false; btn.hidden = false;
    $('#qkeys').textContent = '';
    if (nov) vstop($('#step-kontakt'), $('#ktitle'), nazaj);
    zadnjiKorak = k;
    return;
  }

  const q = vid[k];
  $('#qsklop').textContent = imeSklopa[k];
  $('#qtitle').textContent = q.text;
  $('#qhint').textContent = q.tip === 'vec' ? `Izberite največ ${q.max}.` : '';
  const box = $('#qopts');
  const cur = st.odg[q.id];
  const izbrane = q.tip === 'vec' ? (cur || []) : (cur ? [cur] : []);
  // Buttons are built once per question. A pick only updates them in place: rebuilding them under
  // the still-active .enter class replayed the entrance on every click, so all options blinked out
  // and staggered back in (on the 12-option "do 3" question at every click; seen 2. 10. 2026).
  if (nov || box.dataset.q !== q.id) {
    box.innerHTML = '';
    box.dataset.q = q.id;
    const dolgo = q.moznosti.length > 6;
    box.classList.toggle('long', dolgo); $('#qstage').classList.toggle('wide', dolgo);
    q.moznosti.forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'opt' + (q.tip === 'vec' ? ' multi' : '');
      b.style.setProperty('--i', Math.min(i, 12));           // entrance stagger
      b.innerHTML = '<span class="mk" aria-hidden="true"></span><span class="tx"></span><kbd class="key" aria-hidden="true"></kbd>';
      b.querySelector('.tx').textContent = o.text;
      b.querySelector('.key').textContent = CRKE[i] || '';
      b.onclick = () => izberi(q, o.id);
      box.appendChild(b);
    });
  } else {
    // After a mouse click focus is dropped on purpose, otherwise Enter would re-press the option
    // (toggling it off) instead of going to "Naprej". A keyboard user keeps their place.
    const a = document.activeElement;
    if (box.contains(a) && !a.matches(':focus-visible')) a.blur();
  }
  [...box.children].forEach((b, i) => {
    const on = izbrane.includes(q.moznosti[i].id);
    b.classList.toggle('sel', on);
    b.classList.toggle('off', q.tip === 'vec' && izbrane.length >= q.max && !on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  btn.textContent = 'Naprej';
  btn.hidden = q.tip !== 'vec' && !cur;
  btn.disabled = q.tip === 'vec' ? izbrane.length === 0 : !cur;
  $('#qkeys').textContent = q.tip === 'vec' ? 'Črka izbere, Enter nadaljuje' : 'Izberite s črko';
  if (nov) vstop($('#step-q'), $('#qtitle'), nazaj);
  zadnjiKorak = k;
}

// New step: rise-in (from above when going back), options stagger in, focus the heading for
// screen readers, back to the top on phones.
function vstop(el, naslov, nazaj) {
  window.scrollTo(0, 0);
  naslov.focus({ preventScroll: true });
  // No hover tint until the mouse actually moves: otherwise the option that lands under a still
  // pointer looks pre-selected (see score.css). A real move is >3 px from the first reading.
  el.classList.add('miruj');
  let x0 = null, y0 = null;
  const premik = (e) => {
    if (x0 === null) { x0 = e.clientX; y0 = e.clientY; return; }
    if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 3) { el.classList.remove('miruj'); removeEventListener('pointermove', premik); }
  };
  removeEventListener('pointermove', vstop.premik || (() => {}));
  vstop.premik = premik;
  addEventListener('pointermove', premik);
  if (reduce) return;
  el.classList.remove('enter', 'nazaj'); void el.offsetWidth; el.classList.add('enter');
  if (nazaj) el.classList.add('nazaj');
}

function izberi(q, id) {
  if (q.tip === 'vec') {
    let a = [...(st.odg[q.id] || [])];
    const nevtralno = q.moznosti.find(m => m.id === id)?.nevtralno;
    if (a.includes(id)) a = a.filter(x => x !== id);
    else if (nevtralno) a = [id];                       // "Ne vem" clears the others
    else { a = a.filter(x => !q.moznosti.find(m => m.id === x)?.nevtralno); if (a.length < q.max) a.push(id); }
    st.odg[q.id] = a; pocistiSkrite(); save(); renderQuiz();
  } else {
    st.odg[q.id] = id; pocistiSkrite(); save(); renderQuiz();
    const tu = st.korak;
    setTimeout(() => { if (st.korak === tu) { st.korak++; save(); renderQuiz(); } }, 260);
  }
}

const NAPAKE = {
  too_many_requests: 'Iz tega omrežja je bilo v kratkem času oddanih preveč ocen. Poskusite znova čez nekaj minut.',
  invalid_answer: 'Eno od vprašanj nima veljavnega odgovora. Preverite odgovore in poskusite znova.',
};
// "Računamo vašo oceno": the four parts of the score tick off while the server scores. Shown
// for at least ~2 s so the result lands as a result, not a page flash. Honest: the server
// really computes these four things for this submission.
function racunam() {
  const el = $('#qcalc'), lis = [...$('#qcalc-steps').children], pct = $('#qcalc-pct');
  lis.forEach(l => l.classList.remove('on')); pct.textContent = '0';
  el.hidden = false; document.body.classList.add('calc');
  const trajanje = reduce ? 500 : 2100, t0 = performance.now();
  let raf = 0;
  const tik = (t) => {
    const p = Math.min((t - t0) / trajanje, 1);
    pct.textContent = Math.round(p * 100);
    lis.forEach((l, i) => l.classList.toggle('on', p >= (i + 1) / (lis.length + .6)));
    if (p < 1) raf = requestAnimationFrame(tik);
  };
  raf = requestAnimationFrame(tik);
  return {
    konec: new Promise(r => setTimeout(r, trajanje + 150)),
    skrij: () => { cancelAnimationFrame(raf); el.hidden = true; document.body.classList.remove('calc'); },
  };
}

async function oddaj() {
  const btn = $('#naprej');
  btn.disabled = true; btn.textContent = 'Pripravljamo poročilo …';
  const calc = racunam();
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
        // Only what the respondent was shown (an abandoned follow-up block is not sent).
        odgovori: Object.fromEntries(vidna().filter(q => st.odg[q.id] !== undefined).map(q => [q.id, st.odg[q.id]])),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.reportUrl) { sessionStorage.removeItem(KEY); await calc.konec; location.href = d.reportUrl; return; }
    calc.skrij();
    if (res.status === 400 && d.field && POLJA.concat('velikost').includes(d.field)) {
      preveriKontakt();
      $('#' + (d.field === 'velikost' ? 'fld-velikost' : d.field)).closest('.fld')?.classList.add('err');
      btn.disabled = false; btn.textContent = 'Pokaži moje poročilo';
      return;
    }
    if (res.status === 400 && d.field) {
      const i = vidna().findIndex(q => q.id === d.field);
      if (i >= 0) { st.korak = i; save(); renderQuiz(); }
    }
    napaka(NAPAKE[d.error] || 'Oddaja ni uspela. Poskusite znova ali nas pokličite na 031 615 921.');
  } catch {
    calc.skrij();
    napaka('Povezava ni uspela. Preverite internet in poskusite znova.');
  }
  if (st.korak === kontaktKorak()) { btn.disabled = false; btn.textContent = 'Pokaži moje poročilo'; }
}

$('#naprej').onclick = () => {
  if (st.korak < kontaktKorak()) { st.korak++; save(); renderQuiz(); return; }
  if (preveriKontakt()) oddaj();
};
$('#nazaj').onclick = () => { if (st.korak > 0) { st.korak--; save(); renderQuiz(); } };

// Keyboard: a letter picks an option, Enter goes on. Inputs keep their own keys (Enter submits).
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Landing: A–E answer the hero question while it is on screen (its keys are shown on the options).
  if ($('#v-kviz').hidden) {
    if (!heroQ || e.target.matches?.('input, textarea') || e.key.length !== 1) return;
    const r = heroQ.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    const b = heroOpts.filter(x => !x.hidden && x.closest('[data-hq]'))[CRKE.indexOf(e.key.toUpperCase())];
    if (b) { e.preventDefault(); b.click(); }
    return;
  }
  if (!$('#qcalc').hidden) return;
  const btn = $('#naprej');
  if (st.korak === kontaktKorak()) {
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
  const q = vidna()[st.korak];
  if (i >= 0 && q && i < q.moznosti.length) {
    e.preventDefault();
    const b = $('#qopts').children[i];
    if (!b.classList.contains('off')) izberi(q, q.moznosti[i].id);
  }
});

route();
