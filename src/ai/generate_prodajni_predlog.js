// ── Prodajni predlog AI procesov ──────────────────────────────────────────
// Opus prebere isti paket kot "Izvoz za Claude (ZIP)" (sestavi ga brskalnik,
// public/admin/izvoz.js) in vrne dva dokumenta: seznam procesov za direktorja
// in prodajni list za Matjaza. Izhod preverimo (prepovedana orodja, proces
// brez citata, stevilka, ki je ni v vhodu, imena ljudi in strank); ce kaj
// najdemo, ga enkrat vrnemo v popravek, preostanek shranimo kot opozorila.
//
// Jedro (sestaviVhod, razcleni, preveri, pripraviPredlog) je brez baze, da ga
// test pozene z lazno funkcijo klica in brez API-ja.

// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { klicOpus, sdkVklopljen, MODEL_OPUS } from './claude.js';
import { naloziKatalog } from '../routes/katalog.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────

// Okoli 200k tokenov slovenskega besedila. Ce je paket vecji, najprej izpustimo
// transkripte (zapis svetovalca s sestanka ostane), sicer zavrnemo.
const MAX_ZNAKOV = 600000;
const MAX_IZHOD_TOKENOV = 12000;
// Izmerjeno 9. 10. 2026 (TKR, 17 odgovorov, 83k znakov, prek SDK): 241 s. Z
// rezervo za vecja podjetja; dva klica (popravek) ostaneta pod 20 min, po
// katerih API pripravo razglasi za obticano.
const TIMEOUT_MS = 540000;

const SYSTEM = `Ste svetovalec agencije Acenta za AI rešitve po meri. Dobili boste paket datotek o enem podjetju, vsako v oznaki <datoteka ime="...">.

Sledite datoteki 00-NAVODILA-ZA-CLAUDE.md natančno: ona določa namen, pravila in obliko obeh dokumentov.

Vrnite natanko dva dela in nič drugega, oba v Markdownu:
<za_direktorja>
dokument 1
</za_direktorja>
<za_matjaza>
dokument 2
</za_matjaza>

Pred, med ali po teh oznakah ne pišite ničesar.`;

// Splosna orodja, ki jih podjetje kupi samo; v dokumentu za direktorja jih ne
// predlagamo (glej navodila, pravilo o splosnih orodjih).
const PREPOVEDANA_ORODJA = /\b(copilot\w*|chat\s?gpt\w*|deepl\w*|canv[aeio]\w*|gemini\w*|otter\.ai|fireflies|tl;dv)\b/gi;

// Enote, pri katerih je stevilka trditev o koristi ali obsegu. Isto stevilko
// z enoto iste druzine mora vsebovati vhod, sicer si jo je model izmislil.
const ENOTE = [
  ['%',      /^(%|odstot)/i],
  ['€',      /^(€|eur|evr)/i],
  ['ur',     /^(ur|h\b)/i],
  ['minut',  /^min/i],
  ['dni',    /^(dn|dan)/i],
  ['tednov', /^ted/i],
  ['mesecev',/^mes/i],
  ['let',    /^(let|leto)/i],
];
const STEVILKA_Z_ENOTO = /(\d+(?:[.,]\d+)?)\s*(%|€|eur\w*|evr\w*|odstot\w*|ur[aei]?\b|urah\b|uro\b|h\b|minut\w*|min\b|dn\w*|dan\w*|tedn\w*|teden\b|mesec\w*|mesec\b|let\b|leto\b|leti\b)/gi;

// Splosne besede, ki se v polju "kje" kataloga pisejo z veliko, a niso ime
// stranke. Vse ostale besede z veliko zacetnico iz "kje" pri resitvah, kjer
// stranke ne smemo omeniti, v dokumentu za direktorja ne smejo nastopiti.
const NI_IME_STRANKE = new Set([
  'več', 'hotel', 'hoteli', 'hotela', 'hotelov', 'bled', 'bledu', 'interno', 'acenti', 'acenta',
  'koncept', 'kulturna', 'proizvajalec', 'turizem', 'pilot', 'ponudba', 'prototip', 'produkcija',
  'apartmaji', 'vila', 'ljubljana', 'ljubljani', 'slovenija',
  'sloveniji', 'trgovina', 'zavod', 'prvi', 'drugi', 'avtohiša', 'ponudnik', 'b2b', 'nda',
]);

