// ── DEL 1: Imports ────────────────────────────────────────────────────────
// (brez — cist modul brez odvisnosti, da ga lahko uporabijo render, API in mail)

// ── DEL 2: Konstante ──────────────────────────────────────────────────────

// Tipi vprasanj procesnega vprasalnika. Namenoma SIRSI nabor kot pri javnih
// lead obrazcih (src/routes/questionnaires.js VELJAVNI_TIPI), ker obrazec
// "Ocena poslovnega potenciala za AI" potrebuje sklope, vecizbiro z "drugo"
// in tabelo kazalnikov. Javni obrazci tega nabora NE dobijo — src/routes/form.js
// se ne dotakne.
const TIPI = new Set([
  'section',        // naslov sklopa, ni polje (brez odgovora)
  'text',
  'textarea',
  'email',
  'number',
  'date',
  'radio',          // ena izbira iz options
  'select',         // ena izbira iz options (spustni seznam)
  'checkbox_multi', // vec izbir iz options + opcijsko prosto polje "drugo"
  'table',          // matrika columns x vrstice
]);

// Tipi, ki potrebujejo neprazen options array.
const TIPI_Z_OPTIONS = new Set(['radio', 'select', 'checkbox_multi']);

// Tipi, ki ne nosijo odgovora.
const TIPI_BREZ_ODGOVORA = new Set(['section']);

// Zgornje meje. Namen ni varcevanje s prostorom, ampak da pokvarjen ali
// zlonamerni payload ne napolni baze in ne razbije renderja.
const MAX_VRSTIC_TABELE = 20;
const MAX_STOLPCEV_TABELE = 8;
const MAX_DOLZINA_ODGOVORA = 20000;
const MAX_VPRASANJ = 300;

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Ali ta tip vprasanja nosi odgovor?
function nosiOdgovor(tip) {
  return TIPI.has(tip) && !TIPI_BREZ_ODGOVORA.has(tip);
}

// Koliko vrstic ima tabela (privzeto 3, kot v obrazcu 4.b).
function vrsticTabele(q) {
  const n = Number.isInteger(q.vrstice) ? q.vrstice : 3;
  return Math.min(Math.max(n, 1), MAX_VRSTIC_TABELE);
}

// Prirezi niz na varno dolzino. Vrne prazen niz za null/undefined.
function niz(v) {
  if (v == null) return '';
  return String(v).slice(0, MAX_DOLZINA_ODGOVORA);
}

// ── DEL 4: Validacija vprasanj (strukture vprasalnika) ────────────────────

// Validira array vprasanj procesnega vprasalnika.
// Vrne { ok: true } ali { ok: false, error: '...' } — enak podpis kot
// validirajQuestions() v src/routes/questionnaires.js, da se API obnasa enako.
function validirajVprasanja(questions) {
  if (!Array.isArray(questions)) return { ok: false, error: 'questions_not_array' };
  if (questions.length > MAX_VPRASANJ) return { ok: false, error: 'too_many_questions' };

  const idi = new Set();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q || typeof q !== 'object' || Array.isArray(q)) {
      return { ok: false, error: `q[${i}]_not_object` };
    }
    if (typeof q.id !== 'string' || !q.id.trim()) {
      return { ok: false, error: `q[${i}]_missing_id` };
    }
    if (idi.has(q.id)) return { ok: false, error: `q[${i}]_duplicate_id_${q.id}` };
    idi.add(q.id);

    if (typeof q.label !== 'string' || !q.label.trim()) {
      return { ok: false, error: `q[${i}]_missing_label` };
    }
    if (!TIPI.has(q.tip)) {
      return { ok: false, error: `q[${i}]_invalid_tip_${q.tip}` };
    }

    if (TIPI_Z_OPTIONS.has(q.tip)) {
      if (!Array.isArray(q.options) || q.options.length === 0) {
        return { ok: false, error: `q[${i}]_${q.tip}_needs_options` };
      }
      if (!q.options.every(o => typeof o === 'string' && o.trim())) {
        return { ok: false, error: `q[${i}]_options_must_be_strings` };
      }
    }

    if (q.tip === 'table') {
      if (!Array.isArray(q.columns) || q.columns.length === 0) {
        return { ok: false, error: `q[${i}]_table_needs_columns` };
      }
      if (q.columns.length > MAX_STOLPCEV_TABELE) {
        return { ok: false, error: `q[${i}]_table_too_many_columns` };
      }
      if (!q.columns.every(c => typeof c === 'string' && c.trim())) {
        return { ok: false, error: `q[${i}]_columns_must_be_strings` };
      }
    }
  }
  return { ok: true };
}

