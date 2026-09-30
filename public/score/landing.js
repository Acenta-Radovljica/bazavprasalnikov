// Landing motion for AI Business Score. No scroll listeners: IntersectionObserver + CSS only.
// Everything degrades to the final, static state under prefers-reduced-motion or without JS.
(() => {
  const root = document.getElementById('v-landing');
  if (!root) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;
  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => [...el.querySelectorAll(s)];

  // ── Nav turns solid once the hero is behind it ──
  const nav = $('[data-nav]'), navCta = $('[data-nav-cta]');
  new IntersectionObserver(([e]) => {
    const past = !e.isIntersecting;
    nav.classList.toggle('solid', past);
    navCta.tabIndex = past ? 0 : -1;
  }, { rootMargin: '-72px 0px 0px 0px' }).observe($('[data-hero]'));

  // ── Report instrument ──
  // Example profiles. Level comes from maturity (same ranges as src/score), total uses the
  // scorer's weights: 0.25 maturity + 0.35 potential + 0.25 readiness + 0.15 financial.
  const PROFILI = [
    { podrocje: 'Nabava', zrelost: 25, potencial: 76, pripravljenost: 92, financni: 70, priloznost: 'AI agent za nabavo ali pilotni projekt v nabavi' },
    { podrocje: 'Prodaja', zrelost: 48, potencial: 64, pripravljenost: 75, financni: 60, priloznost: 'AI pomočnik za prodajo in pripravo ponudb' },
    { podrocje: 'Podpora strankam', zrelost: 14, potencial: 82, pripravljenost: 58, financni: 50, priloznost: 'AI pomočnik za podporo strankam ali gostom' },
    { podrocje: 'Vodstvo', zrelost: 67, potencial: 71, pripravljenost: 83, financni: 80, priloznost: 'AI pomočnik za direktorja' },
    { podrocje: 'Administracija', zrelost: 36, potencial: 69, pripravljenost: 67, financni: 55, priloznost: 'AI pomočnik za administracijo in interno znanje' },
  ];
  const STOPNJE = [
    { do: 20, naziv: 'AI začetnik', opis: 'Ste v začetni fazi. Neizkoriščenega potenciala je veliko.' },
    { do: 40, naziv: 'AI raziskovalec', opis: 'AI že uporabljate, a uporaba še ni sistemska.' },
    { do: 60, naziv: 'AI uporabnik', opis: 'Dobre osnove. Naslednji korak je AI v procesih.' },
    { do: 80, naziv: 'AI pospeševalec', opis: 'Nad povprečjem. Čas je za agente in avtomatizacije.' },
    { do: 100, naziv: 'AI-first kandidat', opis: 'Zelo dobra osnova za sistemsko uporabo AI.' },
  ];
  const skupno = p => Math.round(p.zrelost * .25 + p.potencial * .35 + p.pripravljenost * .25 + p.financni * .15);

  const meter = $('[data-meter]');
  const m = k => $(`[data-m="${k}"]`, meter);
  const DIMS = ['zrelost', 'potencial', 'pripravljenost'];
  const TICKS = 20;
  const CIRC = 540.35;
  DIMS.forEach(d => {
    m('t-' + d).innerHTML = Array.from({ length: TICKS }, (_, t) => `<i style="--t:${t}"></i>`).join('');
  });
  const shown = { skupno: 0, zrelost: 0, potencial: 0, pripravljenost: 0 };

  function countTo(key, el, to, ms = 1100) {
    const from = shown[key];
    shown[key] = to;
    if (reduce) { el.textContent = to; return; }
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 4);
      el.textContent = Math.round(from + (to - from) * eased);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function swapText(el, txt) {
    if (el.textContent === txt) return;
    el.textContent = txt;
    if (reduce) return;
    el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
  }
  function pokazi(p) {
    const total = skupno(p);
    const st = STOPNJE.find(s => p.zrelost <= s.do);
    countTo('skupno', m('skupno'), total);
    m('ring').style.strokeDashoffset = CIRC * (1 - total / 100);
    DIMS.forEach(d => {
      countTo(d, m(d), p[d], 900);
      const lit = Math.round(p[d] / (100 / TICKS));
      $$('i', m('t-' + d)).forEach((tick, t) => tick.classList.toggle('on', t < lit));
    });
    swapText(m('podrocje'), p.podrocje);
    swapText(m('stopnja'), st.naziv);
    swapText(m('opis'), st.opis);
    swapText(m('priloznost'), p.priloznost);
  }

  let idx = 0, timer = null, meterVisible = false, booted = reduce, hoverQ = false;
  const zacni = () => { if (!reduce && booted && !hoverQ && !timer && meterVisible && !document.hidden) timer = setInterval(() => { idx = (idx + 1) % PROFILI.length; pokazi(PROFILI[idx]); }, 4200); };
  const ustavi = () => { clearInterval(timer); timer = null; };

  // Power-on: the dial sweeps to full and every tick lights in a wave (a self-test), then the
  // first profile settles. Starts once the headline has landed, so the eye goes words, then number.
  if (reduce) pokazi(PROFILI[0]);
  else setTimeout(() => {
    meter.classList.add('boot');
    m('ring').style.strokeDashoffset = 0;
    countTo('skupno', m('skupno'), 100, 800);
    DIMS.forEach(d => { countTo(d, m(d), 100, 800); $$('i', m('t-' + d)).forEach(t => t.classList.add('on')); });
    setTimeout(() => {
      pokazi(PROFILI[0]);
      setTimeout(() => { meter.classList.remove('boot'); booted = true; root.querySelector('[data-hero]').classList.add('live'); zacni(); }, 900);
    }, 950);
  }, 850);
  new IntersectionObserver(([e]) => { meterVisible = e.isIntersecting; meterVisible ? zacni() : ustavi(); }, { threshold: .4 }).observe(meter);
  document.addEventListener('visibilitychange', () => (document.hidden ? ustavi() : zacni()));
  meter.addEventListener('pointerenter', ustavi);
  meter.addEventListener('pointerleave', zacni);

  // ── The first question drives the instrument: hovering an answer previews a company like that.
  // Illustrative only (the card says "Primer poročila"); the real score needs all 16 answers.
  const PREDOGLED = { ne: 2, posamezniki: 0, vec_zaposlenih: 4, oddelki: 1, procesi: 3 };
  let pustiT = 0;
  $$('[data-hq] [data-hq-opt]').forEach(b => {
    const on = () => {
      if (!booted) return;
      clearTimeout(pustiT); hoverQ = true; ustavi();
      meter.classList.add('linked');
      const i = PREDOGLED[b.dataset.hqOpt];
      if (i !== undefined && i !== idx) { idx = i; pokazi(PROFILI[i]); }
    };
    const off = () => { pustiT = setTimeout(() => { hoverQ = false; meter.classList.remove('linked'); zacni(); }, 250); };
    b.addEventListener('pointerenter', on); b.addEventListener('focus', on);
    b.addEventListener('pointerleave', off); b.addEventListener('blur', off);
  });

  // ── Pointer physics: tilt on the instrument, magnetic pull on primary buttons ──
  if (!reduce && finePointer) {
    let raf = 0;
    meter.addEventListener('pointermove', e => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = meter.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        meter.style.setProperty('--ry', (x * 7).toFixed(2) + 'deg');
        meter.style.setProperty('--rx', (-y * 7).toFixed(2) + 'deg');
      });
    });
    meter.addEventListener('pointerleave', () => { meter.style.setProperty('--rx', '0deg'); meter.style.setProperty('--ry', '0deg'); });

    // Cursor light over the hero (transform only, one rAF per frame)
    const hero = $('[data-hero]'), spot = $('[data-spot]');
    let r3 = 0;
    hero.addEventListener('pointermove', e => {
      cancelAnimationFrame(r3);
      r3 = requestAnimationFrame(() => {
        const r = hero.getBoundingClientRect();
        spot.style.transform = `translate(${(e.clientX - r.left).toFixed(0)}px, ${(e.clientY - r.top).toFixed(0)}px)`;
        spot.classList.add('on');
      });
    });
    hero.addEventListener('pointerleave', () => spot.classList.remove('on'));

    $$('[data-magnetic]').forEach(btn => {
      let r2 = 0;
      btn.addEventListener('pointermove', e => {
        cancelAnimationFrame(r2);
        r2 = requestAnimationFrame(() => {
          const r = btn.getBoundingClientRect();
          const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
          btn.style.translate = `${(dx * .22).toFixed(1)}px ${(dy * .32).toFixed(1)}px`;
        });
      });
      btn.addEventListener('pointerleave', () => { btn.style.translate = '0 0'; });
    });
  }

  // ── Story: the step in the middle band of the viewport picks the scene of the pinned report ──
  const story = $('[data-story]');
  if (story) {
    const steps = $$('[data-step]', story), scenes = $$('[data-scene]', story), dots = $$('.lp-dev-dots i', story);
    let aktiven = -1;
    const stej = (el, od, to, ms, pred = '') => {
      if (reduce) { el.textContent = pred + to; return; }
      const t0 = performance.now();
      const k = now => { const p = Math.min(1, (now - t0) / ms); el.textContent = pred + Math.round(od + (to - od) * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(k); };
      requestAnimationFrame(k);
    };
    const nastavi = i => {
      if (i === aktiven) return;
      aktiven = i;
      steps.forEach((s, k) => s.classList.toggle('on', k === i));
      scenes.forEach((s, k) => s.classList.toggle('on', k === i));
      dots.forEach((d, k) => d.classList.toggle('on', k <= i));
      const sc = scenes[i];
      if (!sc) return;
      $$('b[data-to]', sc).forEach((b, k) => setTimeout(() => stej(b, 0, +b.dataset.to, 700, '+'), reduce ? 0 : 250 + k * 140));
      $$('strong[data-to]', sc).forEach(b => setTimeout(() => stej(b, +b.dataset.from, +b.dataset.to, 900), reduce ? 0 : 750));
      const dial = $('.lp-sc-dial strong', sc);
      if (dial) stej(dial, 0, 46, 1100);
    };
    nastavi(0);
    // A thin band across the middle of the viewport: whichever step crosses it is the active one.
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) nastavi(+e.target.dataset.step); }),
      { rootMargin: '-48% 0px -48% 0px' });
    steps.forEach(s => io.observe(s));
  }

  // ── One-shot reveals ──
  const once = (sel, cls, opts) => {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add(cls); io.unobserve(e.target); }
    }), opts);
    $$(sel).forEach(el => io.observe(el));
  };
  once('[data-reveal]', 'in', { rootMargin: '0px 0px -12% 0px' });
  once('[data-final]', 'on', { threshold: .3 });
})();
