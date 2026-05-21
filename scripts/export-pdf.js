// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv } from 'node:process';
import { spawnSync } from 'node:child_process';
import { marked } from 'marked';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const API_BASE  = 'https://nacrt-admin.deploy.acenta.si';
const ADMIN_USER = process.env.ADMIN_USER ?? 'ai@acenta.si';
const ADMIN_PASS = process.env.ADMIN_PASS ?? '10hGRDz23xL1JY3Xr1HrIqMu';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PDF_TOOLS = resolve(ROOT, '..', '..', 'projects', 'pdf-tools');
const OUTPUT_DIR = resolve(ROOT, 'output');

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

function basicAuthHeader() {
  const b64 = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
  return `Basic ${b64}`;
}

async function fetchCompany(id) {
  const res = await fetch(`${API_BASE}/api/companies/${id}`, {
    headers: { 'Authorization': basicAuthHeader() },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// HTML template z Acenta brandom — namensko optimiziran za print/PDF
function zgradiHtml({ company, htmlVsebina, datum }) {
  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<title>AI Opportunity Report — ${company.naziv_prikaz}</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1a1a2e;
    line-height: 1.6;
    max-width: 100%;
  }
  .cover {
    text-align: center;
    padding: 40mm 0 20mm 0;
    border-bottom: 3px solid #00b894;
    margin-bottom: 15mm;
    page-break-after: always;
  }
  .cover .eyebrow {
    font-size: 11pt;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #00b894;
    margin-bottom: 8mm;
  }
  .cover h1 {
    font-size: 28pt;
    color: #1a1a2e;
    margin: 0 0 6mm 0;
    line-height: 1.2;
  }
  .cover .client {
    font-size: 16pt;
    color: #1a1a2e;
    margin: 8mm 0 3mm 0;
    font-weight: 600;
  }
  .cover .departments {
    color: #6b7280;
    font-size: 11pt;
    margin-bottom: 10mm;
  }
  .cover .date {
    color: #6b7280;
    font-size: 10pt;
    margin-top: 12mm;
  }
  .cover .agency {
    margin-top: 18mm;
    font-size: 10pt;
    color: #6b7280;
  }
  h2 {
    color: #1a1a2e;
    border-bottom: 2px solid #00b894;
    padding-bottom: 3mm;
    margin-top: 12mm;
    font-size: 16pt;
  }
  h3 {
    color: #1a1a2e;
    font-size: 13pt;
    margin-top: 8mm;
  }
  h4 {
    color: #1a1a2e;
    font-size: 11pt;
    margin-top: 5mm;
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
  ul, ol { padding-left: 6mm; }
  li { margin: 1.5mm 0; }
  p { margin: 3mm 0; }
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
  <div class="eyebrow">AI Opportunity Report</div>
  <h1>Analiza delovnih procesov</h1>
  <div class="client">${company.naziv_prikaz}</div>
  <div class="departments">Priložnosti za avtomatizacijo in optimizacijo</div>
  <div class="date">${datum}</div>
  <div class="agency">Pripravljeno s strani Acenta d.o.o.</div>
</div>

${htmlVsebina}

</body>
</html>`;
}

function pretvoriDatum() {
  const meseci = ['januar','februar','marec','april','maj','junij','julij','avgust','september','oktober','november','december'];
  const d = new Date();
  return `${meseci[d.getMonth()]} ${d.getFullYear()}`;
}

// ── DEL 4: Glavna funkcija ────────────────────────────────────────────────

async function main() {
  const id = parseInt(argv[2], 10);
  if (!Number.isInteger(id)) {
    console.error('Uporaba: node scripts/export-pdf.js <companyId>');
    console.error('Primer: node scripts/export-pdf.js 2');
    process.exit(1);
  }

  console.log(`[pdf] Pridobivam podatke za company=${id}...`);
  const data = await fetchCompany(id);
  const { company } = data;
  if (!company?.ai_priporocila) {
    console.error(`[pdf] Podjetje ${id} (${company?.naziv_prikaz}) nima generiranih priporocil.`);
    process.exit(1);
  }

  console.log(`[pdf] Podjetje: ${company.naziv_prikaz} (${company.ai_priporocila.length} znakov priporocil)`);

  // Markdown → HTML
  const htmlVsebina = marked.parse(company.ai_priporocila);

  // Cel HTML dokument
  const html = zgradiHtml({
    company,
    htmlVsebina,
    datum: pretvoriDatum(),
  });

  // Mapa za output
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const slug = (company.naziv_prikaz || 'podjetje')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const ts = new Date().toISOString().slice(0,10);

  const htmlPot = resolve(OUTPUT_DIR, `${slug}-${ts}.html`);
  const pdfPot  = resolve(OUTPUT_DIR, `${slug}-${ts}.pdf`);

  writeFileSync(htmlPot, html, 'utf8');
  console.log(`[pdf] HTML shranjen: ${htmlPot}`);

  // Klic pdf-tools/bin/pdf.js render
  console.log(`[pdf] Klicem pdf-tools render...`);
  const result = spawnSync('node', [
    resolve(PDF_TOOLS, 'bin', 'pdf.js'),
    'render',
    htmlPot,
    pdfPot,
  ], { stdio: 'inherit', cwd: PDF_TOOLS });

  if (result.status !== 0) {
    console.error(`[pdf] pdf-tools render FAILED (exit ${result.status})`);
    process.exit(1);
  }

  console.log(`\n[pdf] OK: ${pdfPot}`);
  console.log(`[pdf] Odpiram...`);

  // Open PDF (Windows)
  spawnSync('cmd', ['/c', 'start', '', pdfPot], { stdio: 'inherit' });
}

main().catch(err => {
  console.error('[pdf] FATAL:', err);
  process.exit(1);
});