// ── DEL 5: Normalizacija odgovorov ────────────────────────────────────────

// Preslika poljubne odgovore iz brskalnika v kanonicno obliko glede na
// vprasanja. Vrne { answers, napake } — NIKOLI ne vrze in nikoli ne zavrne
// celote.
//
// ZAKAJ TAKO: to se klice ob autosave med prodajnim sestankom. Ce bi
// normalizacija vracala 400 zaradi enega cudnega polja, bi komercialistu
// med pogovorom s stranko izginil zapis. Zato je pisanje vedno popustljivo,
// preverjanje obveznih polj pa se zgodi loceno ob zakljucku seje
// (preveriObvezna).
//
// Kanonicne oblike odgovorov:
//   text/textarea/email/number/date  -> string
//   radio/select                     -> string (mora biti iz options, sicer '')
//   checkbox_multi                   -> { izbrano: string[], drugo: string }
//   table                            -> string[][]  (vrstice x stolpci)
function normalizirajOdgovore(questions, vhod) {
  const answers = {};
  const napake = [];
  const src = (vhod && typeof vhod === 'object' && !Array.isArray(vhod)) ? vhod : {};

  for (const q of Array.isArray(questions) ? questions : []) {
    if (!q || !nosiOdgovor(q.tip)) continue;

    const v = src[q.id];

    switch (q.tip) {
      case 'radio':
      case 'select': {
        const s = niz(v).trim();
        if (!s) { answers[q.id] = ''; break; }
        // Neznana vrednost se ZAVRZE, ne shrani: options so zaprt seznam in
        // v poznejsi analizi ne zelimo smeti, ki jih ni v vprasalniku.
        if ((q.options || []).includes(s)) {
          answers[q.id] = s;
        } else {
          answers[q.id] = '';
          napake.push({ id: q.id, error: 'vrednost_ni_med_options', vrednost: s });
        }
        break;
      }

      case 'checkbox_multi': {
        const dovoljene = new Set(q.options || []);
        let izbrano = [];
        let drugo = '';

        if (Array.isArray(v)) {
          izbrano = v;
        } else if (v && typeof v === 'object') {
          izbrano = Array.isArray(v.izbrano) ? v.izbrano : [];
          drugo = niz(v.drugo);
        } else if (typeof v === 'string' && v.trim()) {
          // Brskalnik pri eni sami obkljukani vrednosti poslje niz.
          izbrano = [v];
        }

        const cisto = [];
        for (const o of izbrano) {
          const s = niz(o).trim();
          if (!s || cisto.includes(s)) continue;
          if (dovoljene.has(s)) cisto.push(s);
          else napake.push({ id: q.id, error: 'vrednost_ni_med_options', vrednost: s });
        }

        // "drugo" hranimo samo, ce ga vprasanje dovoljuje — drugace bi
        // prosto besedilo pricakalo v podatkih, ki jih obrazec ne pozna.
        answers[q.id] = q.drugo ? { izbrano: cisto, drugo: drugo.trim() }
                                : { izbrano: cisto, drugo: '' };
        break;
      }

      case 'table': {
        const stStolpcev = (q.columns || []).length;
        const stVrstic = vrsticTabele(q);
        const vhodneVrstice = Array.isArray(v) ? v : [];
        const mreza = [];

        for (let r = 0; r < stVrstic; r++) {
          const vrstica = Array.isArray(vhodneVrstice[r]) ? vhodneVrstice[r] : [];
          const celice = [];
          for (let c = 0; c < stStolpcev; c++) celice.push(niz(vrstica[c]).trim());
          mreza.push(celice);
        }
        answers[q.id] = mreza;
        break;
      }

      case 'number': {
        // Hranimo kot niz: "3-4 ure na teden" je na sestanku pogostejsi
        // odgovor kot cisto stevilo, in ga NE zelimo izgubiti.
        answers[q.id] = niz(v).trim();
        break;
      }

      default: {
        answers[q.id] = niz(v).trim();
        break;
      }
    }
  }

  return { answers, napake };
}

// ── DEL 6: Preverjanje obveznih polj ─────────────────────────────────────

