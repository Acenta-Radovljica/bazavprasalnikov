// ── Popis opravil: vprasanja, pravilo za ure, opravila podjetja ───────────
// En vir resnice za streznik (javni obrazec /popis/:koda, prodajni predlog)
// in brskalnik (kartica na strani podjetja, ZIP za Claude). Ce se ure
// racunajo na dveh mestih z razlicno kodo, se stevilka v predlogu ne ujema s
// kartico, ki jo Matjaz vidi.
//
// Pravilo je potrjeno v nacrtu 12. 10. 2026: razpone racunamo previdno
// (sredina ali manj), da direktor stevilki verjame; ure racuna aplikacija,
// AI jih nikoli ne ocenjuje.

export const POPIS_SLUG = 'popis-opravil';
export const MAX_OPRAVIL = 3;

// Kolikokrat na mesec.
export const POGOSTOST = {
  'Vsak dan': 20,
  'Večkrat na teden': 10,
  'Enkrat na teden': 4,
  'Enkrat na mesec': 1,
};

// Koliko minut racunamo za en kos.
export const CAS = {
  'Do 15 minut': 10,
  '15 do 60 minut': 30,
  '1 do 3 ure': 120,
  'Več kot 3 ure': 240,
};

export const NACINI = ['E-pošta', 'Excel', 'Papir', 'Naš informacijski sistem', 'Drugo'];

const MAX_KRATKO = 120;
const MAX_DOLGO = 2000;

// Vprasanja v obliki, ki jo poznata stran odgovora in ZIP (questions_snapshot).
// Iz istega seznama javna stran izrise obrazec.
export const VPRASANJA = [
  { id: 'delovno_mesto', label: 'Vaše delovno mesto ali oddelek', tip: 'text', obvezno: true,
    placeholder: 'npr. recepcija, računovodstvo, kuhinja' },
  ...[1, 2, 3].flatMap((n) => [
    { id: `o${n}_opis`, sklop: `Opravilo ${n}`, tip: 'textarea', obvezno: n === 1,
      label: 'Opišite opravilo, ki vam vzame največ časa ali vas najbolj moti.',
      placeholder: 'npr. vsako jutro ročno prepisujem rezervacije iz e-pošte v sistem' },
    { id: `o${n}_pogostost`, sklop: `Opravilo ${n}`, tip: 'radio', obvezno: n === 1,
      label: 'Kako pogosto ga opravljate?', options: Object.keys(POGOSTOST) },
    { id: `o${n}_cas`, sklop: `Opravilo ${n}`, tip: 'radio', obvezno: n === 1,
      label: 'Koliko časa vam vzame vsakič?', options: Object.keys(CAS) },
    { id: `o${n}_kako`, sklop: `Opravilo ${n}`, tip: 'checkbox',
      label: 'Kako ga opravljate danes? (označite vse, kar velja)', options: NACINI },
    { id: `o${n}_pomocnik`, sklop: `Opravilo ${n}`, tip: 'textarea',
      label: 'Kaj bi moral narediti pomočnik namesto vas, da bi vam bilo lažje?',
      placeholder: 'npr. sam prebere e-pošto in vnese rezervacijo, jaz jo samo potrdim' },
  ]),
  { id: 'ime', label: 'Ime in priimek (neobvezno)', tip: 'text' },
];

// ── Ure ───────────────────────────────────────────────────────────────────

export function minutNaMesec(pogostost, cas) {
  const k = POGOSTOST[pogostost], m = CAS[cas];
  return k && m ? k * m : 0;
}

// 1 ura, 2 uri, 3 ure, 5 ur (dvojina, glej sklon v app.js).
function sklon(n, oblike) {
  const d = Math.abs(Math.trunc(n)) % 100;
  const i = d === 1 ? 0 : d === 2 ? 1 : (d === 3 || d === 4) ? 2 : 3;
  return `${n} ${oblike[i]}`;
}
const URE = ['ura', 'uri', 'ure', 'ur'];
export const ZAPOSLENI = ['zaposleni', 'zaposlena', 'zaposleni', 'zaposlenih'];
export const ODGOVORI = ['odgovor', 'odgovora', 'odgovori', 'odgovorov'];
export const OPRAVILA = ['opravilo', 'opravili', 'opravila', 'opravil'];

export const ureNaMesec = (minut) => Math.round(minut / 60);
export const steviloSSklonom = sklon;

// "okoli 10 ur na mesec"; pod pol ure "manj kot 1 ura na mesec".
export function besediloUr(minut, { kratko = false } = {}) {
  const h = ureNaMesec(minut);
  if (minut > 0 && h < 1) return kratko ? 'manj kot 1' : 'manj kot 1 ura na mesec';
  return kratko ? `okoli ${h}` : `okoli ${sklon(h, URE)} na mesec`;
}

