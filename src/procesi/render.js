// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { nosiOdgovor, vrsticTabele } from './schema.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────

// Acenta brand — usklajeno s src/routes/form.js, src/lib/mailer.js in
// src/pdf/pdf-style.css. Ce se barve kdaj spremenijo, se spremenijo na vseh
// stirih mestih.
const BARVE = {
  teal:   '#00b894',
  temna:  '#15151f',
  besedilo: '#3d3d4a',
  sivo:   '#8a8a95',
  crta:   '#ece9e1',
  papir:  '#fcfbf9',
};

// VSI stili so inline. Razlog: ta HTML gre v email, kjer odjemalci (Outlook,
// Gmail) redno zavrzejo <style> blok. Isti markup uporabimo za PDF, da
// stranka in arhiv nikoli ne vidita razlicne vsebine.
const S = {
  telo:     `font-family:Arial,Helvetica,sans-serif;background:#ffffff;color:${BARVE.temna};margin:0;padding:24px;`,
  ovoj:     'max-width:720px;margin:0 auto;',
  naslov:   `font-size:22px;font-weight:600;margin:6px 0 0;color:${BARVE.temna};`,
  nadnaslov: `color:${BARVE.sivo};font-size:11px;text-transform:uppercase;letter-spacing:0.08em;`,
  glava:    `border-left:4px solid ${BARVE.teal};padding-left:16px;margin-bottom:24px;`,
  meta:     'border-collapse:collapse;width:100%;margin-bottom:28px;font-size:13px;',
  metaK:    `padding:5px 0;color:${BARVE.sivo};width:190px;vertical-align:top;`,
  metaV:    `padding:5px 0;color:${BARVE.temna};`,
  sklop:    `font-size:15px;font-weight:600;color:${BARVE.temna};margin:30px 0 4px;padding-bottom:7px;border-bottom:2px solid ${BARVE.teal};`,
  sklopNamig: `font-size:12px;color:${BARVE.sivo};margin:6px 0 14px;font-style:italic;`,
  polje:    `margin:0 0 15px;padding:0 0 15px;border-bottom:1px solid ${BARVE.crta};`,
  labela:   `font-size:12px;color:${BARVE.sivo};margin-bottom:5px;`,
  vrednost: `font-size:14px;color:${BARVE.besedilo};line-height:1.55;white-space:pre-wrap;`,
  prazno:   `font-size:14px;color:#c4c4cc;font-style:italic;`,
  tabela:   `border-collapse:collapse;width:100%;font-size:12px;margin-top:8px;`,
  th:       `text-align:left;padding:7px 9px;background:${BARVE.papir};border:1px solid ${BARVE.crta};color:${BARVE.sivo};font-weight:600;`,
  td:       `padding:7px 9px;border:1px solid ${BARVE.crta};color:${BARVE.besedilo};vertical-align:top;`,
  noga:     `margin-top:34px;padding-top:16px;border-top:1px solid ${BARVE.crta};font-size:11px;color:${BARVE.sivo};line-height:1.6;`,
  transkript: `margin-top:12px;padding:14px 16px;background:${BARVE.papir};border:1px solid ${BARVE.crta};border-radius:8px;font-size:12px;color:${BARVE.besedilo};line-height:1.6;white-space:pre-wrap;`,
};

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// HTML escape. Vse, kar pride iz baze ali od uporabnika, MORA skozi to.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Datum v slovenski obliki D. M. LLLL. Vrne '—' za manjkajoco vrednost.
function datum(v) {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return esc(String(v));
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

// Ali je odgovor prazen? (Enaka logika kot izracunajNapredek v schema.js.)
function jePrazen(q, v) {
  if (q.tip === 'checkbox_multi') {
    const izbrano = Array.isArray(v?.izbrano) ? v.izbrano : [];
    return izbrano.length === 0 && !String(v?.drugo ?? '').trim();
  }
  if (q.tip === 'table') {
    return !(Array.isArray(v) && v.some(r => Array.isArray(r) && r.some(c => String(c ?? '').trim())));
  }
  return !String(v ?? '').trim();
}

// ── DEL 4: Render posameznega odgovora ───────────────────────────────────

// Vrne HTML vrednosti odgovora (brez labele).
function renderirajVrednost(q, v) {
  if (jePrazen(q, v)) return `<div style="${S.prazno}">ni izpolnjeno</div>`;

  if (q.tip === 'checkbox_multi') {
    const izbrano = Array.isArray(v?.izbrano) ? v.izbrano : [];
    const drugo = String(v?.drugo ?? '').trim();
    const deli = izbrano.map(o => esc(o));
    if (drugo) deli.push(`drugo: ${esc(drugo)}`);
    return `<div style="${S.vrednost}">${deli.join(' &middot; ')}</div>`;
  }

  if (q.tip === 'table') {
    const stolpci = q.columns || [];
    const glava = stolpci.map(c => `<th style="${S.th}">${esc(c)}</th>`).join('');
    // Prikazemo SAMO vrstice z vsebino — prazne vrstice v dokumentu za
    // stranko izgledajo kot nedokoncano delo.
    const vrstice = (Array.isArray(v) ? v : [])
      .filter(r => Array.isArray(r) && r.some(c => String(c ?? '').trim()))
      .map(r => `<tr>${stolpci.map((_, i) =>
        `<td style="${S.td}">${esc(String(r[i] ?? '').trim()) || '—'}</td>`).join('')}</tr>`)
      .join('');
    return `<table style="${S.tabela}"><thead><tr>${glava}</tr></thead><tbody>${vrstice}</tbody></table>`;
  }

  if (q.tip === 'date') {
    return `<div style="${S.vrednost}">${datum(v)}</div>`;
  }

  return `<div style="${S.vrednost}">${esc(String(v).trim())}</div>`;
}

// ── DEL 5: Render celega vprasalnika ─────────────────────────────────────

// Zgradi telo dokumenta iz vprasanj + odgovorov.
// skrijPrazna: pri dokumentu za STRANKO prazna polja izpustimo (izgledajo kot
// nedokoncano delo), pri internem pregledu pa jih pokazemo, da je vidno,
// kaj se manjka.
function renderirajSklope(questions, answers, { skrijPrazna = false } = {}) {
  const a = (answers && typeof answers === 'object') ? answers : {};
  const kosi = [];

  // Vprasanja pred prvo sekcijo so glava obrazca (hotel, datum, svetovalec).
  // Te izpisemo v meta tabelo, ne kot polja — tako je dokument berljiv.
  let vSklopu = false;
  const glavaVrstice = [];

  for (const q of Array.isArray(questions) ? questions : []) {
    if (!q) continue;

    if (q.tip === 'section') {
      vSklopu = true;
      kosi.push(`<div style="${S.sklop}">${esc(q.label)}</div>`);
      if (q.namig) kosi.push(`<div style="${S.sklopNamig}">${esc(q.namig)}</div>`);
      continue;
    }

    if (!nosiOdgovor(q.tip)) continue;

    const v = a[q.id];
    const prazno = jePrazen(q, v);

    if (!vSklopu) {
      // Glava: prazne preskocimo vedno — prazna vrstica v glavi je smet.
      if (prazno) continue;
      const prikaz = q.tip === 'date' ? datum(v) : esc(String(v).trim());
      glavaVrstice.push(
        `<tr><td style="${S.metaK}">${esc(q.label)}</td><td style="${S.metaV}">${prikaz}</td></tr>`
      );
      continue;
    }

    if (prazno && skrijPrazna) continue;

    kosi.push(`
      <div style="${S.polje}">
        <div style="${S.labela}">${esc(q.label)}</div>
        ${renderirajVrednost(q, v)}
      </div>`);
  }

  const glavaHtml = glavaVrstice.length
    ? `<table style="${S.meta}">${glavaVrstice.join('')}</table>`
    : '';

  return glavaHtml + kosi.join('\n');
}

// Cel HTML dokument izpolnjenega vprasalnika.
//
// namen:
//   'stranka'  — kar posljemo stranki: prazna polja skrita, brez transkripta
//                (transkript je INTERNI zapis pogovora in ne gre stranki,
//                 razen ce Maja izrecno odloci drugace)
//   'interno'  — za nas: prazna polja vidna, transkript prilozen
function renderirajIzpolnjen({
  seja,
  transkript = null,
  namen = 'stranka',
  opomba = '',
}) {
  const zaStranko = namen === 'stranka';
  const questions = Array.isArray(seja?.questions_snapshot) ? seja.questions_snapshot : [];
  const naslov = seja?.naziv_prikaz || 'Ocena poslovnega potenciala za AI';

  const podnaslovDeli = [seja?.stranka_naziv, seja?.proces].filter(Boolean).map(esc);

  const telo = renderirajSklope(questions, seja?.answers, { skrijPrazna: zaStranko });

  const transkriptBlok = (!zaStranko && transkript?.raw_text)
    ? `<div style="${S.sklop}">Transkript sestanka</div>
       <div style="${S.sklopNamig}">Vir: ${esc(transkript.vir)}${
            transkript.soniox_url ? ` &middot; ${esc(transkript.soniox_url)}` : ''
          } &middot; ${Number(transkript.znakov || 0).toLocaleString('sl-SI')} znakov</div>
       <div style="${S.transkript}">${esc(transkript.raw_text)}</div>`
    : '';

  const opombaBlok = opomba
    ? `<div style="${S.vrednost}margin-bottom:22px;padding:14px 16px;background:${BARVE.papir};border-left:3px solid ${BARVE.teal};">${esc(opomba)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(naslov)} — ${esc(seja?.stranka_naziv || 'Acenta')}</title>
</head>
<body style="${S.telo}">
  <div style="${S.ovoj}">

    <div style="${S.glava}">
      <div style="${S.nadnaslov}">Acenta &middot; ${zaStranko ? 'Zapis sestanka' : 'Interni zapis'}</div>
      <h1 style="${S.naslov}">${esc(naslov)}</h1>
      ${podnaslovDeli.length ? `<div style="color:${BARVE.sivo};font-size:13px;margin-top:5px;">${podnaslovDeli.join(' &middot; ')}</div>` : ''}
    </div>

    ${opombaBlok}
    ${telo}
    ${transkriptBlok}

    <div style="${S.noga}">
      Dokument je nastal iz zapisa sestanka ${datum(seja?.datum_sestanka || seja?.created_at)}.
      ${seja?.svetovalec ? `Zapisal: ${esc(seja.svetovalec)}.` : ''}
      <br />
      Acenta d.o.o. &middot; <a href="mailto:ai@acenta.si" style="color:${BARVE.teal};text-decoration:none;">ai@acenta.si</a>
    </div>

  </div>
</body>
</html>`;
}

// ── DEL 6: Named exports ─────────────────────────────────────────────────
export { renderirajIzpolnjen, renderirajSklope, esc, BARVE };
