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

// How the recommended first project works, per strongest process (proces.id from the scorer).
// "Danes" is framed as "often today", not as a claim about this company; no numbers promised.
const SCENARIJ = {
  nabava: {
    danes: 'Ponudbe dobaviteljev primerjate ročno, po e-pošti in v tabelah.',
    koraki: [
      ['AI prebere ponudbe', 'Iz PDF-jev in e-pošte izlušči cene, roke in pogoje.'],
      ['Pripravi primerjavo', 'Vse ponudbe v eni tabeli, odstopanja od preteklih nakupov označena.'],
      ['Nabavnik odloči', 'Pregleda predlog in izbere. Odločitev ostane pri človeku.'],
    ],
  },
  prodaja: {
    danes: 'Vsako ponudbo in odgovor na povpraševanje pripravite ročno.',
    koraki: [
      ['AI prebere povpraševanje', 'Poišče podobne pretekle ponudbe in vaše cenike.'],
      ['Pripravi osnutek', 'Ponudbo in odgovor v vašem tonu, s pravimi postavkami.'],
      ['Prodajalec pošlje', 'Pregleda, popravi in pošlje. Nič ne gre ven brez človeka.'],
    ],
  },
  administracija: {
    danes: 'Podatke iz dokumentov prepisujete ročno, odgovori so raztreseni po mapah.',
    koraki: [
      ['AI prebere dokumente', 'Iz računov, pogodb in e-pošte izlušči podatke.'],
      ['Odgovarja iz vašega znanja', 'Na interna vprašanja odgovori iz vaših navodil in dokumentov.'],
      ['Zaposleni potrdi', 'Vnos ali odgovor potrdi, preden gre naprej.'],
    ],
  },
  vodstvo: {
    danes: 'Številke za odločanje zbirate iz več virov in tabel.',
    koraki: [
      ['AI zbere številke', 'Iz sistemov, ki jih že uporabljate.'],
      ['Pripravi povzetek', 'Kaj se je spremenilo in kaj zahteva vašo odločitev.'],
      ['Direktor vpraša naprej', 'Pregled na eni strani, dodatna vprašanja kar v pogovoru.'],
    ],
  },
  podpora: {
    danes: 'Na ista vprašanja strank ali gostov odgovarjate znova in znova.',
    koraki: [
      ['AI odgovori na pogosta vprašanja', 'Iz vaših vsebin, podnevi in ponoči.'],
      ['Zahtevnejše preda naprej', 'Zaposleni dobi primer s povzetkom pogovora.'],
      ['Ekipa dopolni vsebine', 'Vidi, katera vprašanja se ponavljajo, in jih doda.'],
    ],
  },
  marketing: {
    danes: 'Vsako objavo in sporočilo pripravite od začetka.',
    koraki: [
      ['AI pripravi osnutke', 'Objave, e-poštna sporočila in oglase iz vaših tem.'],
      ['Prilagodi kanalu', 'Dolžino in obliko za vsak kanal, v vašem tonu.'],
      ['Marketing objavi', 'Pregleda, uredi in objavi po svojem urniku.'],
    ],
  },
};

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
if (!res || res.status === 404) napaka('Poročila ne najdemo. Preverite povezavo ali nas pokličite na 031 615 921.');
else if (res.status === 410) napaka('To poročilo ni več na voljo. Za novo oceno nas pokličite na 031 615 921.');
else if (!res.ok) napaka('Poročila trenutno ne moremo prikazati. Poskusite znova čez nekaj minut.');
else {
  const d = await res.json();
  const root = $('#v-porocilo');
  document.title = `AI Business Score za ${d.podjetje || 'vaše podjetje'} | Acenta`;
  // Title words rise one after another (same as the landing headline); screen readers get the line.
  const naslov = `AI Business Score za ${d.podjetje || 'vaše podjetje'}`;
  const h1 = $('#r-naslov');
  h1.setAttribute('aria-label', naslov);
  h1.replaceChildren(...naslov.split(/\s+/).flatMap((w, i) => {
    const o = el('span', 'w'); o.setAttribute('aria-hidden', 'true');
    const s = el('span', '', w); s.style.setProperty('--i', i); o.append(s);
    return i ? [document.createTextNode(' '), o] : [o];
  }));
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

  // How it would work, for the strongest process
  const sc = d.proces && SCENARIJ[d.proces.id];
  if (sc) {
    $('#r-scen-naslov').textContent = d.proces.priporocilo;
    $('#r-scen-danes').textContent = sc.danes;
    $('#r-scen-flow').replaceChildren(...sc.koraki.map(([b, t], k) => {
      const n = el('li'); n.style.setProperty('--k', k); n.append(el('b', '', b), el('span', '', t)); return n;
    }));
    $('#r-scen-sec').hidden = false;
  }

  // What would raise the score (real rescoring, one answer up at a time)
  if (d.vzvodi?.length) {
    $('#r-vz-naslov').textContent = d.vzvodi.length === 1 ? 'Korak, ki vam dvigne AI zrelost' : `${['', '', 'Dva koraka', 'Trije koraki'][d.vzvodi.length]}, ki vam najbolj dvignejo AI zrelost`;
    $('#r-vzvodi').replaceChildren(...d.vzvodi.map((v, k) => {
      const n = el('li'); n.style.setProperty('--k', k);
      const pts = el('span', 'vz-pts'); pts.append(el('b', '', `+${v.zrelost}`), el('small', '', 'AI zrelost'));
      n.append(el('p', '', v.korak), pts);
      return n;
    }));
    const sum = $('#r-vz-sum');
    const nums = el('div', 'nums');
    const hi = el('b', 'hi', String(d.skupaj.skupno)); hi.dataset.od = d.skupno;
    nums.append(el('b', '', String(d.skupno)), el('i', '', '→'), hi);
    sum.replaceChildren(el('small', '', d.vzvodi.length > 1 ? 'Skupna ocena z vsemi koraki' : 'Skupna ocena s tem korakom'), nums);
    if (d.skupaj.novaStopnja) sum.append(el('span', 'lvl', `in stopnja ${d.skupaj.stopnja}`));
    $('#r-vz-sec').hidden = false;
  }

  // Their own words back
  const said = $('#r-said'), bloki = [];
  const blok = (naslov, items) => {
    if (!items?.length) return;
    const b = el('div'); const ul = el('ul');
    items.forEach((t, k) => { const x = el('li', '', t); x.style.setProperty('--k', k); ul.append(x); });
    b.append(el('small', '', naslov), ul); bloki.push(b);
  };
  blok('Kje izgubite največ časa', d.izbrano?.cas);
  blok('Kje nastajajo nepotrebni stroški', d.izbrano?.stroski);
  blok('Odziv na novo povpraševanje', d.izbrano?.odziv ? [d.izbrano.odziv] : []);
  if (bloki.length) { said.replaceChildren(...bloki); said.hidden = false; }

  // Closing: someone who asked for a 30-minute talk gets that as the headline.
  if (d.izbrano?.zeliPogovor) {
    $('#r-close-h').textContent = 'Želeli ste 30-minutni pogovor. Dogovorimo se.';
    $('#r-close-p').textContent = `V pogovoru skupaj pogledamo vaš rezultat in izberemo proces, kjer bi AI pri vas najhitreje pokazal učinek${d.proces ? `: najverjetneje ${d.proces.naziv.toLowerCase()}` : ''}.`;
  }
  // Booking button only when a real link is configured (no dead controls); otherwise the
  // phone number becomes the primary action.
  if (d.rezervacija) { const b = $('#r-booking'); b.href = d.rezervacija; b.hidden = false; }
  else { const t = $('#r-tel'); t.textContent = 'Pokličite 031 615 921'; t.className = 'btn'; }

  // Share: copy the private link, or save as PDF (print styles are light)
  $('#r-copy').addEventListener('click', async () => {
    const ok = $('#r-copy-ok');
    try { await navigator.clipboard.writeText(location.href); ok.textContent = 'Povezava je kopirana.'; }
    catch { ok.textContent = `Kopirajte povezavo iz naslovne vrstice: ${location.href}`; }
    setTimeout(() => { ok.textContent = ''; }, 5000);
  });
  $('#r-pdf').addEventListener('click', () => window.print());

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
  if (reduce) zazeni(); else requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(zazeni, 350)));

  // Sections rise as they arrive; the lever numbers count up once visible.
  const odkrij = (n) => {
    n.classList.add('in');
    n.querySelectorAll?.('.vz-pts b, .vz-sum .nums b.hi').forEach(b => {
      const m = b.textContent.match(/^(\+?)(\d+)$/);
      if (!m || reduce) return;
      const cilj = +m[2], od = +(b.dataset.od || 0), t0 = performance.now();
      const korak = (t) => { const p = Math.min((t - t0) / 900, 1); b.textContent = m[1] + Math.round(od + (cilj - od) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(korak); };
      requestAnimationFrame(korak);
    });
  };
  const razkrij = [...root.querySelectorAll('[data-reveal]')];
  if (reduce || !('IntersectionObserver' in window)) razkrij.forEach(odkrij);
  else {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { odkrij(e.target); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
    razkrij.forEach(n => io.observe(n));
  }
  // Printing (Shrani kot PDF) must show everything, also parts not scrolled to yet.
  addEventListener('beforeprint', () => razkrij.forEach(n => n.classList.add('in')));
}
