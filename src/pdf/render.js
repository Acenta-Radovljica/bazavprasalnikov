// ── DEL 1: Imports ────────────────────────────────────────────────────────
// Server-side PDF renderer za bazavprasalnikov.
// Port iz acenta/pdf-tools z dodatkom: cover page z logom, A4 layout, footer.
import puppeteer from 'puppeteer-core';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_STYLE_PATH = resolve(__dirname, 'pdf-style.css');
const LOGO_PATH      = resolve(__dirname, '..', '..', 'assets', 'acenta-logo.png');

// PUPPETEER_EXECUTABLE_PATH env var kaze na Alpine chromium (set v Dockerfile).
// V lokalnem dev okolju (Windows) fallback na PUPPETEER_EXECUTABLE_PATH iz .env.
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';

const FOOTER = `
<div style="
  width: 100%;
  font-size: 8pt;
  color: #777;
  padding: 0 18mm;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  display: flex;
  justify-content: space-between;
  align-items: center;
">
  <span><b style="color:#1a1a2e;">ACENTA d.o.o.</b> &nbsp;|&nbsp; ai@acenta.si &nbsp;|&nbsp; acenta.si</span>
  <span>Stran <span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

function logoBase64() {
  if (!existsSync(LOGO_PATH)) return null;
  const buf = readFileSync(LOGO_PATH);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function pretvoriDatum() {
  const meseci = ['januar','februar','marec','april','maj','junij','julij','avgust','september','oktober','november','december'];
  const d = new Date();
  return `${meseci[d.getMonth()]} ${d.getFullYear()}`;
}

// Zgradi cel HTML dokument: cover page + markdown content.
function zgradiHtml({ nazivPrikaz, prirocila, datum }) {
  const logoData = logoBase64();
  const htmlContent = marked.parse(prirocila);
  const pdfStyle = readFileSync(PDF_STYLE_PATH, 'utf8');

  const logoTag = logoData
    ? `<img src="${logoData}" alt="Acenta" style="height: 18mm; margin: 0 auto 12mm auto; display: block;">`
    : '';

  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<title>AI Opportunity Report — ${nazivPrikaz}</title>
<style>
${pdfStyle}

/* ─── Acenta brand stilizacija ──────────────────────────────── */
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1a1a2e;
  line-height: 1.55;
  font-size: 10.5pt;
}

.cover {
  text-align: center;
  padding: 30mm 0 20mm 0;
  border-bottom: 3px solid #00b894;
  margin-bottom: 12mm;
  page-break-after: always;
}
.cover .eyebrow {
  font-size: 10pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #00b894;
  margin-bottom: 6mm;
  font-weight: 600;
}
.cover h1 {
  font-size: 26pt;
  color: #1a1a2e;
  margin: 0 0 6mm 0;
  line-height: 1.2;
  font-weight: 700;
}
.cover .client {
  font-size: 18pt;
  color: #1a1a2e;
  margin: 8mm 0 3mm 0;
  font-weight: 600;
}
.cover .subtitle {
  color: #6b7280;
  font-size: 11pt;
  margin-bottom: 8mm;
}
.cover .date {
  color: #6b7280;
  font-size: 10pt;
  margin-top: 10mm;
}
.cover .agency {
  margin-top: 16mm;
  font-size: 9.5pt;
  color: #6b7280;
}

h2 {
  color: #1a1a2e;
  border-bottom: 2px solid #00b894;
  padding-bottom: 2mm;
  margin-top: 10mm;
  font-size: 15pt;
}
h3 {
  color: #1a1a2e;
  font-size: 12.5pt;
  margin-top: 7mm;
}
h4 {
  color: #1a1a2e;
  font-size: 10.5pt;
  margin-top: 4mm;
}
strong { color: #1a1a2e; }

table {
  width: 100%;
  border-collapse: collapse;
  margin: 4mm 0;
  font-size: 9.5pt;
}
th {
  background: #f6f7f9;
  color: #1a1a2e;
  font-weight: 600;
  text-align: left;
  padding: 2mm 3mm;
  border: 1px solid #e5e7eb;
}
td {
  padding: 2mm 3mm;
  border: 1px solid #e5e7eb;
  vertical-align: top;
}
blockquote {
  border-left: 3px solid #00b894;
  margin: 4mm 0;
  padding: 2mm 4mm;
  background: #f6f7f9;
  color: #4b5563;
  font-size: 10pt;
  font-style: italic;
}
hr {
  border: 0;
  border-top: 1px solid #e5e7eb;
  margin: 8mm 0;
}
code {
  background: #f6f7f9;
  padding: 0.5mm 1.5mm;
  border-radius: 1mm;
  font-size: 9pt;
}
</style>
</head>
<body>

<div class="cover">
  ${logoTag}
  <div class="eyebrow">AI Opportunity Report</div>
  <h1>Analiza delovnih procesov</h1>
  <div class="client">${nazivPrikaz}</div>
  <div class="subtitle">Priložnosti za avtomatizacijo in optimizacijo</div>
  <div class="date">${datum}</div>
  <div class="agency">Pripravljeno s strani Acenta d.o.o.</div>
</div>

${htmlContent}

</body>
</html>`;
}

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────

async function renderiraj({ nazivPrikaz, prirocila }) {
  if (!prirocila) return null;

  const html = zgradiHtml({
    nazivPrikaz,
    prirocila,
    datum: pretvoriDatum(),
  });

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: FOOTER,
      margin: { top: '20mm', right: '15mm', bottom: '22mm', left: '15mm' },
    });

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { renderiraj };
