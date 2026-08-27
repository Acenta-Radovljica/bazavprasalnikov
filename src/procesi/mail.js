// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { renderirajIzpolnjen } from './render.js';
import { renderirajHtml } from '../pdf/render.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const API_URL        = 'https://api.resend.com/emails';

// Odgovori naj gredo VEDNO na ai@acenta.si (agencijsko pravilo za vse obrazce
// in dopise), ne na osebni naslov komercialista.
const REPLY_TO   = process.env.PROCESI_REPLY_TO || 'ai@acenta.si';
const FROM_EMAIL = process.env.RESEND_FROM || 'Acenta <onboarding@resend.dev>';

// Kopija nam sami, da imamo dopis tudi v svojem nabiralniku.
const BCC_EMAIL = process.env.PROCESI_BCC || 'ai@acenta.si';

const TIMEOUT_MS = 20000;

// Zelo ohlapna, a zadostna oblika e-naslova. Namen ni popolna skladnost z
// RFC 5322, ampak ustaviti tipkarske napake, preden gre dopis stranki.
const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

function veljavenEmail(s) {
  return typeof s === 'string' && EMAIL_REGEX.test(s.trim());
}

// Privzeto spremno besedilo. Vikanje, pozdrav "Pozdravljeni," (agencijski
// standard), brez obljub rezultatov in brez datumov, ki jih ni v zapisu.
function privzetoSporocilo(seja) {
  const proces = seja?.proces ? ` za proces ${seja.proces}` : '';
  return [
    'Pozdravljeni,',
    '',
    `hvala za sestanek. V prilogi in spodaj pošiljamo zapis, ki smo ga pripravili na podlagi našega pogovora${proces}.`,
    '',
    'Prosimo, da zapis pregledate in nam sporočite, če smo kaj razumeli napačno ali če želite kaj dopolniti. Zapis je podlaga za naslednji korak, zato je pomembno, da se v njem prepoznate.',
    '',
    'Lep dan,',
    'Ekipa Acenta',
  ].join('\n');
}

// Sestavi HTML telo emaila: spremno besedilo + izpolnjen vprasalnik.
// Vse inline stili — glej opombo v src/procesi/render.js.
function sestaviTelo({ seja, sporocilo }) {
  const uvod = String(sporocilo || '')
    .split('\n')
    .map(v => v.trim()
      ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3d3d4a;">${
          v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        }</p>`
      : '')
    .join('');

  const dokument = renderirajIzpolnjen({ seja, namen: 'stranka' });

  // Iz celotnega dokumenta vzamemo samo vsebino <body>, da ne gnezdimo
  // dveh <html> dokumentov v isti email.
  const m = dokument.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const telo = m ? m[1] : dokument;

  return `<!DOCTYPE html>
<html lang="sl">
<head><meta charset="utf-8" /></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#ffffff;color:#15151f;margin:0;padding:24px;">
  <div style="max-width:720px;margin:0 auto;">
    ${uvod}
    <div style="margin:26px 0 0;padding-top:22px;border-top:1px solid #ece9e1;"></div>
    ${telo}
  </div>
</body>
</html>`;
}

// Varno ime datoteke za priponko (brez sumnikov, presledkov in locil).
function imeDatoteke(seja) {
  const osnova = [seja?.stranka_naziv, seja?.proces].filter(Boolean).join(' ') || 'zapis';
  const brezSumnikov = osnova
    .replace(/[čć]/gi, 'c').replace(/š/gi, 's').replace(/ž/gi, 'z')
    .replace(/đ/gi, 'd');
  const slug = brezSumnikov
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'zapis';
  return `${slug}-ocena-ai.pdf`;
}

// ── DEL 4: Zapis v revizijsko sled ───────────────────────────────────────

async function zabelezi({ session_id, prejemnik, zadeva, status, resend_id = null, napaka = null, poslal = null }) {
  await dbQuery(`
    INSERT INTO process_emails (session_id, prejemnik, zadeva, status, resend_id, napaka, poslal)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [session_id, prejemnik, zadeva, status, resend_id, napaka, poslal]);
}

// ── DEL 5: Glavna exported funkcija ──────────────────────────────────────

