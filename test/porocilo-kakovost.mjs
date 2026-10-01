// AI Business Score: quality run of the report text with the REAL AI (plan-abs-porocilo-v3, step 5).
// Not part of the normal test run: six real Sonnet calls (up to twelve with retries). Run it ONLY with
// Maks's word, and with the server on the subscription (CLAUDE_SDK=1), never on the metered API key.
//
// Submits six very different profiles to TEST_BASE, waits for each report text (as the report page
// does), measures how long it took, how many drafts the validator rejected and why, and counts
// repeated topics across the WHOLE report (paragraph, lists, first project, steps). Writes one
// review page with all six reports side by side: TEST_OUT (default .lavish/kakovost.html).
//
// Run (test DB + server with the key, never production):
//   TEST_DB_URL=postgres://postgres:test@127.0.0.1:5455/vprasalniki TEST_BASE=http://127.0.0.1:3398 \
//   node test/porocilo-kakovost.mjs
import pg from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { TEME } from '../src/score/besedilo.js';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3398';
const DB = process.env.TEST_DB_URL;
const OUT = resolve(process.env.TEST_OUT || '.lavish/kakovost.html');
if (!DB || /deploy\.acenta|188\.245/.test(DB + BASE)) { console.error('Rabim TEST_DB_URL testne baze (nikoli produkcije).'); process.exit(2); }

const PROFILI = [
  ['Začetnik, storitve', 'Računovodstvo Primer d.o.o.', '6-20', { panoga: 'storitve', vloga: 'lastnik', uporaba: 'ne', sistematicnost: 'ni', odgovorna_oseba: 'ne', razumevanje: 'slabo', pravila: 'ne', izguba_casa: ['dokumenti', 'administracija'], stroski: ['rocna_administracija'], potencial: ['administracija', 'finance'], odziv: '24h', nabavne_cene: 'redno', ovira: 'znanje', hitrost: '3-6m', pomoc: 'delavnica', interpretacija: 'priporocilo' }],
  ['Raziskovalec, proizvodnja', 'Kovinar Primer d.o.o.', '51-100', { panoga: 'proizvodnja', vloga: 'direktor', uporaba: 'posamezniki', sistematicnost: 'vsak_po_svoje', odgovorna_oseba: 'neformalno', razumevanje: 'povprecno', pravila: 'potrebovali', izguba_casa: ['nabava', 'porocila', 'ponudbe'], stroski: ['nabava', 'zaloge', 'rocna_administracija'], potencial: ['nabava', 'administracija'], odziv: '24h', nabavne_cene: 'ne_preverjamo', ovira: 'kje_zaceti', hitrost: 'cim_prej', pomoc: 'agent_nabava', interpretacija: 'pogovor' }],
  ['Uporabnik, turizem', 'Hotel Primer d.o.o.', '21-50', { panoga: 'turizem', vloga: 'direktor', uporaba: 'vec_zaposlenih', sistematicnost: 'priporocila', odgovorna_oseba: 'da', razumevanje: 'dobro', pravila: 'osnovna', izguba_casa: ['podpora', 'marketing', 'povprasevanja'], stroski: ['odzivnost', 'marketing'], potencial: ['recepcija', 'marketing'], odziv: '24h', nabavne_cene: 'obcasno', ovira: 'cas', hitrost: '1-3m', pomoc: 'pomocnik_marketing', interpretacija: 'ne' }],
  ['Pospeševalec, trgovina', 'Trgovina Primer d.o.o.', '21-50', { panoga: 'trgovina', vloga: 'vodja_prodaje', uporaba: 'oddelki', sistematicnost: 'po_oddelkih', odgovorna_oseba: 'da', razumevanje: 'dobro', pravila: 'interna', izguba_casa: ['ponudbe', 'followup', 'porocila'], stroski: ['leadi', 'ponudbe'], potencial: ['prodaja', 'vodstvo'], odziv: '2-3dni', nabavne_cene: 'redno', ovira: 'poslovni_primer', hitrost: '1-3m', pomoc: 'pomocnik_prodaja', interpretacija: 'diagnostika' }],
  ['AI-first, IT storitve', 'Razvoj Primer d.o.o.', '21-50', { panoga: 'storitve', vloga: 'direktor', uporaba: 'procesi', sistematicnost: 'strategija', odgovorna_oseba: 'ekipa', razumevanje: 'zelo_dobro', pravila: 'politika', izguba_casa: ['sestanki', 'dokumenti'], stroski: ['znanje', 'interna_komunikacija'], potencial: ['znanje', 'projekti'], odziv: 'ure', nabavne_cene: 'sistem', ovira: 'partner', hitrost: 'pogovor', pomoc: 'retainer', interpretacija: 'pogovor' }],
  ['Brez jasnega procesa', 'Gradnja Primer d.o.o.', '6-20', { panoga: 'gradbenistvo', vloga: 'lastnik', uporaba: 'posamezniki', sistematicnost: 'ni', odgovorna_oseba: 'ne', razumevanje: 'povprecno', pravila: 'ne', izguba_casa: ['ne_vem'], stroski: ['ne_vem'], potencial: ['ne_vem'], odziv: 'ni_definirano', nabavne_cene: 'obcasno', ovira: 'kje_zaceti', hitrost: 'raziskujemo', pomoc: 'ne_vem', interpretacija: 'ne' }],
];

