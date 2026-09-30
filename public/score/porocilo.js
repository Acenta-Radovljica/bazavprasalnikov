// AI Business Score report page (/r/:token). Data comes from /r/:token/podatki, which never
// contains raw answers or internal lead data. Layout and instrument mirror the landing (landing.css).

const $ = (s) => document.querySelector(s);
const token = location.pathname.split('/').filter(Boolean)[1] || '';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const DIM = [
  ['zrelost', 'AI zrelost', 'Kako sistematično AI uporabljate danes.'],
  ['potencial', 'Potencial v procesih', 'Koliko časa in stroškov bi lahko prevzel AI.'],
  ['pripravljenost', 'Pripravljenost za korak', 'Kako hitro želite začeti.'],
];
// Same order as STOPNJE in src/score/vprasanja-v1.js; the ladder in porocilo.html lists these names.
const STOPNJE = ['AI začetnik', 'AI raziskovalec', 'AI uporabnik', 'AI pospeševalec', 'AI-first kandidat'];
const TICKS = 20;
const OBSEG = 540.35;                 // 2πr for r = 86 in the dial SVG

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function li(ul, arr) { ul.replaceChildren(...arr.map(t => el('li', '', t))); }

function napaka(msg) {
  $('#v-porocilo').hidden = true;
  const e = $('#r-napaka'); e.textContent = msg; e.hidden = false;
}

// Count up once, ease-out; the final number is always written, also under reduced motion.
function stej(node, cilj) {
  if (reduce) { node.textContent = cilj; return; }
  const t0 = performance.now(), trajanje = 1400;
  const korak = (t) => {
    const p = Math.min((t - t0) / trajanje, 1);
    node.textContent = Math.round(cilj * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(korak);
  };
  requestAnimationFrame(korak);
}

const res = await fetch(`/r/${encodeURIComponent(token)}/podatki`).catch(() => null);
if (!res || res.status === 404) napaka('Poročila ne najdemo. Preverite povezavo ali nas pokličite na 041 669 785.');
else if (res.status === 410) napaka('To poročilo ni več na voljo. Za novo oceno nas pokličite na 041 669 785.');
else if (!res.ok) napaka('Poročila trenutno ne moremo prikazati. Poskusite znova čez nekaj minut.');
else {
  const d = await res.json();
  const root = $('#v-porocilo');
  document.title = `AI Business Score za ${d.podjetje || 'vaše podjetje'} | Acenta`;
  $('#r-naslov').textContent = `AI Business Score za ${d.podjetje || 'vaše podjetje'}`;
  // No copy is e-mailed until MailerLite is configured, so do not promise one here.
  $('#r-meta').textContent = `Izpolnjeno ${d.datum}. Povezavo si shranite, da se lahko k poročilu vrnete.`;
  $('#r-podrocje').textContent = d.proces ? d.proces.naziv : '';
  $('#r-levelh').textContent = d.stopnja.naziv;
  $('#r-levelp').textContent = d.stopnja.opis;

  $('#r-bars').replaceChildren(...DIM.map(([id, naziv, zakaj]) => {
    const v = d.dimenzije[id];
    const row = el('div');
    const dt = el('dt', '', naziv); dt.append(el('small', '', zakaj));
    const dd = el('dd');
    const ticks = el('span', 'ticks');
    for (let i = 0; i < TICKS; i++) { const t = el('i'); t.style.setProperty('--t', i); t.dataset.on = i < Math.round(v / (100 / TICKS)) ? '1' : ''; ticks.append(t); }
    dd.append(ticks, el('b', '', String(v)));
    dd.setAttribute('aria-label', `${v} od 100`);
    row.append(dt, dd);
    return row;
  }));

  const stopnja = STOPNJE.indexOf(d.stopnja.naziv);
  [...$('#r-levels').children].forEach((n, i) => {
    n.classList.toggle('on', i === stopnja);
    if (i === stopnja) n.setAttribute('aria-current', 'step');
  });

  const rec = el('div', 'rec');
  rec.append(el('small', '', 'Priporočen prvi korak'), document.createTextNode(d.proces ? d.proces.priporocilo : d.stopnja.priporocilo));
  $('#r-opp').replaceChildren(
    el('p', 'eyebrow', 'Največja priložnost'),
    el('h3', 'opp-name', d.proces ? d.proces.naziv : 'Še ni jasna'),
    el('p', '', d.proces
      ? 'Na tem področju ste označili največ izgubljenega časa ali nepotrebnih stroškov.'
      : 'Iz odgovorov še ne izstopa en sam proces. To je pogosto pri podjetjih, ki z AI šele začenjajo.'),
    rec,
  );

  $('#r-odstavek').textContent = d.besedilo.odstavek;
  li($('#r-dobro'), d.besedilo.dobro);
  li($('#r-zatika'), d.besedilo.zatika);
  li($('#r-prilo'), d.besedilo.priloznosti);

  // Booking button only when a real link is configured (no dead controls); otherwise the
  // phone number becomes the primary action.
  if (d.rezervacija) { const b = $('#r-booking'); b.href = d.rezervacija; b.hidden = false; }
  else { const t = $('#r-tel'); t.textContent = 'Pokličite 041 669 785'; t.className = 'btn'; }

  // Entrance: dial fills, ticks light, the number counts up, the ladder rises to your level.
  if (!reduce) root.classList.add('anim');
  root.hidden = false;
  const skupno = Number(d.skupno) || 0;
  const zazeni = () => {
    $('#r-ring').style.strokeDashoffset = OBSEG * (1 - skupno / 100);
    root.querySelectorAll('.ticks i').forEach(t => t.classList.toggle('on', !!t.dataset.on));
    root.classList.add('in');
    stej($('#r-score'), skupno);
  };
  if (reduce) zazeni(); else requestAnimationFrame(() => requestAnimationFrame(zazeni));
}
