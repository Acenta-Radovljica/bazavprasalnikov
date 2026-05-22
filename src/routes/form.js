// ── DEL 1: Imports ────────────────────────────────────────────────────────
import express from 'express';
import { dbQuery } from '../db.js';
import { hashIp } from '../utils/normalize.js';
import { najdiPodjetjeAI } from '../ai/match_company.js';
import { sproziPovzetek } from '../ai/queue.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const router = express.Router();

// Acenta brand barve — usklajeno z admin UI in PDF brandingom.
const BARVE = {
  teal: '#00b894',
  dark: '#1a1a2e',
  bg: '#f8f9fa',
};

// Honeypot polje: ce robot napolni to skrito polje, ga zavrnemo.
// Pravi uporabniki ga ne vidijo. Ime je "company_url" — robotom zveni vredu.
const HONEYPOT_FIELD = 'company_url';

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// HTML-escape (XSS proti). Vse, kar gre v HTML iz baze ali user inputa,
// MORA skozi to. Krit za labele in option besedila, ki jih admin definira.
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Branded error/info page — uporabljen za 404, 410 (ugasnjen), 503 (brez vprasanj).
// Razlog: plain text "Vprašalnik ne obstaja." izgleda kot 1990s, klient ne sme
// videti necesar tako negolega. Acenta brand z navy/teal in povezavo nazaj.
function renderirajInfoStran({ naslov, sporocilo, koda = 503 }) {
  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(naslov)} — Acenta</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;}
  body{
    font-family:'Inter',-apple-system,Segoe UI,Roboto,sans-serif;
    background:#fcfbf9; color:#15151f; margin:0; min-height:100vh;
    display:flex; align-items:center; justify-content:center; padding:2rem 1rem;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{
    max-width:520px; width:100%; background:#fff; border-radius:22px;
    box-shadow:0 1px 2px rgba(20,18,12,.04), 0 18px 40px -18px rgba(20,18,12,.18);
    overflow:hidden; position:relative;
  }
  .wrap::before{
    content:''; position:absolute; inset:0; border-radius:inherit; padding:1px;
    background:linear-gradient(160deg, rgba(0,184,148,.35) 0%, rgba(236,233,225,1) 35%);
    -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite:xor; mask-composite:exclude; pointer-events:none;
  }
  .header{background:#15151f; color:#fff; padding:2.25rem 2.5rem;}
  .header-logo{display:inline-block; background:#fff; padding:10px 18px;
    border-radius:10px; margin-bottom:1.75rem;
    box-shadow:0 6px 18px -4px rgba(0,0,0,.4);
  }
  .header-logo img{height:36px; width:auto; display:block;}
  .agency{font-size:.7rem; opacity:.55; letter-spacing:.18em; text-transform:uppercase; font-weight:500;}
  .header h1{
    font-family:'Fraunces',serif; font-weight:500; margin:.5rem 0 0;
    font-size:2rem; letter-spacing:-.025em;
  }
  .body{padding:2rem 2.5rem;}
  .koda{font-size:.75rem; color:#8a8a95; letter-spacing:.1em; text-transform:uppercase; font-weight:500;}
  .sporocilo{margin:1rem 0 1.5rem; color:#3a3a48; line-height:1.6;}
  .back{
    display:inline-block; padding:10px 18px; border-radius:12px;
    background:#00b894; color:#fff; text-decoration:none; font-weight:600; font-size:14px;
    box-shadow:0 6px 14px -4px rgba(0,184,148,.4); transition:transform .15s, box-shadow .15s;
  }
  .back:hover{transform:translateY(-1px); box-shadow:0 10px 20px -6px rgba(0,184,148,.45);}
  .footer{
    padding:1rem 2.5rem; background:#f5f3ee; text-align:center;
    font-size:.8rem; color:#8a8a95;
  }
  .footer a{color:#006e5a; text-decoration:none; font-weight:500;}
</style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="header-logo">
        <img src="/assets/acenta-logo.png" alt="Acenta — Učinkovite rešitve" />
      </div>
      <h1>${esc(naslov)}</h1>
    </div>
    <div class="body">
      <div class="koda">Status ${esc(String(koda))}</div>
      <p class="sporocilo">${esc(sporocilo)}</p>
      <a href="https://acenta.si" class="back">Obišči acenta.si</a>
    </div>
    <div class="footer">
      Vprašanja? <a href="mailto:info@acenta.si">info@acenta.si</a>
    </div>
  </div>
</body>
</html>`;
}

function posljiInfo(res, koda, naslov, sporocilo) {
  res.status(koda).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderirajInfoStran({ naslov, sporocilo, koda }));
}

// Renderiraj eno vprasanje glede na tip. Vrne HTML string.
function renderirajVprasanje(q) {
  const id = esc(q.id);
  const label = esc(q.label);
  const required = q.obvezno ? 'required' : '';
  const star = q.obvezno ? '<span style="color:#e74c3c;">*</span>' : '';

  let polje = '';
  switch (q.tip) {
    case 'text':
      polje = `<input type="text" id="f-${id}" name="${id}" ${required} />`;
      break;
    case 'email':
      polje = `<input type="email" id="f-${id}" name="${id}" ${required} />`;
      break;
    case 'number':
      polje = `<input type="number" id="f-${id}" name="${id}" ${required} />`;
      break;
    case 'textarea':
      polje = `<textarea id="f-${id}" name="${id}" rows="4" ${required}></textarea>`;
      break;
    case 'select': {
      const opts = (q.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
      polje = `<select id="f-${id}" name="${id}" ${required}><option value="">— izberite —</option>${opts}</select>`;
      break;
    }
    case 'radio': {
      const radios = (q.options || []).map((o, i) =>
        `<label class="opt"><input type="radio" name="${id}" value="${esc(o)}" ${required && i === 0 ? 'required' : ''} /> ${esc(o)}</label>`
      ).join('');
      polje = `<div class="opts">${radios}</div>`;
      break;
    }
    case 'checkbox': {
      const checks = (q.options || []).map(o =>
        `<label class="opt"><input type="checkbox" name="${id}" value="${esc(o)}" /> ${esc(o)}</label>`
      ).join('');
      polje = `<div class="opts">${checks}</div>`;
      break;
    }
    default:
      polje = `<input type="text" id="f-${id}" name="${id}" ${required} />`;
  }

  return `
    <div class="vprasanje">
      <label for="f-${id}" class="lbl">${label} ${star}</label>
      ${polje}
    </div>
  `;
}

// Renderiraj cel obrazec HTML.
function renderirajObrazec({ slug, naziv_prikaz, opis, questions }) {
  const vprasanjaHtml = questions.map(renderirajVprasanje).join('\n');

  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(naziv_prikaz)} — Acenta</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;}
  body{font-family:'Inter',-apple-system,Segoe UI,Roboto,sans-serif;background:${BARVE.bg};color:${BARVE.dark};margin:0;padding:2rem 1rem;line-height:1.5;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:680px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.06);overflow:hidden;}
  /* Logo badge v temnem hederju (bel pill z drop shadow, ohrani brand barve) */
  .header-logo{display:inline-block;background:#fff;padding:10px 18px;border-radius:10px;margin-bottom:1.75rem;box-shadow:0 6px 18px -4px rgba(0,0,0,.4);}
  .header-logo img{height:36px;width:auto;display:block;}
  /* Hvala stran — premium agency styling */
  .thanks{padding:0;}
  .thanks-hero{background:linear-gradient(135deg,#15151f 0%,#1a1a2e 100%);color:#fff;padding:2.5rem 2.5rem 2.75rem;text-align:center;position:relative;overflow:hidden;}
  .thanks-hero::before{content:'';position:absolute;top:-100px;right:-100px;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(0,184,148,.25) 0%,transparent 70%);}
  .thanks-logo{position:relative;display:flex;justify-content:center;margin-bottom:2rem;}
  .thanks-logo .badge{background:#fff;padding:10px 18px;border-radius:10px;box-shadow:0 6px 18px -4px rgba(0,0,0,.4);display:inline-block;}
  .thanks-logo img{height:36px;width:auto;display:block;}
  .thanks-check{position:relative;width:64px;height:64px;margin:0 auto 1.25rem;background:#00b894;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 12px 32px -8px rgba(0,184,148,.6);}
  .thanks-check svg{width:32px;height:32px;color:#fff;}
  .thanks-eyebrow{position:relative;font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;opacity:.7;font-weight:500;}
  .thanks-title{position:relative;font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:2.25rem;letter-spacing:-.025em;margin:.5rem 0 .25rem;font-variation-settings:'opsz' 144,'SOFT' 50;}
  .thanks-sub{position:relative;opacity:.8;font-size:1rem;max-width:440px;margin:0 auto;}
  .thanks-body{padding:2.5rem 2.5rem 1.5rem;}
  .thanks-details{background:#fcfbf9;border:1px solid #ece9e1;border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1.75rem;}
  .thanks-detail-row{display:flex;justify-content:space-between;align-items:center;font-size:.95rem;padding:.4rem 0;}
  .thanks-detail-row + .thanks-detail-row{border-top:1px solid #ece9e1;}
  .thanks-detail-row .lbl{color:#8a8a95;font-weight:500;font-size:.85rem;}
  .thanks-detail-row .val{color:#15151f;font-weight:600;text-align:right;}
  .thanks-next h2{font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:1.25rem;letter-spacing:-.015em;color:#15151f;margin:0 0 1rem;}
  .thanks-steps{list-style:none;padding:0;margin:0;}
  .thanks-steps li{display:flex;gap:1rem;padding:.85rem 0;border-bottom:1px solid #ece9e1;}
  .thanks-steps li:last-child{border-bottom:none;}
  .thanks-steps .num{flex-shrink:0;width:28px;height:28px;border-radius:50%;background:#fcfbf9;border:1px solid #ece9e1;color:#006e5a;font-family:'Fraunces',serif;font-weight:500;display:flex;align-items:center;justify-content:center;font-size:.85rem;}
  .thanks-steps .text{font-size:.95rem;color:#3a3a48;line-height:1.5;padding-top:.15rem;}
  .thanks-contact{text-align:center;margin-top:1.5rem;padding-top:1.5rem;border-top:1px solid #ece9e1;font-size:.9rem;color:#8a8a95;}
  .thanks-contact a{color:#006e5a;text-decoration:none;font-weight:600;}
  .thanks-contact a:hover{color:#00b894;}
  .header{background:${BARVE.dark};color:#fff;padding:2rem;}
  .header h1{margin:0 0 .25rem;font-size:1.75rem;}
  .header .agency{font-size:.85rem;opacity:.7;letter-spacing:.05em;text-transform:uppercase;}
  .header .opis{margin-top:1rem;opacity:.85;}
  form{padding:2rem;}
  .vprasanje{margin-bottom:1.5rem;}
  .lbl{display:block;font-weight:600;margin-bottom:.5rem;}
  input[type=text],input[type=email],input[type=number],textarea,select{
    width:100%;padding:.75rem;border:1px solid #d1d5db;border-radius:6px;font:inherit;background:#fff;
  }
  input:focus,textarea:focus,select:focus{outline:none;border-color:${BARVE.teal};box-shadow:0 0 0 3px rgba(0,184,148,.15);}
  textarea{resize:vertical;min-height:100px;}
  .opts{display:flex;flex-direction:column;gap:.5rem;}
  .opt{display:flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:400;}
  .opt input{margin:0;}
  .gdpr{margin:1.5rem 0;padding:1rem;background:${BARVE.bg};border-radius:6px;font-size:.9rem;}
  .gdpr label{display:flex;align-items:flex-start;gap:.5rem;cursor:pointer;}
  .gdpr input{margin-top:.2rem;}
  .submit{display:block;width:100%;padding:1rem;background:${BARVE.teal};color:#fff;border:none;border-radius:6px;font-size:1rem;font-weight:600;cursor:pointer;transition:opacity .15s;}
  .submit:hover{opacity:.9;}
  .submit:disabled{opacity:.5;cursor:not-allowed;}
  /* Honeypot — skrit za uporabnike, viden za bote */
  .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;}
  .footer{padding:1rem 2rem;background:${BARVE.bg};text-align:center;font-size:.8rem;color:#6b7280;}
  .footer a{color:${BARVE.teal};text-decoration:none;}
  .err{background:#fee;color:#c00;padding:1rem;border-radius:6px;margin-bottom:1rem;display:none;}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="header-logo">
      <img src="/assets/acenta-logo.png" alt="Acenta — Učinkovite rešitve" />
    </div>
    <h1>${esc(naziv_prikaz)}</h1>
    ${opis ? `<div class="opis">${esc(opis)}</div>` : ''}
  </div>

  <form id="vprasalnik" method="POST" action="/f/${esc(slug)}">
    <div class="err" id="err"></div>

    ${vprasanjaHtml}

    <!-- Honeypot — bot vneso, clovek nikoli -->
    <div class="hp" aria-hidden="true">
      <label for="hp">Ne izpolnjujte tega polja</label>
      <input type="text" id="hp" name="${HONEYPOT_FIELD}" tabindex="-1" autocomplete="off" />
    </div>

    <div class="gdpr">
      <label>
        <input type="checkbox" name="gdpr_consent" required />
        <span>Strinjam se s shranjevanjem mojih odgovorov za namene priprave delavnice in komunikacijo z Acenta.si. Podatki se ne posredujejo tretjim osebam.</span>
      </label>
    </div>

    <button type="submit" class="submit">Pošlji odgovor</button>
  </form>

  <div class="footer">
    <a href="https://acenta.si" target="_blank">Acenta.si</a> — digitalna agencija za turizem
  </div>
</div>

<script>
  // Pretvori form v JSON in poslji prek fetch — boljse error handling kot navadni POST.
  const form = document.getElementById('vprasalnik');
  const errBox = document.getElementById('err');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.style.display = 'none';
    const btn = form.querySelector('.submit');
    btn.disabled = true;
    btn.textContent = 'Pošiljam...';

    const fd = new FormData(form);
    // Zlozi v objekt + zdruzi vec vrednosti iz checkbox v array
    const data = {};
    for (const key of fd.keys()) {
      const vals = fd.getAll(key);
      data[key] = vals.length > 1 ? vals : vals[0];
    }

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'submit_failed');
      }
      // Uspeh — zamenjaj vsebino s personaliziranim "Hvala" zaslonom.
      // Iz form podatkov izlusci ime + podjetje + email za prikaz potrditve.
      const escHtml = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      const ime      = data['1_ime_priimek'] || data.ime_priimek || data.ime || '';
      const podjetje = data['2_podjetje']    || data.podjetje    || '';
      const email    = data['3_email']       || data.email       || '';
      const prviIme  = (ime || '').trim().split(/\\s+/)[0] || '';

      const detailRows = [];
      if (podjetje) detailRows.push(\`<div class="thanks-detail-row"><span class="lbl">Podjetje</span><span class="val">\${escHtml(podjetje)}</span></div>\`);
      if (ime)      detailRows.push(\`<div class="thanks-detail-row"><span class="lbl">Kontakt</span><span class="val">\${escHtml(ime)}</span></div>\`);
      if (email)    detailRows.push(\`<div class="thanks-detail-row"><span class="lbl">Email</span><span class="val">\${escHtml(email)}</span></div>\`);

      document.querySelector('.wrap').innerHTML = \`
        <div class="thanks">
          <div class="thanks-hero">
            <div class="thanks-logo">
              <div class="badge">
                <img src="/assets/acenta-logo.png" alt="Acenta — Učinkovite rešitve" />
              </div>
            </div>
            <div class="thanks-check">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
            <h1 class="thanks-title">Hvala\${prviIme ? ', ' + escHtml(prviIme) : ''}!</h1>
            <p class="thanks-sub">Vaše odgovore smo prejeli. Acenta ekipa jih bo skrbno pregledala in pripravila personalizirana priporočila pred delavnico.</p>
          </div>
          <div class="thanks-body">
            \${detailRows.length ? \`<div class="thanks-details">\${detailRows.join('')}</div>\` : ''}
            <div class="thanks-next">
              <h2>Kaj sledi?</h2>
              <ol class="thanks-steps">
                <li><span class="num">1</span><span class="text">Naš AI sistem v naslednjih minutah pripravi povzetek vaših odgovorov.</span></li>
                <li><span class="num">2</span><span class="text">Strokovnjak iz Acente pregleda vaše odgovore in pripravi konkretna priporočila za vaš posel.</span></li>
                <li><span class="num">3</span><span class="text">V 2&ndash;3 delovnih dneh vas kontaktiramo z naslednjimi koraki in predlogom termina delavnice.</span></li>
              </ol>
            </div>
            <div class="thanks-contact">
              Vprašanja? Pišite na <a href="mailto:info@acenta.si">info@acenta.si</a>
            </div>
          </div>
        </div>
      \`;
      // Scroll na vrh, da uporabnik vidi celotno potrditev
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      errBox.textContent = 'Napaka pri pošiljanju: ' + err.message + '. Poskusite znova ali kontaktirajte info@acenta.si.';
      errBox.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Pošlji odgovor';
    }
  });
</script>
</body>
</html>`;
}

// Izlusci podjetje iz submission-a — najprej preverja "ime_podjetja" iz
// custom obrazcev, potem fallback varianti kot v Formspree.
function izlusciPodjetje(payload, questions) {
  // Najprej probaj polja, ki so v questions oznacena kot "polje_podjetja" — TODO
  // Za zdaj iscemo standardne kljuce.
  const keys = ['podjetje', 'ime_podjetja', 'company', '2_podjetje'];
  for (const k of keys) {
    if (payload[k] && typeof payload[k] === 'string' && payload[k].trim()) {
      return payload[k].trim();
    }
  }
  // Fallback: ce ima questions polje z id "podjetje*"
  if (Array.isArray(questions)) {
    for (const q of questions) {
      if (q.id && /podjetje|company/i.test(q.id) && payload[q.id]) {
        return String(payload[q.id]).trim();
      }
    }
  }
  return `NEZNANO_PODJETJE_${Date.now()}`;
}

// ── DEL 4: Glavne rute ────────────────────────────────────────────────────

// GET /f/:slug — javni obrazec
router.get('/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (!slug) return posljiInfo(res, 400, 'Manjkajoč podatek', 'V URL-ju manjka slug vprašalnika.');

  const r = await dbQuery(
    'SELECT slug, naziv_prikaz, opis, questions, aktivna FROM questionnaires WHERE slug = $1',
    [slug]
  );
  if (!r?.rows?.length) {
    return posljiInfo(res, 404, 'Vprašalnik ne obstaja',
      'URL ne ustreza nobenemu obrazcu. Preverite povezavo, ki ste jo prejeli, ali se obrnite na info@acenta.si.');
  }

  const q = r.rows[0];
  if (!q.aktivna) {
    return posljiInfo(res, 410, 'Vprašalnik je ugasnjen',
      'Ta vprašalnik trenutno ne sprejema novih odgovorov. Če ste prejeli povezavo nedavno, kontaktirajte Acenta ekipo.');
  }

  const questions = Array.isArray(q.questions) ? q.questions : [];
  if (questions.length === 0) {
    return posljiInfo(res, 503, 'Vprašalnik še ni pripravljen',
      'Vprašanja so v pripravi. Povezava bo aktivna kmalu — počakajte nekaj minut ali pišite na info@acenta.si.');
  }

  const html = renderirajObrazec({
    slug: q.slug,
    naziv_prikaz: q.naziv_prikaz,
    opis: q.opis,
    questions,
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// POST /f/:slug — sprejem submission
router.post('/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  if (!slug) return res.status(400).json({ ok: false, error: 'missing_slug' });

  // Najdi vprasalnik (mora biti aktiven)
  const r = await dbQuery(
    'SELECT id, questions, aktivna FROM questionnaires WHERE slug = $1',
    [slug]
  );
  if (!r?.rows?.length) return res.status(404).json({ ok: false, error: 'not_found' });
  if (!r.rows[0].aktivna) return res.status(410).json({ ok: false, error: 'inactive' });

  const questionnaireId = r.rows[0].id;
  const questions = Array.isArray(r.rows[0].questions) ? r.rows[0].questions : [];
  const payload = req.body || {};

  // Honeypot anti-spam: ce je polje izpolnjeno, vrnemo 200 OK ampak ne shranimo.
  // (Ne 403 — robot mora misliti, da je uspelo, da ne poskusi spet.)
  if (payload[HONEYPOT_FIELD]) {
    console.log(`[form/${slug}] honeypot trigger from IP=${req.ip}`);
    return res.json({ ok: true, _hp: true });
  }

  // GDPR
  const consent = payload.gdpr_consent === 'on' || payload.gdpr_consent === true;
  if (!consent) return res.status(400).json({ ok: false, error: 'gdpr_consent_required' });

  // Server-side validacija obveznih polj (klient lahko obide HTML required)
  for (const q of questions) {
    if (q.obvezno) {
      const v = payload[q.id];
      const prazno = v === undefined || v === null || v === '' ||
        (Array.isArray(v) && v.length === 0);
      if (prazno) {
        return res.status(400).json({ ok: false, error: 'missing_required_field', field: q.id });
      }
    }
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const ipHash = hashIp(ip);

  const podjetje = izlusciPodjetje(payload, questions);
  const matchRes = await najdiPodjetjeAI(podjetje);
  if (!matchRes?.companyId) {
    return res.status(500).json({ ok: false, error: 'company_match_failed' });
  }
  const companyId = matchRes.companyId;

  // Deduplikacija po emailu (10 min)
  const email = String(payload.email || payload.ime_email || '').toLowerCase().trim();
  if (email) {
    const dup = await dbQuery(
      `SELECT id FROM responses
       WHERE company_id = $1 AND questionnaire_id = $2
         AND lower(raw_data->>'email') = $3
         AND submitted_at > NOW() - INTERVAL '10 minutes'
       LIMIT 1`,
      [companyId, questionnaireId, email]
    );
    if (dup?.rows?.length > 0) {
      return res.json({ ok: true, deduplicated: true });
    }
  }

  const inserted = await dbQuery(
    `INSERT INTO responses (company_id, questionnaire_id, raw_data, ip_hash, consent_gdpr)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [companyId, questionnaireId, JSON.stringify(payload), ipHash, consent]
  );

  await dbQuery('UPDATE companies SET last_response_at = NOW() WHERE id = $1', [companyId]);

  const responseId = inserted?.rows?.[0]?.id;
  console.log(`[form/${slug}] shranjeno: company=${companyId} response=${responseId}`);

  if (responseId) sproziPovzetek(responseId);

  res.json({ ok: true, responseId, companyId });
});

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { router };