const db = new pg.Pool({ connectionString: DB });
const pocakaj = (ms) => new Promise(r => setTimeout(r, ms));
const sufiks = Date.now().toString(36);

async function oddaj([, podjetje, velikost, odgovori], i) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/f/ai-business-score`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ime: 'Test', priimek: `Profil${i}`, email: `kakovost-${sufiks}-${i}@primer.si`, telefon: '041 000 000', podjetje, velikost, gdpr_consent: true, marketing_consent: false, odgovori }),
  });
  const d = await r.json();
  if (!d.reportUrl) throw new Error(`oddaja ${i}: ${JSON.stringify(d)}`);
  const token = d.reportUrl.split('/').pop();
  let p;
  for (;;) {
    p = await (await fetch(`${BASE}/r/${token}/podatki`)).json();
    if (p.besediloStanje !== 'pripravlja' || Date.now() - t0 > 180000) break;
    await pocakaj(1000);
  }
  const s = (await db.query('SELECT attempts_ai, last_error FROM score_results WHERE token = $1', [token])).rows[0];
  return { token, p, sekund: (Date.now() - t0) / 1000, ...s };
}

// Independent repetition count over everything the reader sees (also the steps and project card).
function ponovitve(p) {
  const mesta = [
    ['odstavek', p.besedilo.odstavek],
    ...p.besedilo.dobro.map((s, i) => [`dobro ${i + 1}`, s]),
    ...p.besedilo.zatika.map((s, i) => [`zatika ${i + 1}`, s]),
    ...p.besedilo.priloznosti.map((s, i) => [`prilož. ${i + 1}`, s]),
    ...(p.vzvodi || []).map((v, i) => [`korak ${i + 1}`, v.korak]),
  ];
  const out = [];
  for (const [tema, re] of Object.entries(TEME)) {
    const kje = mesta.filter(([, s]) => re.test(s)).map(([m]) => m);
    if (kje.length > 1) out.push(`${tema}: ${kje.join(', ')}`);
  }
  return out;
}

console.log(`Oddajam ${PROFILI.length} profilov na ${BASE} ...`);
const rez = await Promise.all(PROFILI.map((pr, i) => oddaj(pr, i + 1).catch(e => ({ napaka: e.message }))));
await db.end();

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ul = (arr) => `<ul>${arr.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
let vrstice = '', kartice = '';
rez.forEach((r, i) => {
  const [ime] = PROFILI[i];
  if (r.napaka) { vrstice += `<tr><td>${esc(ime)}</td><td colspan="5" class="bad">${esc(r.napaka)}</td></tr>`; return; }
  const p = r.p, pon = ponovitve(p), ai = p.besediloStanje === 'ai';
  console.log(`${ime.padEnd(28)} ${p.stopnja.naziv.padEnd(18)} ${String(r.sekund.toFixed(1)).padStart(5)} s  ${p.besediloStanje.padEnd(9)} poskusov ${r.attempts_ai}  ponovitve ${pon.length}${r.last_error ? '  | ' + r.last_error : ''}`);
  vrstice += `<tr><td>${esc(ime)}</td><td>${esc(p.stopnja.naziv)} · ${p.skupno}</td><td class="${ai ? 'ok' : 'bad'}">${ai ? 'AI' : esc(p.besediloStanje)}</td><td>${r.sekund.toFixed(1)} s</td><td>${pon.length ? `<span class="bad">${pon.length}</span>` : '<span class="ok">0</span>'}</td><td class="muted">${esc(r.last_error || '')}</td></tr>`;
  kartice += `<article><header><h2>${esc(ime)}</h2><p>${esc(p.podjetje)} · <b>${p.skupno}</b> · ${esc(p.stopnja.naziv)} · ${ai ? 'AI besedilo' : 'PREDLOGA'} · <a href="${BASE}/r/${r.token}" target="_blank">odpri poročilo</a></p></header>
    <h3>Kaj smo izvedeli o vas</h3><p class="story">${esc(p.besedilo.odstavek)}</p>
    <div class="three"><div><h3>Kaj delate dobro</h3>${ul(p.besedilo.dobro)}</div><div><h3>Kje se zatika</h3>${ul(p.besedilo.zatika)}</div><div><h3>Vaše priložnosti</h3>${ul(p.besedilo.priloznosti)}</div></div>
    <h3>Prvi projekt</h3><p>${esc(p.proces ? `${p.proces.naziv}: ${p.proces.priporocilo}` : `Še ni izbran: ${p.stopnja.priporocilo}`)}</p>
    <h3>Kako do višje ocene</h3>${ul((p.vzvodi || []).map(v => `${v.korak} (+${v.zrelost})`))}
    <h3>Ponovljene teme (samodejno štetje)</h3><p class="${pon.length ? 'bad' : 'ok'}">${pon.length ? esc(pon.join(' · ')) : 'nobena'}</p></article>`;
});
const html = `<!doctype html><html lang="sl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AI Business Score: pregled 6 poročil</title>
<style>:root{--bg:#071715;--bg2:#0b201d;--line:rgb(255 255 255/.12);--text:#e8f1ef;--muted:#9ab0ab;--ok:#2fd3c0;--bad:#ff6b93}
@media (prefers-color-scheme: light){:root{--bg:#f6f8f7;--bg2:#fff;--line:#d5dedb;--text:#0a1f1d;--muted:#4a5c59;--ok:#007e72;--bad:#c2185b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif;padding:24px 16px}main{max-width:1500px;margin:0 auto}
h1{font-size:24px;margin:0 0 6px}table{width:100%;border-collapse:collapse;margin:18px 0 28px;background:var(--bg2);border:1px solid var(--line)}td,th{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:16px}article{background:var(--bg2);border:1px solid var(--line);border-radius:14px;padding:18px;min-width:0}
article h2{font-size:18px;margin:0}article header p{margin:4px 0 10px;color:var(--muted)}h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 0 6px}
.story{font-size:16px;margin:0}.three{display:grid;grid-template-columns:1fr;gap:4px}ul{margin:0;padding-left:18px}li{margin:3px 0}.ok{color:var(--ok)}.bad{color:var(--bad)}.muted{color:var(--muted);font-size:13px}a{color:var(--ok)}
@media (max-width:520px){.grid{grid-template-columns:1fr}table{font-size:13px}}</style></head><body><main>
<h1>AI Business Score: pregled 6 poročil (v3, lokalno, pravi AI)</h1><p class="muted">${new Date().toLocaleString('sl-SI', { timeZone: 'Europe/Ljubljana' })} · testna baza, izmišljena podjetja. Štetje ponovitev je grobo (iskanje korenov besed po celem poročilu, tudi v korakih); končna presoja je branje.</p>
<table><thead><tr><th>Profil</th><th>Stopnja · ocena</th><th>Besedilo</th><th>Čas do besedila</th><th>Ponovljene teme</th><th>Zavrnjeni osnutki</th></tr></thead><tbody>${vrstice}</tbody></table>
<div class="grid">${kartice}</div></main></body></html>`;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log('Pregled:', OUT);
