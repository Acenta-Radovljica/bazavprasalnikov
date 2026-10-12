// ── Popis opravil: javni obrazec za zaposlene ─────────────────────────────
// GET  /popis/:koda  obrazec za podjetje s to kodo (ali stran "povezava ne velja")
// POST /popis/:koda  oddaja (JSON), shrani se v responses kot vprasalnik popis-opravil
//
// Koda doloci podjetje, zato zaposleni naziva ne vpisujejo in AI ujemanja ni.
// Vprasanja, pravilo za ure in preverjanje oddaje so v public/admin/popis.js,
// isti datoteki, ki jo bere stran podjetja.

// ── DEL 1: Imports ────────────────────────────────────────────────────────
import express from 'express';
import { dbQuery } from '../db.js';
import { hashIp } from '../utils/normalize.js';
import { VPRASANJA, POPIS_SLUG, MAX_OPRAVIL, preveriOddajo } from '../../public/admin/popis.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const router = express.Router();
const KODA_RE = /^[a-f0-9]{12}$/;
const HONEYPOT_FIELD = 'company_url';
const KONTAKT = 'ai@acenta.si';

// Povezava gre po podjetju od rok do rok: omejitev oddaj na IP, da en skript
// ne napolni baze. V spominu procesa je dovolj (ob restartu se ponastavi).
const OKNO_MS = 10 * 60 * 1000;
const MAX_V_OKNU = parseInt(process.env.POPIS_MAX_V_OKNU || '20', 10);
const oddajePoIp = new Map();
function prevec(ipHash) {
  const zdaj = Date.now();
  const casi = (oddajePoIp.get(ipHash) || []).filter(t => zdaj - t < OKNO_MS);
  casi.push(zdaj);
  oddajePoIp.set(ipHash, casi);
  if (oddajePoIp.size > 5000) oddajePoIp.clear();
  return casi.length > MAX_V_OKNU;
}

