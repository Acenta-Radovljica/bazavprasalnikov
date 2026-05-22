// ── DEL 1: Imports ────────────────────────────────────────────────────────
// (dotenv ze nalozen v src/server.js — ne ponavljamo tukaj)

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL || 'ai@acenta.si';
const FROM_EMAIL     = process.env.RESEND_FROM  || 'Acenta Baza <onboarding@resend.dev>';
const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || 'https://nacrt-admin.deploy.acenta.si';
const API_URL        = 'https://api.resend.com/emails';

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// HTML escape — varno za vstavljanje uporabniskih vrednosti v email body.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sestavi HTML body emaila. Inline styling — email klienti pogosto ignorirajo <style>.
function sestaviHtml({ companyId, companyName, contactName, contactEmail, position, povzetek }) {
  const adminLink = `${ADMIN_BASE_URL}/admin/company.html?id=${companyId}`;
  const povzetekBlok = povzetek
    ? `<div style="background:#fcfbf9;border:1px solid #ece9e1;border-radius:12px;padding:20px;margin:20px 0;">
         <div style="font-family:'Fraunces',Georgia,serif;font-size:18px;color:#15151f;margin-bottom:12px;font-weight:500;">AI povzetek</div>
         <div style="white-space:pre-wrap;line-height:1.6;color:#3d3d4a;font-size:14px;">${esc(povzetek)}</div>
       </div>`
    : `<p style="color:#8a8a95;font-style:italic;">AI povzetek se se generira — preveri v adminu cez minuto.</p>`;

  return `<!DOCTYPE html>
<html lang="sl">
<head>
  <meta charset="utf-8"/>
  <title>Nov vprasalnik: ${esc(companyName)}</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#fff;color:#15151f;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="border-left:4px solid #00b894;padding-left:16px;margin-bottom:24px;">
      <div style="color:#8a8a95;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Nov izpolnjen vprasalnik</div>
      <h1 style="margin:6px 0 0;font-size:24px;font-weight:600;color:#15151f;">${esc(companyName)}</h1>
    </div>

    <table style="border-collapse:collapse;width:100%;margin-bottom:8px;font-size:14px;">
      <tr><td style="padding:6px 0;color:#8a8a95;width:120px;">Kontakt</td><td style="padding:6px 0;color:#15151f;">${esc(contactName)}</td></tr>
      <tr><td style="padding:6px 0;color:#8a8a95;">Email</td><td style="padding:6px 0;"><a href="mailto:${esc(contactEmail)}" style="color:#00b894;text-decoration:none;">${esc(contactEmail)}</a></td></tr>
      <tr><td style="padding:6px 0;color:#8a8a95;">Pozicija</td><td style="padding:6px 0;color:#15151f;">${esc(position)}</td></tr>
    </table>

    ${povzetekBlok}

    <a href="${adminLink}" style="display:inline-block;background:#00b894;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Odpri v adminu &rarr;</a>

    <div style="margin-top:40px;padding-top:16px;border-top:1px solid #ece9e1;color:#8a8a95;font-size:11px;">
      Acenta &middot; Baza vprasalnikov &middot; avtomatsko obvestilo
    </div>
  </div>
</body>
</html>`;
}

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────

// Posilja email obvestilo agenciji ko prispe nov izpolnjen vprasalnik.
// Klice se iz queue.js po koncanem AI povzetku (~10s po submit-u).
// Vrne resend id ali null ob napaki — nikoli ne throwa (fire-and-forget).
async function posljiObvestiloOdgovor({ companyId, companyName, contactName, contactEmail, position, povzetek }) {
  // Guard 1: ce ni API kljuca, samo zalogiraj in nadaljuj. Sistem dela tudi brez emaila.
  if (!RESEND_API_KEY || RESEND_API_KEY.includes('vstavi')) {
    console.log('[mailer] RESEND_API_KEY ni nastavljen — preskocim email');
    return null;
  }

  const subject = `Nov vprasalnik: ${companyName || '(brez podjetja)'}`;
  const html = sestaviHtml({ companyId, companyName, contactName, contactEmail, position, povzetek });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [NOTIFY_EMAIL],
        subject,
        html,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[mailer] HTTP ${res.status}:`, errText.slice(0, 300));
      return null;
    }

    const data = await res.json().catch(() => ({}));
    console.log(`[mailer] poslano company=${companyId} → ${NOTIFY_EMAIL} (resendId=${data.id || '?'})`);
    return data.id || null;
  } catch (err) {
    clearTimeout(timeout);
    console.error('[mailer] napaka:', err.message);
    return null;
  }
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { posljiObvestiloOdgovor };