// ── DEL 3: Cisto jedro ────────────────────────────────────────────────────

// Iz datotek brskalnika naredi sporocilo za model. Korensko mapo odrezemo
// (ime vsebuje datum in ni vsebina). Vrne { besedilo, stevci, opozorila }.
export function sestaviVhod(datoteke) {
  const opozorila = [];
  let seznam = (datoteke || [])
    .filter(d => d && typeof d.ime === 'string' && typeof d.vsebina === 'string')
    .map(d => ({ ime: d.ime.replace(/^[^/]+\//, ''), vsebina: d.vsebina }));

  const skupaj = (s) => s.reduce((n, d) => n + d.vsebina.length, 0);
  if (skupaj(seznam) > MAX_ZNAKOV) {
    const brez = seznam.filter(d => !/^procesne-seje\/.*-transkript\.md$/.test(d.ime));
    if (brez.length < seznam.length) {
      opozorila.push('Transkripti sestankov so bili predolgi, zato jih AI ni bral; upoštevani so zapisi svetovalca s sestankov.');
      seznam = brez;
    }
  }

  const stevci = {
    datotek: seznam.length,
    odgovori: seznam.filter(d => d.ime.startsWith('odgovori/')).length,
    seje: seznam.filter(d => /^procesne-seje\/.*(?<!-transkript)\.md$/.test(d.ime)).length,
    transkripti: seznam.filter(d => /^procesne-seje\/.*-transkript\.md$/.test(d.ime)).length,
    katalog: seznam.some(d => d.ime === '02-acenta-resitve.md'),
    znakov: skupaj(seznam),
  };

  const besedilo = seznam
    .map(d => `<datoteka ime="${d.ime.replace(/"/g, '')}">\n${d.vsebina.trim()}\n</datoteka>`)
    .join('\n\n');
  return { besedilo, stevci, opozorila, prevelik: stevci.znakov > MAX_ZNAKOV };
}

// Iz odgovora modela vzame oba dokumenta. Vrne null, ce kateri manjka.
export function razcleni(odgovor) {
  if (typeof odgovor !== 'string') return null;
  const del = (oznaka) => {
    const m = odgovor.match(new RegExp(`<${oznaka}>([\\s\\S]*?)</${oznaka}>`, 'i'));
    const t = m ? m[1].trim() : '';
    return t || null;
  };
  const za_direktorja = del('za_direktorja');
  const za_matjaza = del('za_matjaza');
  if (!za_direktorja || !za_matjaza) return null;
  return { za_direktorja, za_matjaza };
}

// Imena izpolnjevalcev iz razdelka "Kdo je izpolnjeval" v 01-podjetje.md.
export function imenaLjudi(datoteke) {
  const pod = (datoteke || []).find(d => /(^|\/)01-podjetje\.md$/.test(d.ime || ''));
  if (!pod) return [];
  const m = pod.vsebina.match(/## Kdo je izpolnjeval[^\n]*\n([\s\S]*?)(\n## |\s*$)/);
  if (!m) return [];
  return m[1].split('\n')
    .map(v => v.match(/^- (.+?)(?:, | \()/)?.[1]?.trim())
    .filter(ime => ime && !ime.includes('@') && ime !== 'Anonimni odgovor' && ime.split(/\s+/).length >= 2);
}

// Besede z veliko zacetnico iz "kje" pri resitvah, kjer stranke ne smemo
// omeniti. Izpusti splosne besede in besede iz imena tega podjetja.
export function prepovedanaImenaStrank(katalog, nazivPodjetja) {
  const lastno = new Set(String(nazivPodjetja || '').toLowerCase().split(/[^\p{L}\d]+/u).filter(Boolean));
  const out = new Set();
  for (const r of katalog?.resitve || []) {
    if (r.smemo_omeniti) continue;
    for (const b of String(r.kje || '').match(/\p{Lu}[\p{L}\d-]+/gu) || []) {
      const m = b.toLowerCase();
      if (b.length < 4 || NI_IME_STRANKE.has(m) || lastno.has(m)) continue;
      out.add(b);
    }
  }
  return [...out];
}

function druzinaEnote(enota) {
  return ENOTE.find(([, re]) => re.test(enota))?.[0] ?? null;
}

// Preveri dokumenta. Vrne seznam tezav v slovenscini (prazen = vse v redu).
// vhod: besedilo paketa; imena: ljudje; stranke: prepovedana imena strank.
export function preveri({ za_direktorja, za_matjaza }, { vhod = '', imena = [], stranke = [] } = {}) {
  const tezave = [];
  const d1 = String(za_direktorja || '');

  const orodja = [...new Set((d1.match(PREPOVEDANA_ORODJA) || []).map(o => o.toLowerCase()))];
  if (orodja.length) {
    tezave.push(`Dokument za direktorja omenja splošno orodje (${orodja.join(', ')}). Ta orodja podjetje kupi samo; opišite rešitev, ki jo izdela Acenta, in orodja ne imenujte.`);
  }

  const razdelki = d1.split(/^###\s+(?=\d+\.)/m).slice(1);
  if (!razdelki.length) {
    tezave.push('Dokument za direktorja nima razdelkov procesov z naslovi »### 1. Ime procesa«.');
  }
  for (const r of razdelki) {
    if (!/»[^«]{8,}«/.test(r)) {
      const naslov = r.split('\n')[0].trim();
      tezave.push(`Proces »${naslov}« nima dobesednega citata zaposlenega v »…«.`);
    }
  }

  // Stevilke z enoto, ki jih v vhodu ni z isto enoto.
  const vhodN = vhod.replace(/(\d),(\d)/g, '$1.$2');
  const izmisljene = new Set();
  for (const m of d1.matchAll(STEVILKA_Z_ENOTO)) {
    const st = m[1].replace(',', '.');
    const druzina = druzinaEnote(m[2]);
    if (!druzina) continue;
    const vVhodu = [...vhodN.matchAll(new RegExp(`(?<![\\d.])${st.replace('.', '\\.')}\\s*(%|€|[\\p{L}]+)`, 'gu'))]
      .some(x => druzinaEnote(x[1]) === druzina);
    if (!vVhodu) izmisljene.add(`${m[1]} ${m[2]}`.trim());
  }
  if (izmisljene.size) {
    tezave.push(`Dokument za direktorja navaja številke, ki jih v gradivu ni: ${[...izmisljene].map(s => `»${s}«`).join(', ')}. Odstranite jih ali napišite, kako jih bomo izmerili.`);
  }

  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(d1)) {
    tezave.push('Dokument za direktorja vsebuje e-naslov. Zaposlene navajajte po vlogi.');
  }
  if (/(\+386[\s-]?\d{1,2}|\b0\d{1,2})[\s/-]?\d{3}[\s-]?(\d{3}|\d{2}[\s-]?\d{2})\b/.test(d1)) {
    tezave.push('Dokument za direktorja vsebuje telefonsko številko.');
  }
  if (/\b[\w-]+\.md\b|\bodgovori\/|\bprocesne-seje\//.test(d1)) {
    tezave.push('Dokument za direktorja omenja imena datotek iz paketa; ta sodijo samo v dokument za Matjaža.');
  }

  const osebe = imena.filter(ime => {
    const priimek = ime.split(/\s+/).at(-1);
    const re = new RegExp(`(^|[^\\p{L}])(${esc(ime)}|${esc(priimek)}\\p{L}{0,2})(?![\\p{L}])`, 'u');
    return priimek.length >= 4 && re.test(d1);
  });
  if (osebe.length) {
    tezave.push(`Dokument za direktorja navaja zaposlene po imenu (${osebe.join(', ')}). Navedite vlogo ali oddelek.`);
  }

  const omenjene = stranke.filter(s => new RegExp(`(^|[^\\p{L}])${esc(s)}\\p{L}{0,2}(?![\\p{L}])`, 'u').test(d1));
  if (omenjene.length) {
    tezave.push(`Dokument za direktorja omenja drugo stranko (${omenjene.join(', ')}), ki je po katalogu ne smemo omeniti. Opišite samo panogo.`);
  }

  if (!String(za_matjaza || '').trim()) tezave.push('Dokument za Matjaža je prazen.');
  return tezave;
}

function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Celoten tek brez baze. klic({ system, user }) -> besedilo | null.
// Vrne { ok, za_direktorja, za_matjaza, opozorila, stevci, napaka }.
export async function pripraviPredlog(datoteke, { klic, katalog = null, nazivPodjetja = '' }) {
  const vhod = sestaviVhod(datoteke);
  if (!vhod.stevci.datotek) return { ok: false, napaka: 'Paket je prazen.', stevci: vhod.stevci };
  if (vhod.prevelik) {
    return { ok: false, napaka: `Gradivo je preobsežno (${vhod.stevci.znakov} znakov). Uporabite Izvoz za Claude (ZIP).`, stevci: vhod.stevci };
  }
  const kontekst = {
    vhod: vhod.besedilo,
    imena: imenaLjudi(datoteke),
    stranke: prepovedanaImenaStrank(katalog, nazivPodjetja),
  };

  const prvi = await klic({ system: SYSTEM, user: vhod.besedilo });
  // Brez odgovora (cas potekel, napaka API-ja) ponovni klic le podvoji cakanje.
  if (!prvi) return { ok: false, napaka: 'AI se ni odzval. Poskusite znova čez nekaj minut.', stevci: vhod.stevci };
  let rezultat = razcleni(prvi);
  let tezave = rezultat ? preveri(rezultat, kontekst) : ['Odgovor nima oznak <za_direktorja> in <za_matjaza>.'];

  if (tezave.length) {
    const popravek = [
      vhod.besedilo,
      '',
      `<prejsnji_osnutek>\n${prvi.trim()}\n</prejsnji_osnutek>\n`,
      'Preverjanje vašega prejšnjega osnutka je našlo te težave:',
      ...tezave.map((t, i) => `${i + 1}. ${t}`),
      '',
      'Vrnite popravljena oba dokumenta v celoti, v isti obliki z oznakama <za_direktorja> in <za_matjaza>.',
    ].join('\n');
    const drugi = razcleni(await klic({ system: SYSTEM, user: popravek }));
    if (drugi) {
      rezultat = drugi;
      tezave = preveri(drugi, kontekst);
    }
  }

  if (!rezultat) return { ok: false, napaka: 'AI ni vrnil obeh dokumentov.', stevci: vhod.stevci };
  return {
    ok: true,
    ...rezultat,
    opozorila: [...vhod.opozorila, ...tezave],
    stevci: vhod.stevci,
  };
}

// ── DEL 4: Tek z bazo ─────────────────────────────────────────────────────

// Klice ga api.js v ozadju za ze vstavljeno vrstico s statusom 'pripravlja'.
export async function generirajProdajniPredlog(predlogId, companyId, datoteke) {
  const meta = await dbQuery('SELECT naziv_prikaz FROM companies WHERE id = $1', [companyId]);
  const katalog = await naloziKatalog().catch(() => null);
  const izid = await pripraviPredlog(datoteke, {
    klic: ({ system, user }) => klicOpus({ system, user, maxTokens: MAX_IZHOD_TOKENOV, effort: 'high', timeoutMs: TIMEOUT_MS }),
    katalog,
    nazivPodjetja: meta?.rows?.[0]?.naziv_prikaz || '',
  });
  const model = `${MODEL_OPUS}${sdkVklopljen() ? ' (SDK)' : ''}`;

  if (!izid.ok) {
    await dbQuery(
      `UPDATE prodajni_predlogi SET status = 'napaka', napaka = $2, model = $3, koncano_at = NOW() WHERE id = $1`,
      [predlogId, izid.napaka, model],
    );
    console.warn(`[prodajni-predlog] company=${companyId} napaka: ${izid.napaka}`);
    return;
  }
  await dbQuery(
    `UPDATE prodajni_predlogi
        SET status = 'ok', za_direktorja = $2, za_matjaza = $3, opozorila = $4::jsonb,
            model = $5, napaka = NULL, koncano_at = NOW()
      WHERE id = $1`,
    [predlogId, izid.za_direktorja, izid.za_matjaza, JSON.stringify(izid.opozorila), model],
  );
  console.log(`[prodajni-predlog] company=${companyId} ok, opozoril ${izid.opozorila.length}`);
}

export { MAX_ZNAKOV };