// Stran nosi naziv podjetja: brez indeksiranja, brez Referer, brez skupnega predpomnilnika.
function zasebneGlave(res) {
  res.set({
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'private, no-store',
  });
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function podjetjeIzKode(koda) {
  if (!KODA_RE.test(koda)) return null;
  const r = await dbQuery('SELECT id, naziv_prikaz FROM companies WHERE popis_koda = $1', [koda]);
  return r?.rows?.[0] ?? null;
}

// ── DEL 3: HTML ───────────────────────────────────────────────────────────

const CSS = `
  *,*::before,*::after{box-sizing:border-box;}
  :root{--teal:#00b894;--teal-dark:#006e5a;--teal-tint:#e8f8f4;--teal-ring:rgba(0,184,148,.15);--dark:#1a1a2e;--dark-2:#15151f;--bg:#f8f9fa;--paper:#fff;--border:#d1d5db;--line:#ece9e1;--muted:#6b7280;--req:#c0392b;}
  body{font-family:'Inter',-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--dark);margin:0;padding:2rem 1rem;line-height:1.5;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:680px;margin:0 auto;background:var(--paper);border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.06);overflow:hidden;}
  .header{background:var(--dark);color:#fff;padding:2rem;}
  .eyebrow{font-size:.75rem;opacity:.7;letter-spacing:.08em;text-transform:uppercase;font-weight:500;}
  .header h1{margin:.5rem 0 .15rem;font-size:1.75rem;line-height:1.2;}
  .sub{opacity:.85;font-size:.95rem;}
  .intro{margin:1rem 0 0;opacity:.85;}
  form{padding:2rem;}
  .note{font-size:.85rem;color:var(--muted);margin:0 0 1.25rem;}
  .vprasanje{margin-bottom:1.5rem;}
  .lbl{display:block;font-weight:600;margin-bottom:.5rem;}
  .req{color:var(--req);margin-left:.15rem;}
  input[type=text],textarea{width:100%;padding:.75rem;border:1px solid var(--border);border-radius:6px;font:inherit;background:var(--paper);color:inherit;}
  input:focus,textarea:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-ring);}
  textarea{resize:vertical;min-height:100px;}
  .opts{display:flex;flex-direction:column;gap:.5rem;}
  .opt{display:flex;align-items:center;gap:.75rem;min-height:44px;padding:.25rem .75rem;border:1px solid var(--border);border-radius:6px;background:var(--paper);cursor:pointer;font-weight:400;font-size:.95rem;}
  .opt input{margin:0;accent-color:var(--teal);width:16px;height:16px;flex:none;}
  .opt:has(input:checked){border-color:var(--teal);background:var(--teal-tint);box-shadow:0 0 0 3px var(--teal-ring);}
  .opt:has(input:focus-visible){outline:2px solid var(--teal);outline-offset:2px;}
  .sklop{border-top:1px solid var(--line);margin:1.75rem 0 0;padding-top:1.25rem;}
  .sklop h2{font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:1.25rem;letter-spacing:-.015em;color:var(--dark-2);margin:0 0 1rem;}
  .sklop[hidden]{display:none;}
  .dodaj{display:block;width:100%;padding:.85rem;border:1.5px solid var(--teal);color:var(--teal-dark);border-radius:6px;background:transparent;font:inherit;font-size:.95rem;font-weight:600;cursor:pointer;margin:.25rem 0 1.5rem;}
  .dodaj:hover{background:var(--teal-tint);}
  .dodaj[hidden]{display:none;}
  .gdpr{margin:1.5rem 0;padding:1rem;background:var(--bg);border-radius:6px;font-size:.9rem;}
  .gdpr label{display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;}
  .gdpr input{margin-top:.2rem;accent-color:var(--teal);}
  .submit{display:block;width:100%;padding:1rem;background:var(--teal);color:#fff;border:none;border-radius:6px;font:inherit;font-size:1rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;}
  .submit:hover{opacity:.9;}
  .submit:disabled{opacity:.5;cursor:not-allowed;}
  .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;}
  .err{background:#fdecea;color:#a3261a;padding:1rem;border-radius:6px;margin-bottom:1rem;display:none;}
  .err.is-on{display:block;}
  .footer{padding:1rem 2rem;background:var(--bg);text-align:center;font-size:.85rem;color:var(--muted);}
  .footer a,.thanks-contact a{color:var(--teal-dark);text-decoration:none;font-weight:600;}
  .thanks[hidden]{display:none;}
  .thanks-hero{background:linear-gradient(135deg,var(--dark-2) 0%,var(--dark) 100%);color:#fff;padding:2.5rem 2.5rem 2.75rem;text-align:center;}
  .thanks-check{width:64px;height:64px;margin:0 auto 1.25rem;background:var(--teal);border-radius:50%;display:flex;align-items:center;justify-content:center;}
  .thanks-check svg{width:32px;height:32px;color:#fff;}
  .thanks-title{font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:2rem;letter-spacing:-.025em;line-height:1.2;margin:0;}
  .thanks-body{padding:2rem 2.5rem 1.5rem;}
  .thanks-body p{margin:0 0 1.25rem;}
  .thanks-contact{text-align:center;margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid var(--line);font-size:.9rem;color:var(--muted);}
  @media (max-width:600px){
    body{padding:1rem .5rem;}
    .header{padding:1.5rem 1.25rem;}
    .header h1{font-size:1.5rem;}
    form{padding:1.5rem 1.25rem;}
    .vprasanje{margin-bottom:1.25rem;}
    .gdpr{padding:.85rem;font-size:.85rem;}
    .thanks-hero{padding:2rem 1.25rem 2.25rem;}
    .thanks-body{padding:1.75rem 1.25rem 1.25rem;}
    .thanks-title{font-size:1.75rem;}
    .footer{padding:.85rem 1.25rem;}
  }`;

function glava(naslov) {
  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(naslov)} · Acenta</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>`;
}

const kontaktHtml = `Vprašanja? Pišite na <a href="mailto:${KONTAKT}">${KONTAKT}</a>`;

function polje(q, st) {
  const oznaka = `${st}. ${esc(q.label)}${q.obvezno ? '<span class="req" aria-hidden="true">*</span>' : ''}`;
  if (q.tip === 'radio' || q.tip === 'checkbox') {
    const izbire = q.options.map((o) => `
          <label class="opt"><input type="${q.tip}" name="${q.id}" value="${esc(o)}"${q.obvezno && q.tip === 'radio' ? ' required' : ''}><span>${esc(o)}</span></label>`).join('');
    return `
      <fieldset class="vprasanje" style="border:0;margin-inline:0;padding:0">
        <legend class="lbl">${oznaka}</legend>
        <div class="opts">${izbire}
        </div>
      </fieldset>`;
  }
  const atributi = `id="${q.id}" name="${q.id}"${q.placeholder ? ` placeholder="${esc(q.placeholder)}"` : ''}${q.obvezno ? ' required' : ''}`;
  const vnos = q.tip === 'textarea'
    ? `<textarea ${atributi} maxlength="2000"></textarea>`
    : `<input type="text" ${atributi} maxlength="120" autocomplete="${q.id === 'ime' ? 'name' : 'organization-title'}">`;
  return `
      <div class="vprasanje">
        <label class="lbl" for="${q.id}">${oznaka}</label>
        ${vnos}
      </div>`;
}

// Vprasanja so stevilcena kot v nacrtu: 1 delovno mesto, 2 do 6 opravilo (v
// vsakem sklopu znova), 7 ime.
function obrazecHtml(podjetje, koda) {
  const mesto = VPRASANJA.find(q => q.id === 'delovno_mesto');
  const ime = VPRASANJA.find(q => q.id === 'ime');
  const sklopi = [];
  for (let n = 1; n <= MAX_OPRAVIL; n++) {
    const vpr = VPRASANJA.filter(q => q.sklop === `Opravilo ${n}`);
    sklopi.push(`
      <section class="sklop" id="sklop-${n}" data-sklop="${n}"${n > 1 ? ' hidden' : ''}>
        <h2>Opravilo ${n}</h2>${vpr.map((q, i) => polje(q, i + 2)).join('')}
      </section>`);
    if (n < MAX_OPRAVIL) {
      sklopi.push(`
      <button type="button" class="dodaj" id="dodaj-${n + 1}" data-dodaj="${n + 1}"${n > 1 ? ' hidden' : ''}>+ Dodaj ${n + 1 === 2 ? 'drugo' : 'tretje'} opravilo</button>`);
    }
  }

  return `${glava('Popis opravil')}
<body>
<main class="wrap">
  <header class="header">
    <div class="eyebrow">Acenta · AI rešitve po meri</div>
    <h1>Popis opravil</h1>
    <div class="sub">za podjetje ${esc(podjetje.naziv_prikaz)}</div>
    <p class="intro">Vaše podjetje skupaj z agencijo Acenta preverja, katera ponavljajoča se opravila bi lahko namesto vas opravljal AI pomočnik. Opišite do tri opravila, ki vam vzamejo največ časa ali vas najbolj motijo. Izpolnjevanje traja 3 do 4 minute.</p>
  </header>

  <form id="popis" novalidate data-koda="${esc(koda)}">
    <p class="note">Ime je neobvezno. V dokumentu za vodstvo imen zaposlenih ne navajamo.</p>
    <div class="err" id="err" role="alert"></div>
    ${polje(mesto, 1)}
    ${sklopi.join('')}
    ${polje(ime, 7)}
    <div class="hp" aria-hidden="true">
      <label for="hp">Ne izpolnjujte tega polja</label>
      <input type="text" id="hp" name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off">
    </div>
    <div class="gdpr">
      <label>
        <input type="checkbox" name="gdpr_consent" id="gdpr" required>
        <span>Strinjam se, da Acenta moje odgovore shrani in uporabi za pripravo predloga AI rešitev za moje podjetje. Podatkov ne posredujemo tretjim osebam.<span class="req" aria-hidden="true">*</span></span>
      </label>
    </div>
    <button type="submit" class="submit" id="poslji">Pošlji odgovor</button>
  </form>

  <section class="thanks" id="hvala" hidden aria-live="polite">
    <div class="thanks-hero">
      <div class="thanks-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
      <h1 class="thanks-title" tabindex="-1">Hvala, vaš odgovor je shranjen.</h1>
    </div>
    <div class="thanks-body">
      <p>Če vam veliko časa vzame še kakšno opravilo, ga lahko opišete v novem odgovoru.</p>
      <button type="button" class="submit" id="znova">Opiši še eno opravilo</button>
      <div class="thanks-contact">${kontaktHtml}</div>
    </div>
  </section>

  <footer class="footer" id="noga">${kontaktHtml}</footer>
</main>
<script>${SKRIPTA}</script>
</body>
</html>`;
}

function neveljavnaHtml() {
  return `${glava('Povezava ne velja')}
<body>
<main class="wrap">
  <header class="header">
    <h1>Ta povezava ne velja več</h1>
  </header>
  <div class="thanks-body">
    <p>Prosite vodstvo za novo povezavo do popisa opravil vašega podjetja.</p>
    <div class="thanks-contact">${kontaktHtml}</div>
  </div>
</main>
</body>
</html>`;
}

// Brskalnik: dodajanje sklopov, oddaja kot JSON, zahvala, nov odgovor.
const SKRIPTA = `
(() => {
  const f = document.getElementById('popis');
  const err = document.getElementById('err');
  const gumb = document.getElementById('poslji');
  const hvala = document.getElementById('hvala');
  const noga = document.getElementById('noga');
  const SPOROCILA = {
    manjka: 'Izpolnite označeno polje.',
    neveljavno: 'Izberite eno od ponujenih možnosti.',
    predolgo: 'Besedilo je predolgo, skrajšajte ga.',
    gdpr_consent_required: 'Za oddajo potrdite soglasje na dnu obrazca.',
    too_many_requests: 'Preveč oddaj v kratkem času. Poskusite znova čez nekaj minut.',
    not_found: 'Ta povezava ne velja več. Prosite vodstvo za novo povezavo.',
  };
  const pokaziNapako = (t, el) => {
    err.textContent = t; err.classList.add('is-on');
    (el || err).scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (el && el.focus) el.focus({ preventScroll: true });
  };

  f.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dodaj]');
    if (!b) return;
    const n = Number(b.dataset.dodaj);
    document.getElementById('sklop-' + n).hidden = false;
    b.hidden = true;
    const naslednji = document.getElementById('dodaj-' + (n + 1));
    if (naslednji) naslednji.hidden = false;
    document.getElementById('o' + n + '_opis').focus();
  });

  function podatki() {
    const fd = new FormData(f);
    const out = {};
    for (const [k, v] of fd.entries()) {
      if (k.endsWith('_kako')) (out[k] = out[k] || []).push(v);
      else out[k] = v;
    }
    out.gdpr_consent = document.getElementById('gdpr').checked;
    return out;
  }

  // Ista pravila kot streznik, da napaka pokaze na polje, preden gre oddaja.
  function prvoManjkajoce() {
    const vrednost = (ime) => {
      const el = f.elements[ime];
      if (!el) return '';
      if (el instanceof RadioNodeList) return [...el].some(x => x.checked) ? 'x' : '';
      return el.value.trim();
    };
    if (!vrednost('delovno_mesto')) return f.elements.delovno_mesto;
    for (let n = 1; n <= ${MAX_OPRAVIL}; n++) {
      const s = document.getElementById('sklop-' + n);
      if (s.hidden) continue;
      const zacet = n === 1 || ['opis', 'pogostost', 'cas', 'pomocnik'].some(p => vrednost('o' + n + '_' + p))
        || s.querySelector('input[type=checkbox]:checked');
      if (!zacet) continue;
      for (const p of ['opis', 'pogostost', 'cas']) {
        if (!vrednost('o' + n + '_' + p)) {
          const el = f.elements['o' + n + '_' + p];
          return el instanceof RadioNodeList ? el[0] : el;
        }
      }
    }
    return null;
  }

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.remove('is-on');
    const manjka = prvoManjkajoce();
    if (manjka) return pokaziNapako(SPOROCILA.manjka, manjka);
    if (!document.getElementById('gdpr').checked) return pokaziNapako(SPOROCILA.gdpr_consent_required, document.getElementById('gdpr'));
    gumb.disabled = true;
    gumb.textContent = 'Pošiljam …';
    try {
      const res = await fetch(location.pathname, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(podatki()),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.ok) {
        const el = r.polje && f.elements[r.polje];
        pokaziNapako(SPOROCILA[r.error] || 'Oddaja ni uspela. Poskusite znova.', el instanceof RadioNodeList ? el[0] : el);
        return;
      }
      f.hidden = true; noga.hidden = true; hvala.hidden = false;
      window.scrollTo({ top: 0 });
      hvala.querySelector('h1').focus({ preventScroll: true });
    } catch {
      pokaziNapako('Povezava s strežnikom ni uspela. Preverite internet in poskusite znova.');
    } finally {
      gumb.disabled = false;
      gumb.textContent = 'Pošlji odgovor';
    }
  });

  // Nov odgovor: oddelek, ime in soglasje ostanejo, opravila se izpraznijo.
  document.getElementById('znova').addEventListener('click', () => {
    for (let n = 1; n <= ${MAX_OPRAVIL}; n++) {
      const s = document.getElementById('sklop-' + n);
      s.querySelectorAll('textarea').forEach(t => { t.value = ''; });
      s.querySelectorAll('input').forEach(i => { i.checked = false; });
      s.hidden = n > 1;
      const d = document.getElementById('dodaj-' + n);
      if (d) d.hidden = n !== 2;
    }
    hvala.hidden = true; f.hidden = false; noga.hidden = false;
    window.scrollTo({ top: 0 });
    document.getElementById('o1_opis').focus({ preventScroll: true });
  });
})();`;

// ── DEL 4: Rute ───────────────────────────────────────────────────────────

router.get('/popis/:koda', async (req, res) => {
  zasebneGlave(res);
  res.type('html');
  const podjetje = await podjetjeIzKode(String(req.params.koda || ''));
  if (!podjetje) return res.status(404).send(neveljavnaHtml());
  res.send(obrazecHtml(podjetje, req.params.koda));
});

router.post('/popis/:koda', async (req, res) => {
  zasebneGlave(res);
  const podjetje = await podjetjeIzKode(String(req.params.koda || ''));
  if (!podjetje) return res.status(404).json({ ok: false, error: 'not_found' });

  const payload = req.body || {};
  if (payload[HONEYPOT_FIELD]) {
    console.log(`[popis] honeypot, company=${podjetje.id}`);
    return res.json({ ok: true });
  }
  const consent = payload.gdpr_consent === true || payload.gdpr_consent === 'on';
  if (!consent) return res.status(400).json({ ok: false, error: 'gdpr_consent_required' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const ipHash = hashIp(ip);
  if (prevec(ipHash)) return res.status(429).json({ ok: false, error: 'too_many_requests' });

  const oddaja = preveriOddajo(payload);
  if (!oddaja.ok) return res.status(400).json({ ok: false, error: oddaja.napaka, polje: oddaja.polje });

  const q = await dbQuery('SELECT id FROM questionnaires WHERE slug = $1 AND aktivna', [POPIS_SLUG]);
  const qid = q?.rows?.[0]?.id;
  if (!qid) return res.status(503).json({ ok: false, error: 'inactive' });

  const ins = await dbQuery(
    `INSERT INTO responses (company_id, questionnaire_id, raw_data, ip_hash, consent_gdpr, questions_snapshot)
     VALUES ($1, $2, $3, $4, TRUE, $5) RETURNING id`,
    [podjetje.id, qid, JSON.stringify(oddaja.raw), ipHash, JSON.stringify(VPRASANJA)],
  );
  const responseId = ins?.rows?.[0]?.id;
  if (!responseId) return res.status(500).json({ ok: false, error: 'save_failed' });
  await dbQuery('UPDATE companies SET last_response_at = NOW() WHERE id = $1', [podjetje.id]);
  console.log(`[popis] shranjeno: company=${podjetje.id} response=${responseId}`);
  res.json({ ok: true });
});

export { router };
