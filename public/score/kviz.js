// AI Business Score: landing <-> quiz on one page (hash #kviz), one POST at the end.
// Question texts come from /ai-business-score/vprasanja.json (no points: scoring is server-side).
// Behaviour mirrors the approved prototype (design-prototype/ai-business-score/index.html).

const $ = (s) => document.querySelector(s);
const KEY = 'abs-kviz-v1';
let st = load() || { korak: -1, kontakt: {}, odg: {} };   // korak -1 = contact step
function load() { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } }
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch {} }

const { velikost: VELIKOST, vprasanja: VPRASANJA } = await fetch('/ai-business-score/vprasanja.json').then(r => r.json());
const N = VPRASANJA.length;
if (st.korak >= N) st.korak = N - 1;

// ── views ──
function show(v) {
  $('#v-landing').hidden = v !== 'landing';
  $('#v-kviz').hidden = v !== 'kviz';
  window.scrollTo(0, 0);
}
function route() {
  if (location.hash === '#kviz') { show('kviz'); renderQuiz(); } else show('landing');
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
function paintSeg() { seg.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.id === st.kontakt.velikost)); }
const POLJA = ['ime', 'priimek', 'email', 'telefon', 'podjetje'];
for (const id of POLJA) $('#' + id).addEventListener('input', e => { st.kontakt[id] = e.target.value; save(); e.target.parentElement.classList.remove('err'); });
$('#soglasje').addEventListener('change', e => { st.kontakt.soglasje = e.target.checked; save(); $('#c1').classList.remove('err'); });
$('#marketing').addEventListener('change', e => { st.kontakt.marketing = e.target.checked; save(); });

function preveriKontakt() {
  let ok = true;
  for (const id of POLJA) {
    const v = (st.kontakt[id] || '').trim();
    const bad = !v || (id === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) || (id === 'telefon' && v.replace(/\D/g, '').length < 8);
    $('#' + id).parentElement.classList.toggle('err', bad); if (bad) ok = false;
  }
  if (!st.kontakt.velikost) { $('#fld-velikost').classList.add('err'); ok = false; }
  if (!st.kontakt.soglasje) { $('#c1').classList.add('err'); ok = false; }
  return ok;
}

// ── questions ──
function napaka(msg) { const e = $('#qerr'); e.textContent = msg || ''; e.hidden = !msg; }
function renderQuiz() {
  const k = st.korak;
  napaka('');
  $('#step-kontakt').hidden = k !== -1;
  $('#step-q').hidden = k === -1;
  $('#nazaj').style.visibility = k === -1 ? 'hidden' : 'visible';
  $('#qprog').style.width = `${((k + 1) / (N + 1)) * 100}%`;
  $('#qcount').textContent = k === -1 ? 'Vaši podatki' : `Vprašanje ${k + 1} od ${N}`;
  if (k === -1) {
    for (const id of POLJA) $('#' + id).value = st.kontakt[id] || '';
    $('#soglasje').checked = !!st.kontakt.soglasje; $('#marketing').checked = !!st.kontakt.marketing;
    paintSeg(); $('#naprej').textContent = 'Začni oceno'; $('#naprej').disabled = false; $('#naprej').hidden = false;
    return;
  }
  const q = VPRASANJA[k];
  $('#qtitle').textContent = q.text;
  $('#qhint').textContent = q.tip === 'vec' ? `Izberite največ ${q.max}.` : '';
  const box = $('#qopts'); box.innerHTML = '';
  const dolgo = q.moznosti.length > 6;
  box.classList.toggle('long', dolgo); $('#step-q').classList.toggle('wide', dolgo);
  const cur = st.odg[q.id];
  const izbrane = q.tip === 'vec' ? (cur || []) : (cur ? [cur] : []);
  for (const o of q.moznosti) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'opt' + (q.tip === 'vec' ? ' multi' : '') + (izbrane.includes(o.id) ? ' sel' : '');
    if (q.tip === 'vec' && izbrane.length >= q.max && !izbrane.includes(o.id)) b.classList.add('off');
    b.setAttribute('aria-pressed', izbrane.includes(o.id) ? 'true' : 'false');
    b.innerHTML = '<span class="mk"></span><span></span>'; b.lastChild.textContent = o.text;
    b.onclick = () => izberi(q, o.id);
    box.appendChild(b);
  }
  const zadnje = k === N - 1;
  $('#naprej').hidden = q.tip !== 'vec' && !zadnje && !cur;
  $('#naprej').textContent = zadnje ? 'Pokaži rezultat' : 'Naprej';
  $('#naprej').disabled = q.tip === 'vec' ? izbrane.length === 0 : !cur;
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
    if (st.korak < N - 1) setTimeout(() => { st.korak++; save(); renderQuiz(); }, 260);
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
      st.korak = -1; save(); renderQuiz(); preveriKontakt();
      $('#' + (d.field === 'velikost' ? 'fld-velikost' : d.field)).closest('.fld')?.classList.add('err');
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
  btn.disabled = false; btn.textContent = 'Pokaži rezultat';
}

$('#naprej').onclick = () => {
  if (st.korak === -1) { if (!preveriKontakt()) return; st.korak = 0; save(); renderQuiz(); return; }
  if (st.korak < N - 1) { st.korak++; save(); renderQuiz(); return; }
  oddaj();
};
$('#nazaj').onclick = () => { if (st.korak > -1) { st.korak--; save(); renderQuiz(); } };

route();
