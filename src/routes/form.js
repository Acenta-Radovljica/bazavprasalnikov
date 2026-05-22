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
<style>
  *,*::before,*::after{box-sizing:border-box;}
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:${BARVE.bg};color:${BARVE.dark};margin:0;padding:2rem 1rem;line-height:1.5;}
  .wrap{max-width:680px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.06);overflow:hidden;}
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
    <div class="agency">Acenta.si</div>
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
      // Uspeh — zamenjaj vsebino s "hvala" sporocilom
      document.querySelector('.wrap').innerHTML = \`
        <div class="header">
          <div class="agency">Acenta.si</div>
          <h1>Hvala za vaš odgovor!</h1>
        </div>
        <div style="padding:2rem;">
          <p>Vaš odgovor smo prejeli. Acenta ekipa ga bo pregledala in se vam oglasila pred delavnico.</p>
          <p>Za vprašanja: <a href="mailto:info@acenta.si" style="color:${BARVE.teal};">info@acenta.si</a></p>
        </div>
      \`;
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
  if (!slug) return res.status(400).send('Manjka slug');

  const r = await dbQuery(
    'SELECT slug, naziv_prikaz, opis, questions, aktivna FROM questionnaires WHERE slug = $1',
    [slug]
  );
  if (!r?.rows?.length) return res.status(404).send('Vprašalnik ne obstaja.');

  const q = r.rows[0];
  if (!q.aktivna) {
    return res.status(410).send('Ta vprašalnik trenutno ni aktiven.');
  }

  const questions = Array.isArray(q.questions) ? q.questions : [];
  if (questions.length === 0) {
    return res.status(503).send('Vprašalnik še nima definiranih vprašanj.');
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