// Ali ima to vprasanje odgovor? ENA definicija "izpolnjenosti" za cel projekt.
//
// ZAKAJ na enem mestu: to isto vprasanje si zastavijo stiri mesta —
// preveriObvezna (ali smem zakljuciti sejo), izracunajNapredek ("18/43" na
// seznamu), /api/naloge (kaj je treba narediti) in cross-analiza (pokritost
// vprasanj cez seje). Ce bi vsako mesto imelo svojo razlicico, bi seja lahko
// veljala za 100 % izpolnjeno na seznamu in hkrati imela manjkajoca obvezna
// polja ob zakljucku. Taka razlika se opazi sele pri stranki.
function jeIzpolnjen(q, v) {
  if (!q || !nosiOdgovor(q.tip)) return false;

  if (q.tip === 'checkbox_multi') {
    const izbrano = Array.isArray(v?.izbrano) ? v.izbrano : [];
    return izbrano.length > 0 || !!niz(v?.drugo).trim();
  }
  if (q.tip === 'table') {
    // Tabela steje za izpolnjeno, ce ima vsaj ena celica vsebino.
    return Array.isArray(v) && v.some(r => Array.isArray(r) && r.some(c => niz(c).trim()));
  }
  return !!niz(v).trim();
}

// Vrne seznam { id, label } obveznih vprasanj, ki so ostala prazna.
// Klice se SAMO ob prehodu seje v status 'zakljucen' ali pred posiljanjem
// stranki — nikoli ob autosave.
function preveriObvezna(questions, answers) {
  const manjka = [];
  const a = (answers && typeof answers === 'object') ? answers : {};

  for (const q of Array.isArray(questions) ? questions : []) {
    if (!q || !nosiOdgovor(q.tip) || !q.obvezno) continue;
    if (!jeIzpolnjen(q, a[q.id])) manjka.push({ id: q.id, label: q.label });
  }
  return manjka;
}

// ── DEL 7: Napredek izpolnjenosti ────────────────────────────────────────

// Koliko polj je izpolnjenih od vseh (za prikaz "18/43" na seznamu sej).
// Sekcije se ne stejejo — niso polja.
function izracunajNapredek(questions, answers) {
  const a = (answers && typeof answers === 'object') ? answers : {};
  let skupaj = 0;
  let izpolnjenih = 0;

  for (const q of Array.isArray(questions) ? questions : []) {
    if (!q || !nosiOdgovor(q.tip)) continue;
    skupaj++;
    if (jeIzpolnjen(q, a[q.id])) izpolnjenih++;
  }

  const odstotek = skupaj === 0 ? 0 : Math.round((izpolnjenih / skupaj) * 100);
  return { izpolnjenih, skupaj, odstotek };
}

// ── DEL 8: Odgovor v besedilo ────────────────────────────────────────────

// Pretvori en odgovor v berljivo besedilo (za AI prompte in plain-text email).
// Vrne prazen niz, ce odgovora ni.
function odgovorVBesedilo(q, v) {
  if (!q || !nosiOdgovor(q.tip)) return '';

  if (q.tip === 'checkbox_multi') {
    const izbrano = Array.isArray(v?.izbrano) ? v.izbrano : [];
    const drugo = niz(v?.drugo).trim();
    const deli = [...izbrano];
    if (drugo) deli.push(`drugo: ${drugo}`);
    return deli.join(', ');
  }

  if (q.tip === 'table') {
    if (!Array.isArray(v)) return '';
    const stolpci = q.columns || [];
    const vrstice = v
      .filter(r => Array.isArray(r) && r.some(c => niz(c).trim()))
      .map(r => stolpci.map((c, i) => `${c}: ${niz(r[i]).trim() || '—'}`).join(' | '));
    return vrstice.join('\n');
  }

  return niz(v).trim();
}

// Cel izpolnjen vprasalnik v besedilo, s sklopi. Uporablja ga AI povzetek
// in cross-analiza — ena sama definicija, da AI in email nikoli ne vidita
// razlicne vsebine.
function vprasalnikVBesedilo(questions, answers) {
  const a = (answers && typeof answers === 'object') ? answers : {};
  const vrstice = [];

  for (const q of Array.isArray(questions) ? questions : []) {
    if (!q) continue;

    if (q.tip === 'section') {
      vrstice.push('', `## ${q.label}`);
      continue;
    }
    if (!nosiOdgovor(q.tip)) continue;

    const besedilo = odgovorVBesedilo(q, a[q.id]);
    if (!besedilo) continue;   // prazna polja preskocimo — AI ne rabi "—"
    vrstice.push(`${q.label}: ${besedilo}`);
  }

  return vrstice.join('\n').trim();
}

// ── DEL 9: Named exports ─────────────────────────────────────────────────
export {
  TIPI,
  TIPI_Z_OPTIONS,
  TIPI_BREZ_ODGOVORA,
  MAX_VRSTIC_TABELE,
  MAX_STOLPCEV_TABELE,
  nosiOdgovor,
  vrsticTabele,
  validirajVprasanja,
  normalizirajOdgovore,
  jeIzpolnjen,
  preveriObvezna,
  izracunajNapredek,
  odgovorVBesedilo,
  vprasalnikVBesedilo,
};
