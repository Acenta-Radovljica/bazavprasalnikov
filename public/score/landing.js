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

  let idx = 0, timer = null, meterVisible = false;
  const zacni = () => { if (!reduce && !timer && meterVisible && !document.hidden) timer = setInterval(() => { idx = (idx + 1) % PROFILI.length; pokazi(PROFILI[idx]); }, 4200); };
  const ustavi = () => { clearInterval(timer); timer = null; };
  // First paint waits for the headline to land, so the eye goes headline, then number.
  setTimeout(() => pokazi(PROFILI[0]), reduce ? 0 : 900);
  new IntersectionObserver(([e]) => { meterVisible = e.isIntersecting; meterVisible ? zacni() : ustavi(); }, { threshold: .4 }).observe(meter);
  document.addEventListener('visibilitychange', () => (document.hidden ? ustavi() : zacni()));
  meter.addEventListener('pointerenter', ustavi);
  meter.addEventListener('pointerleave', zacni);

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

  // ── Argument text: each word lights up as it crosses the upper half of the viewport ──
  const scrub = $('[data-scrub]');
  scrub.innerHTML = scrub.textContent.trim().split(/\s+/).map(w => `<span class="sw">${w}</span>`).join(' ');
  if (!reduce) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      // Lit once it is above the line; unlit again only if it drops back below (scrolling up).
      const above = e.boundingClientRect.top < e.rootBounds.bottom;
      e.target.classList.toggle('lit', e.isIntersecting || above);
    }), { rootMargin: '0px 0px -42% 0px' });
    $$('.sw', scrub).forEach(w => io.observe(w));
  }

  // ── One-shot reveals ──
  const once = (sel, cls, opts) => {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add(cls); io.unobserve(e.target); }
    }), opts);
    $$(sel).forEach(el => io.observe(el));
  };
  once('[data-reveal]', 'in', { rootMargin: '0px 0px -12% 0px' });
  once('[data-card]', 'on', { threshold: .45 });
  once('[data-flow]', 'on', { threshold: .5 });
  once('[data-final]', 'on', { threshold: .3 });
})();