// Poslji izpolnjen vprasalnik STRANKI.
//
// To je edina funkcija v projektu, ki posilja posto ZUNANJEMU naslovniku,
// zato se obnasa drugace od src/lib/mailer.js:
//   - napake vrne klicatelju namesto da bi jih tiho pogoltnila (uporabnik je
//     kliknil "poslji" in mora izvedeti, ali je slo);
//   - vsak poskus, tudi neuspesen, zabelezi v process_emails;
//   - manjkajoc kljuc je NAPAKA, ne "preskocim" (drugace bi komercialist
//     mislil, da je stranka dopis dobila).
//
// Vrne { ok, resend_id, napaka }.
async function posljiStranki({
  seja,
  prejemnik,
  zadeva = null,
  sporocilo = null,
  priloziPdf = true,
  poslal = null,
}) {
  if (!seja?.id) return { ok: false, resend_id: null, napaka: 'seja_manjka' };

  const naslovnik = String(prejemnik || '').trim();
  if (!veljavenEmail(naslovnik)) {
    return { ok: false, resend_id: null, napaka: 'neveljaven_email' };
  }

  const konencnaZadeva = String(zadeva || '').trim()
    || `Zapis sestanka — ${seja.stranka_naziv}${seja.proces ? ` (${seja.proces})` : ''}`;
  const besedilo = String(sporocilo || '').trim() || privzetoSporocilo(seja);

  if (!RESEND_API_KEY || RESEND_API_KEY.includes('vstavi')) {
    await zabelezi({
      session_id: seja.id, prejemnik: naslovnik, zadeva: konencnaZadeva,
      status: 'napaka', napaka: 'resend_kljuc_ni_nastavljen', poslal,
    });
    return { ok: false, resend_id: null, napaka: 'resend_kljuc_ni_nastavljen' };
  }

  const html = sestaviTelo({ seja, sporocilo: besedilo });

  // PDF priponka je zelena, ne obvezna: ce chromium na strezniku ni na voljo,
  // dopis vseeno posljemo (vsebina je tudi v telesu emaila).
  let priponke;
  if (priloziPdf) {
    const pdf = await renderirajHtml(renderirajIzpolnjen({ seja, namen: 'stranka' }));
    if (pdf) {
      priponke = [{ filename: imeDatoteke(seja), content: Buffer.from(pdf).toString('base64') }];
    } else {
      console.warn(`[procesi/mail] PDF za sejo ${seja.id} se ni izdelal — posiljam brez priponke`);
    }
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [naslovnik],
        ...(BCC_EMAIL ? { bcc: [BCC_EMAIL] } : {}),
        reply_to: REPLY_TO,
        subject: konencnaZadeva,
        html,
        ...(priponke ? { attachments: priponke } : {}),
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const besediloNapake = await res.text().catch(() => '');
      const napaka = `http_${res.status}: ${besediloNapake.slice(0, 200)}`;
      console.error('[procesi/mail]', napaka);
      await zabelezi({
        session_id: seja.id, prejemnik: naslovnik, zadeva: konencnaZadeva,
        status: 'napaka', napaka, poslal,
      });
      return { ok: false, resend_id: null, napaka };
    }

    const data = await res.json().catch(() => ({}));
    const resendId = data?.id ?? null;

    await zabelezi({
      session_id: seja.id, prejemnik: naslovnik, zadeva: konencnaZadeva,
      status: 'poslan', resend_id: resendId, poslal,
    });

    // Sejo oznacimo kot poslano. 'zakljucen' -> 'poslan'; ce je bila ze
    // 'poslan', ostane. Status 'arhiv' NAMENOMA ne povozimo.
    await dbQuery(`
      UPDATE process_sessions
         SET status = 'poslan', updated_at = NOW()
       WHERE id = $1 AND status IN ('osnutek', 'zakljucen', 'poslan')
    `, [seja.id]);

    console.log(`[procesi/mail] seja ${seja.id} -> ${naslovnik} (resendId=${resendId || '?'})`);
    return { ok: true, resend_id: resendId, napaka: null };

  } catch (err) {
    const napaka = err.name === 'AbortError' ? 'timeout' : err.message;
    console.error('[procesi/mail] napaka:', napaka);
    await zabelezi({
      session_id: seja.id, prejemnik: naslovnik, zadeva: konencnaZadeva,
      status: 'napaka', napaka, poslal,
    });
    return { ok: false, resend_id: null, napaka };
  } finally {
    clearTimeout(t);
  }
}

// ── DEL 6: Named exports ─────────────────────────────────────────────────
export { posljiStranki, privzetoSporocilo, sestaviTelo, veljavenEmail, imeDatoteke };