// ── Opravila ──────────────────────────────────────────────────────────────

const niz = (v) => (typeof v === 'string' ? v.trim() : '');
const seznam = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(niz).filter(Boolean);

// Opravila iz enega odgovora (raw_data), v vrstnem redu obrazca. Opravilo
// brez opisa se ne steje.
export function opravilaOdgovora(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = [];
  for (let n = 1; n <= MAX_OPRAVIL; n++) {
    const opis = niz(r[`o${n}_opis`]);
    if (!opis) continue;
    const pogostost = niz(r[`o${n}_pogostost`]);
    const cas = niz(r[`o${n}_cas`]);
    out.push({
      st: n, opis, pogostost, cas,
      kako: seznam(r[`o${n}_kako`]),
      pomocnik: niz(r[`o${n}_pomocnik`]),
      minut: minutNaMesec(pogostost, cas),
    });
  }
  return out;
}

const casOddaje = (o) => {
  const t = new Date(o.submitted_at).getTime();
  return Number.isNaN(t) ? 0 : t;
};

// Vsa opravila podjetja z oznakami O1, O2 ... Vrstni red je stalen (cas
// oddaje, nato id odgovora, nato stevilka opravila), zato brskalnik (ZIP) in
// streznik (prodajni predlog) isti oznaki pripneta isto opravilo.
// odgovori = vrstice responses tega vprasalnika: { id, submitted_at, raw_data }.
export function opravilaPodjetja(odgovori) {
  const urejeni = [...(odgovori || [])].sort((a, b) => casOddaje(a) - casOddaje(b) || a.id - b.id);
  const out = [];
  for (const o of urejeni) {
    const raw = o.raw_data || {};
    for (const op of opravilaOdgovora(raw)) {
      out.push({
        ...op,
        oznaka: `O${out.length + 1}`,
        responseId: o.id,
        oddano: o.submitted_at,
        oddelek: niz(raw.delovno_mesto),
        ime: niz(raw.ime),
      });
    }
  }
  return out;
}

export function skupajMinut(opravila) {
  return (opravila || []).reduce((s, o) => s + (o.minut || 0), 0);
}

// ── Oddaja ────────────────────────────────────────────────────────────────

// Preveri javno oddajo in vrne cist raw_data (samo znana polja, obrezana).
// { ok: true, raw } ali { ok: false, napaka, polje }.
export function preveriOddajo(p) {
  const v = p && typeof p === 'object' ? p : {};
  const raw = {};
  const prevec = (polje) => ({ ok: false, napaka: 'predolgo', polje });
  const manjka = (polje) => ({ ok: false, napaka: 'manjka', polje });

  const mesto = niz(v.delovno_mesto);
  if (!mesto) return manjka('delovno_mesto');
  if (mesto.length > MAX_KRATKO) return prevec('delovno_mesto');
  raw.delovno_mesto = mesto;

  for (let n = 1; n <= MAX_OPRAVIL; n++) {
    const opis = niz(v[`o${n}_opis`]);
    const pogostost = niz(v[`o${n}_pogostost`]);
    const cas = niz(v[`o${n}_cas`]);
    const kako = seznam(v[`o${n}_kako`]);
    const pomocnik = niz(v[`o${n}_pomocnik`]);
    const zacet = opis || pogostost || cas || kako.length || pomocnik;
    if (!zacet) {
      if (n === 1) return manjka('o1_opis');
      continue;
    }
    if (!opis) return manjka(`o${n}_opis`);
    if (opis.length > MAX_DOLGO) return prevec(`o${n}_opis`);
    if (!pogostost) return manjka(`o${n}_pogostost`);
    if (!(pogostost in POGOSTOST)) return { ok: false, napaka: 'neveljavno', polje: `o${n}_pogostost` };
    if (!cas) return manjka(`o${n}_cas`);
    if (!(cas in CAS)) return { ok: false, napaka: 'neveljavno', polje: `o${n}_cas` };
    if (kako.some(k => !NACINI.includes(k))) return { ok: false, napaka: 'neveljavno', polje: `o${n}_kako` };
    if (pomocnik.length > MAX_DOLGO) return prevec(`o${n}_pomocnik`);
    Object.assign(raw, {
      [`o${n}_opis`]: opis, [`o${n}_pogostost`]: pogostost, [`o${n}_cas`]: cas,
      [`o${n}_kako`]: kako, [`o${n}_pomocnik`]: pomocnik,
    });
  }

  const ime = niz(v.ime);
  if (ime.length > MAX_KRATKO) return prevec('ime');
  if (ime) raw.ime = ime;
  return { ok: true, raw };
}
