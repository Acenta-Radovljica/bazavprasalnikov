// AI Business Score -> the customer's mail with the results (Maja, 13. 10. 2026): sent from
// matjaz@acenta.si, subject "[AI Business Score] Vaši rezultati", her text with Matjaž's
// signature, the report attached as PDF.
//
// The PDF is the report page itself (/r/:token) printed by headless Chromium, so it is exactly
// what the customer gets with "Shrani kot PDF" and there is no second layout to keep in step.
// The outbox (outbox.js) calls this only once the AI text is settled and saved, otherwise the
// PDF would show the "Pišemo vašo analizo" waiting state.
//
// Sent through Resend with its own key (SCORE_MAIL_RESEND_KEY): the domain acenta.si is verified
// in the agency's Resend account (22. 9. 2026), the app's older RESEND_API_KEY is a send-only
// key of unknown origin that is used for internal notices. No key = the step waits (outbox).

import puppeteer from 'puppeteer-core';

const TIMEOUT_MS = 30_000;

export const imaMail = () => (process.env.SCORE_MAIL_RESEND_KEY || '').length >= 20;

const nastavitve = () => ({
  od: process.env.SCORE_MAIL_FROM || 'Matjaž Kristan <matjaz@acenta.si>',
  odgovor: process.env.SCORE_MAIL_REPLY_TO || 'matjaz@acenta.si',
  // Matjaž gets a blind copy: the mail is not in his Outlook "Sent" folder otherwise.
  // An empty value turns the copy off.
  bcc: (process.env.SCORE_MAIL_BCC ?? 'matjaz@acenta.si').split(',').map(s => s.trim()).filter(Boolean),
  api: process.env.SCORE_MAIL_API || 'https://api.resend.com/emails',
});

export const ZADEVA = '[AI Business Score] Vaši rezultati';

// Maja's text (13. 10. 2026), word for word, except the greeting: "Pozdravljeni," with a comma,
// because the next line goes on in lower case ("hvala, da ste ...").
const ODSTAVKI = [
  'Pozdravljeni,',
  'hvala, da ste izpolnili AI Business Score.',
  'Rezultate testa vam pošiljamo v priloženem PDF dokumentu. V njem boste našli pregled trenutne uporabe AI v vašem podjetju in priložnosti za nadaljnji razvoj.',
  'Če bi želeli rezultate skupaj pregledati ali se pogovoriti o naslednjih korakih, se lahko obrnete neposredno name. Z veseljem vam bom pomagal poiskati priložnosti, ki bodo vašemu podjetju pomagale prihraniti čas in denar.',
  'Lep pozdrav,',
];
// The empty entry is a blank line between the title and the company (Maks, 13. 10. 2026).
const PODPIS = ['Matjaž Kristan', 'Vodja prodaje', '', 'Acenta d.o.o.', 'Kranjska cesta 4, 4240 Radovljica', 'Tel: 041 669 785', 'E-naslov: matjaz@acenta.si'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// "AI Business Score - Kovinar d.o.o..pdf" is ugly and some characters are not allowed in file
// names on Windows; the company name stays readable, šumniki included.
export function imeDatoteke(podjetje) {
  const ime = String(podjetje || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.+$/, '').slice(0, 80);
  return `AI Business Score${ime ? ` - ${ime}` : ''}.pdf`;
}

// -> { subject, html, text }. Pure, so the test can check the words without sending anything.
export function sestaviMail() {
  const p = (t) => `<p style="margin:0 0 14px">${esc(t)}</p>`;
  const podpisHtml = PODPIS.map((v) => {
    if (v.startsWith('Tel: ')) return `Tel: <a href="tel:+38641669785" style="color:#1a1a1a;text-decoration:none">${esc(v.slice(5))}</a>`;
    if (v.startsWith('E-naslov: ')) return `E-naslov: <a href="mailto:matjaz@acenta.si" style="color:#1a1a1a">${esc(v.slice(10))}</a>`;
    return v === 'Matjaž Kristan' ? `<strong>${esc(v)}</strong>` : esc(v);
  }).join('<br>');
  const html = `<!DOCTYPE html><html lang="sl"><head><meta charset="utf-8"><title>${esc(ZADEVA)}</title></head>`
    + `<body style="margin:0;padding:0"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a;max-width:640px">`
    + ODSTAVKI.map(p).join('')
    + `<p style="margin:0">${podpisHtml}</p></div></body></html>`;
  const text = [...ODSTAVKI, PODPIS.join('\n')].join('\n\n') + '\n';
  return { subject: ZADEVA, html, text };
}

// ── PDF of the report page ────────────────────────────────────────────────
// One Chromium at a time: a burst of submissions after a mailing must not start four browsers
// next to the AI calls on a small server.
let vrsta = Promise.resolve();
export function pdfPorocila(token) {
  const naloga = vrsta.then(() => izrisi(token));
  vrsta = naloga.catch(() => {});
  return naloga;
}

async function izrisi(token) {
  const base = (process.env.SCORE_PDF_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754 });
    // No entrance animation: everything is in its final state when the page is printed.
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${base}/r/${encodeURIComponent(token)}`, { waitUntil: 'networkidle0', timeout: TIMEOUT_MS });
    await page.waitForFunction(
      () => !document.querySelector('#v-porocilo')?.hidden || !document.querySelector('#r-napaka')?.hidden,
      { timeout: TIMEOUT_MS },
    );
    const napaka = await page.$eval('#r-napaka', n => (n.hidden ? null : n.textContent));
    if (napaka) throw new Error(`porocilo: ${napaka}`);
    // The page swaps in the text it has and reveals every section on "beforeprint" (Shrani kot PDF).
    await page.evaluate(async () => { dispatchEvent(new Event('beforeprint')); await document.fonts.ready; });
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '0', right: '0' } }));
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── Sending ───────────────────────────────────────────────────────────────
// -> { ok: true, id } | { ok: false, error, retry, config }
// The Idempotency-Key makes a repeat after a crash between "sent" and "saved" a no-op at Resend
// (24 h window), so the customer never gets the same mail twice.
export async function posljiMail({ token, email, podjetje, pdf }) {
  const n = nastavitve();
  const { subject, html, text } = sestaviMail();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(n.api, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SCORE_MAIL_RESEND_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `abs-rezultati-${token}`,
      },
      body: JSON.stringify({
        from: n.od,
        to: [email],
        ...(n.bcc.length ? { bcc: n.bcc } : {}),
        reply_to: n.odgovor,
        subject,
        html,
        text,
        attachments: [{ filename: imeDatoteke(podjetje), content: pdf.toString('base64') }],
      }),
      signal: ctrl.signal,
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.id) return { ok: true, id: String(d.id) };
    const error = `http_${res.status}${d.name ? ` ${d.name}` : ''}${d.message ? `: ${String(d.message).slice(0, 160)}` : ''}`;
    // 401/403 is the setup (wrong key, sender domain not verified): wait like a missing key, so the
    // customer still gets the mail once it is fixed. Other 4xx is the data (e.g. a bad address),
    // a repeat does not help; 429 and 5xx can pass.
    if (res.status === 401 || res.status === 403) return { ok: false, error, retry: true, config: true };
    return { ok: false, error, retry: res.status === 429 || res.status >= 500 };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message, retry: true };
  } finally {
    clearTimeout(t);
  }
}
