// AI Business Score report page (/r/:token). Data comes from /r/:token/podatki, which never
// contains raw answers or internal lead data. Rendering mirrors the approved prototype.

const $ = (s) => document.querySelector(s);
const token = location.pathname.split('/').filter(Boolean)[1] || '';

const DIM = [
  ['zrelost', 'AI zrelost', 'Kako sistematično AI uporabljate danes.'],
  ['potencial', 'Potencial v procesih', 'Koliko časa in stroškov bi lahko prevzel AI.'],
  ['pripravljenost', 'Pripravljenost za korak', 'Kako hitro želite začeti.'],
];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
function li(ul, arr) { ul.replaceChildren(...arr.map(t => el('li', '', t))); }

function napaka(msg) {
  $('#v-porocilo').hidden = true;
  const e = $('#r-napaka'); e.textContent = msg; e.hidden = false;
}

const res = await fetch(`/r/${encodeURIComponent(token)}/podatki`).catch(() => null);
if (!res || res.status === 404) napaka('Poročila ne najdemo. Preverite povezavo iz e-pošte ali nas pokličite na 041 669 785.');
else if (res.status === 410) napaka('To poročilo ni več na voljo. Za novo oceno nas pokličite na 041 669 785.');
else if (!res.ok) napaka('Poročila trenutno ne moremo prikazati. Poskusite znova čez nekaj minut.');
else {
  const d = await res.json();
  document.title = `AI Business Score za ${d.podjetje} | Acenta`;
  $('#r-naslov').textContent = `AI Business Score za ${d.podjetje || 'vaše podjetje'}`;
  // No copy is e-mailed until MailerLite is configured, so do not promise one here.
  $('#r-meta').textContent = `Izpolnjeno ${d.datum} · povezavo si shranite, da se lahko k poročilu vrnete`;
  $('#r-ring').style.setProperty('--v', d.skupno);
  $('#r-score').textContent = d.skupno;
  $('#r-level').textContent = 'Vaša stopnja';
  $('#r-levelh').textContent = d.stopnja.naziv;
  $('#r-levelp').textContent = d.stopnja.opis;

  $('#r-bars').replaceChildren(...DIM.map(([id, n, why]) => {
    const bar = el('div', 'bar');
    const lbl = el('div', 'lbl'); lbl.append(el('span', '', n), el('span', '', `${d.dimenzije[id]} / 100`));
    const track = el('div', 'track'); const fill = el('div', 'fill'); fill.style.width = `${d.dimenzije[id]}%`; track.append(fill);
    bar.append(lbl, track, el('div', 'why', why));
    return bar;
  }));

  const opp = $('#r-opp');
  const rec = el('div', 'rec'); rec.append(el('b', '', 'Priporočen prvi korak'), document.createTextNode(d.proces ? d.proces.priporocilo : d.stopnja.priporocilo));
  opp.replaceChildren(
    el('small', '', 'Največja priložnost'),
    el('h3', '', d.proces ? d.proces.naziv : 'Še ni jasna'),
    el('p', '', d.proces
      ? 'Na tem področju ste označili največ izgubljenega časa ali nepotrebnih stroškov.'
      : 'Iz odgovorov še ne izstopa en sam proces. To je pogosto pri podjetjih, ki z AI šele začenjajo.'),
    rec,
  );

  $('#r-odstavek').textContent = d.besedilo.odstavek;
  li($('#r-dobro'), d.besedilo.dobro);
  li($('#r-zatika'), d.besedilo.zatika);
  li($('#r-prilo'), d.besedilo.priloznosti);

  // Booking button only when a real link is configured (no dead controls).
  if (d.rezervacija) { const b = $('#r-booking'); b.href = d.rezervacija; b.hidden = false; }
  else $('#r-tel').textContent = 'Pokličite nas: 041 669 785';
}
