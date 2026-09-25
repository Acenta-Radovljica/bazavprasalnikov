// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';
import { normalizirajNaziv } from '../utils/normalize.js';
import { klicSonnet } from './claude.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
// Pragovi za matching. Kombiniramo dve metriki:
// - pg_trgm similarity (0.0 = razlicno, 1.0 = identicno) — dobro za daljse fraze
// - Levenshtein distance (stevilo sprememb znakov) — dobro za enoznakovne typo-e
const PRAG_TRGM_AVTO  = 0.85;  // pg_trgm: nad tem avto-zlij
const LEV_AVTO        = 2;     // levenshtein: <=2 spremembi avto-zlij (npr. "Cubo" vs "Kubo")
const PRAG_TRGM_AI    = 0.20;  // pg_trgm: nad tem vprasaj AI
const LEV_AI          = 4;     // levenshtein: <=4 spremembi vprasaj AI

// Ista sluzbena domena e-naslova je najmocnejsi znak, da gre za isto
// organizacijo — mocnejsi od imena ("JZ TKM" in "Javni zavod Turizem in
// kultura Mlinsko" nimata skupnih crk, oba pa pisete z @tk-mlinsko.si).
// Brezplacne domene nic ne povedo; acenta.si izlocimo, ker nasi ljudje
// obrazce izpolnjujejo tudi v imenu strank.
const NEPOVEDNE_DOMENE = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.si', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'gmx.net', 'gmx.de', 'gmx.at', 'web.de', 'mail.com',
  'siol.net', 't-2.net', 'amis.net', 'email.si', 'volja.net', 'telemach.net',
  'triera.net', 'guest.arnes.si', 'net.hr',
  'acenta.si',
]);

// Kljuci, pod katerimi obrazci hranijo e-naslov in ime podjetja. Domeno
// beremo SAMO iz polj za e-naslov (po imenu kljuca), ne iz prostega besedila:
// odgovor, ki omenja tuj e-naslov, bi sicer podjetju pripisal tujo domeno.
const KLJUC_EMAIL_RE = /mail|replyto|posta/i;
const KLJUC_EMAIL_SQL_RE = 'mail|replyto|posta';
const KLJUCI_PODJETJE = ['podjetje', 'ime_podjetja', 'company', '2_podjetje'];

const EMAIL_RE = /[A-Z0-9._%+-]+@([A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,})/i;
// Isti vzorec za SQL (POSIX), podan kot parameter.
const DOMENA_SQL_RE = '@([A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,})';

// Male besede se pri kraticah vcasih stejejo ("TIKM"), vcasih ne ("TKM").
const MALE_BESEDE = new Set(['in', 'za', 'na', 'v', 'pri', 'd', 'of', 'and', 'the']);

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Iz odgovora vzame sluzbeno domeno e-naslova ali null. Samo polja za
// e-naslov; brezplacno domeno preskoci in isce naprej (gmail v "email" in
// sluzbeni naslov v "kontakt_email" → sluzbeni).
function sluzbenaDomena(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v !== 'string' || !KLJUC_EMAIL_RE.test(k)) continue;
    const m = v.match(EMAIL_RE);
    if (!m) continue;
    const d = m[1].toLowerCase();
    if (!NEPOVEDNE_DOMENE.has(d)) return d;
  }
  return null;
}

function zacetnice(norm, brezMalih) {
  return norm.split(' ')
    .filter(t => t && !(brezMalih && MALE_BESEDE.has(t)))
    .map(t => t[0]).join('');
}

// Ali je `kratka` kratica za `dolga` ("tkm" ← "turizem in kultura mlinsko").
function jeKratica(kratka, dolga) {
  if (!kratka || !dolga || kratka.includes(' ')) return false;
  if (kratka.length < 2 || kratka.length > 6) return false;
  if (dolga.split(' ').length < 2) return false;
  return kratka === zacetnice(dolga, true) || kratka === zacetnice(dolga, false);
}

// Vsa podjetja z vsemi imeni, pod katerimi so jih ljudje ze vpisali. Tako
// "Turizem in kultura Mlinsko" najde podjetje, ki se v bazi imenuje
// drugace, a je nekdo ze oddal odgovor pod tem imenom. Normalizacijo
// izracunamo tu, ker se je 25. 9. 2026 spremenila (sumniki, "javni zavod")
// in shranjen naziv_normaliziran starih vrstic ni vec primerljiv.
async function naloziPodjetja() {
  const res = await dbQuery(
    `SELECT c.id, c.naziv_prikaz, c.naziv_normaliziran,
            COALESCE(array_agg(DISTINCT v.ime) FILTER (WHERE v.ime IS NOT NULL AND v.ime <> ''), '{}') AS imena
       FROM companies c
       LEFT JOIN responses r ON r.company_id = c.id
       LEFT JOIN LATERAL (
         SELECT trim(r.raw_data ->> k) AS ime FROM unnest($1::text[]) AS k
       ) v ON TRUE
      WHERE c.naziv_prikaz NOT LIKE 'NEZNANO_PODJETJE_%'
      GROUP BY c.id`,
    [KLJUCI_PODJETJE]
  );
  return (res?.rows ?? []).map(c => {
    const norme = new Set([c.naziv_normaliziran, normalizirajNaziv(c.naziv_prikaz)]);
    for (const ime of c.imena) norme.add(normalizirajNaziv(ime));
    norme.delete('');
    return { ...c, norme };
  });
}

// Podjetja, ki imajo odgovore z iste domene. Vrne [{id, n}].
async function podjetjaPoDomeni(domena) {
  if (!domena) return [];
  const res = await dbQuery(
    `SELECT r.company_id AS id, COUNT(DISTINCT r.id)::int AS n
       FROM responses r
      CROSS JOIN LATERAL jsonb_each_text(
        CASE WHEN jsonb_typeof(r.raw_data) = 'object' THEN r.raw_data ELSE '{}'::jsonb END
      ) e
      WHERE e.key ~* $3 AND lower(substring(e.value from $2)) = $1
      GROUP BY r.company_id`,
    [domena, DOMENA_SQL_RE, KLJUC_EMAIL_SQL_RE]
  );
  return res?.rows ?? [];
}

// Sluzbene domene kandidatov. Vrne Map id → [domene].
async function domeneKandidatov(ids) {
  const m = new Map(ids.map(id => [id, []]));
  if (!ids.length) return m;
  const res = await dbQuery(
    `SELECT r.company_id AS id,
            array_agg(DISTINCT lower(substring(e.value from $2))) AS domene
       FROM responses r
      CROSS JOIN LATERAL jsonb_each_text(
        CASE WHEN jsonb_typeof(r.raw_data) = 'object' THEN r.raw_data ELSE '{}'::jsonb END
      ) e
      WHERE r.company_id = ANY($1::int[]) AND e.key ~* $3 AND e.value ~ $2
      GROUP BY r.company_id`,
    [ids, DOMENA_SQL_RE, KLJUC_EMAIL_SQL_RE]
  );
  for (const row of res?.rows ?? []) {
    m.set(row.id, (row.domene || []).filter(d => d && !NEPOVEDNE_DOMENE.has(d)));
  }
  return m;
}

// Najde top 5 podjetij, kjer JE pg_trgm similarity > 0.2 ALI Levenshtein <= 4.
// Razlog za OR: "kubo" vs "cubo" ima sim=0.25 (komaj) ampak lev=1 (jasno typo) —
// pg_trgm sam tega ne ujame zanesljivo pri kratkih besedah. translate():
// stare vrstice imajo naziv_normaliziran se s sumniki. levenshtein() iz
// fuzzystrmatch vrze napako nad 255 znaki, zato ga dolgim imenom preskocimo.
async function najdiKandidate(normIme) {
  const res = await dbQuery(
    `WITH c AS (
       SELECT id, naziv_prikaz, naziv_normaliziran,
              translate(naziv_normaliziran, 'čšžćđ', 'cszcd') AS n
         FROM companies
     )
     SELECT id, naziv_prikaz, naziv_normaliziran, sim, lev FROM (
       SELECT id, naziv_prikaz, naziv_normaliziran,
              similarity(n, $1) AS sim,
              CASE WHEN length(n) <= 255 AND length($1) <= 255 THEN levenshtein(n, $1) ELSE 99 END AS lev
         FROM c
     ) x
      WHERE sim > $2 OR lev <= $3
      ORDER BY sim DESC, lev ASC
      LIMIT 5`,
    [normIme, PRAG_TRGM_AI, LEV_AI]
  );
  return res?.rows ?? [];
}

// Vprasa Claude, ali je novo podjetje eno od kandidatov. Vrne id ali null.
async function vprasajAI(noviNaziv, domena, kandidati) {
  const kandidatiOpis = kandidati.map(k => {
    const drugaImena = k.imena.filter(i => i !== k.naziv_prikaz);
    // JSON.stringify: imena so vnos obrazca, narekovaji v njih ne smejo
    // razbiti strukture prompta.
    const vrstice = [`  - id=${k.id}: ${JSON.stringify(k.naziv_prikaz)}`];
    if (drugaImena.length) vrstice.push(`      vpisano tudi kot: ${drugaImena.map(i => JSON.stringify(i)).join(', ')}`);
    if (k.domene.length) vrstice.push(`      e-naslovi na domeni: ${k.domene.join(', ')}`);
    if (k.ista_domena) vrstice.push('      ISTA domena kot novo podjetje');
    if (k.kratica) vrstice.push('      novo ime je lahko kratica tega imena (ali obratno)');
    return vrstice.join('\n');
  }).join('\n');

  const system =
    'Si pomocnik agencije Acenta.si, ki preverja, ali je novo podjetje iz obrazca ista ' +
    'organizacija kot eno od obstojecih. Napacna zdruzitev pomesa odgovore dveh strank, ' +
    'zato zdruzi samo, ko si preprican. Odgovori SAMO z veljavnim JSON-om, brez komentarjev: ' +
    '{"match_id": <id ali null>, "razlog": "kratko v slovenscini"}.';

  const user =
    `Novo podjetje iz obrazca: ${JSON.stringify(noviNaziv)}\n` +
    `Domena e-naslova izpolnjevalca: ${domena || '(ni sluzbene domene)'}\n\n` +
    `Obstojeca podjetja:\n${kandidatiOpis}\n\n` +
    `Pravila:\n` +
    `- "Hotel Cubo" in "Cubo Hotel" sta ISTA (samo razlicen vrstni red).\n` +
    `- "Hotel Cubo" in "Hotel Cubo d.o.o." sta ISTA.\n` +
    `- Kratica je lahko isto: "JZ TKM" in "Javni zavod Turizem in kultura Mlinsko" z isto domeno sta ISTA.\n` +
    `- "Hotel Bled" in "Bled Rose Hotel" sta RAZLICNA (Bled je mesto, ne ime hotela).\n` +
    `- Ista domena je mocan znak, a ne dokaz: dva razlicna hotela iste verige imata lahko isto domeno ` +
    `(npr. "Hotel Lipa" in "Hotel Breza", oba @veriga-hotelov.si) — ce se imeni jasno razlikujeta, sta RAZLICNA.\n` +
    `- Ce nisi preprican, vrni null.\n\n` +
    `Odgovor (JSON):`;

  const odgovor = await klicSonnet({ system, user, maxTokens: 200 });
  if (!odgovor) return null;

  try {
    const zacetek = odgovor.indexOf('{');
    const konec = odgovor.lastIndexOf('}');
    const parsed = JSON.parse(odgovor.slice(zacetek, konec + 1));
    const matchId = parsed?.match_id;
    // Preveri, da id res obstaja med kandidati (varnost: model lahko izmisli)
    if (Number.isInteger(matchId) && kandidati.some(k => k.id === matchId)) {
      return { id: matchId, razlog: String(parsed.razlog || '').slice(0, 300) };
    }
    return null;
  } catch {
    console.warn('[match_company] AI ni vrnil veljavnega JSON:', odgovor.slice(0, 100));
    return null;
  }
}

// naziv_normaliziran je unikaten. Ce vrstica s tem kljucem ze obstaja:
//  - z oznako dvojnika: ujemanje je presodilo, da zdruzitev NI varna, zato
//    ustvarimo loceno vrstico z razlicnim kljucem (sicer bi se tiho vrnilo
//    obstojece podjetje — ravno tisto, cemur se izogibamo);
//  - brez oznake (hkratni oddaji istega novega imena): vrnemo obstojeco.
// Obstojecemu podjetju nikoli ne prepisemo prikaznega imena.
async function ustvariPodjetje(norm, nazivPrikaz, dvojnik) {
  const vstavi = (kljuc) => dbQuery(
    `INSERT INTO companies (naziv_normaliziran, naziv_prikaz)
     VALUES ($1, $2)
     ON CONFLICT (naziv_normaliziran) DO NOTHING
     RETURNING id`,
    [kljuc, nazivPrikaz]
  );
  let newId = (await vstavi(norm))?.rows?.[0]?.id;
  if (!newId && dvojnik) {
    newId = (await vstavi(`${norm} #${Date.now()}`))?.rows?.[0]?.id;
  }
  if (!newId) {
    const obstojece = await dbQuery('SELECT id FROM companies WHERE naziv_normaliziran = $1', [norm]);
    const id = obstojece?.rows?.[0]?.id;
    return id ? { companyId: id, source: 'exact' } : null;
  }

  if (dvojnik && dvojnik.id !== newId) {
    await dbQuery(
      'UPDATE companies SET mozni_dvojnik_id = $1, mozni_dvojnik_razlog = $2 WHERE id = $3',
      [dvojnik.id, dvojnik.razlog, newId]
    );
    console.log(`[match] created+dvojnik: "${nazivPrikaz}" → id=${newId}, mozni dvojnik id=${dvojnik.id} (${dvojnik.razlog})`);
    return { companyId: newId, source: 'created', mozniDvojnikId: dvojnik.id };
  }
  console.log(`[match] created: "${nazivPrikaz}" → id=${newId}`);
  return { companyId: newId, source: 'created' };
}

// ── DEL 4: Glavna exported funkcija ──────────────────────────────────────

// Vrne { companyId, source[, mozniDvojnikId] }. source je 'exact' |
// 'fuzzy_auto' | 'ai' | 'domena_ai' | 'created'. payload (neobvezen) je cel
// odgovor obrazca — iz njega se vzame domena e-naslova.
//
// Vrstni red:
//   1. enako ime po normalizaciji (tudi imena, pod katerimi je bilo podjetje
//      ze vpisano) → zdruzi
//   2. kandidati: podobno ime, ista sluzbena domena, kratica
//   3. en mocan imenski kandidat brez nasprotujoce domene → zdruzi brez AI
//   4. sicer odloci AI; ista domena + AI da → zdruzi; AI da, a domeni sta
//      razlicni → NE zdruzi, oznaci mozen dvojnik; ista domena, AI ne →
//      novo podjetje z oznako mozen dvojnik
async function najdiPodjetjeAI(nazivPrikaz, { payload } = {}) {
  if (!nazivPrikaz || typeof nazivPrikaz !== 'string') return null;

  const norm = normalizirajNaziv(nazivPrikaz);
  if (!norm) return null;

  const domena = sluzbenaDomena(payload);
  const brezImena = nazivPrikaz.startsWith('NEZNANO_PODJETJE_');

  // Obrazec brez polja za podjetje: po imenu ni kaj iskati, domena pa lahko
  // vseeno pokaze, cigav je odgovor. Samodejno ne zdruzujemo (AI nima imena
  // za primerjavo), oznacimo pa verjetno podjetje.
  if (brezImena) {
    const poDomeni = await podjetjaPoDomeni(domena);
    const naj = [...poDomeni].sort((a, b) => b.n - a.n)[0];
    return ustvariPodjetje(norm, nazivPrikaz,
      naj ? { id: naj.id, razlog: `Obrazec brez imena podjetja, e-naslov z iste domene (@${domena}).` } : null);
  }

  // 1) Enako ime po normalizaciji. Tudi tu velja domena: "Hotel Lipa"
  //    @veriga-hotelov.si in nov "Hotel Lipa" @lipa-drugje.si nista isto podjetje. Med
  //    vec enakimi (loceni dvojniki) ima prednost tisti z isto domeno.
  const vsa = await naloziPodjetja();
  const enaka = vsa.filter(c => c.norme.has(norm));
  if (enaka.length > 0) {
    const domeneEnakih = await domeneKandidatov(enaka.map(c => c.id));
    const opis = enaka.map(c => {
      const d = domeneEnakih.get(c.id) ?? [];
      return { c, d, ista: !!domena && d.includes(domena), konflikt: !!domena && d.length > 0 && !d.includes(domena) };
    });
    const izbor = opis.find(o => o.ista) ?? opis.find(o => !o.konflikt);
    if (izbor) return { companyId: izbor.c.id, source: 'exact' };
    const prvi = opis[0];
    return ustvariPodjetje(norm, nazivPrikaz, {
      id: prvi.c.id,
      razlog: `Enako ime, a e-naslovi so z različnih domen (@${domena} in @${prvi.d.join(', @')}).`,
    });
  }

  // 2) Kandidati iz treh virov, zdruzeni po id
  const kandidati = new Map();
  const dodaj = (id, lastnosti) => {
    const c = vsa.find(x => x.id === id);
    if (!c) return;
    const k = kandidati.get(id) ?? { ...c, sim: 0, lev: 99, ista_domena: false, kratica: false };
    kandidati.set(id, { ...k, ...lastnosti });
  };

  for (const k of await najdiKandidate(norm)) dodaj(k.id, { sim: k.sim, lev: k.lev });
  for (const k of await podjetjaPoDomeni(domena)) dodaj(k.id, { ista_domena: true });
  for (const c of vsa) {
    if ([...c.norme].some(n => jeKratica(norm, n) || jeKratica(n, norm))) dodaj(c.id, { kratica: true });
  }

  if (kandidati.size === 0) return ustvariPodjetje(norm, nazivPrikaz, null);

  const domene = await domeneKandidatov([...kandidati.keys()]);
  const seznam = [...kandidati.values()].map(k => {
    const d = domene.get(k.id) ?? [];
    // Nasprotujoca domena: oba imata sluzbeno domeno, a ne iste.
    const konflikt = !!domena && d.length > 0 && !d.includes(domena);
    return { ...k, domene: d, konflikt };
  });

  // 3) En mocan imenski kandidat → avto-zlij brez AI (kot doslej), razen ce
  //    sluzbeni domeni nasprotujeta ("Hotel Lipa" @veriga-hotelov.si vs @lipa-drugje.si).
  if (seznam.length === 1) {
    const k = seznam[0];
    if ((k.sim >= PRAG_TRGM_AVTO || k.lev <= LEV_AVTO) && !k.konflikt) {
      console.log(`[match] fuzzy_auto: "${nazivPrikaz}" → id=${k.id} sim=${Number(k.sim).toFixed(2)} lev=${k.lev}`);
      return { companyId: k.id, source: 'fuzzy_auto' };
    }
  }

  // 4) AI odloci
  const ai = await vprasajAI(nazivPrikaz, domena, seznam);
  const izbran = ai ? seznam.find(k => k.id === ai.id) : null;

  if (izbran && izbran.konflikt) {
    return ustvariPodjetje(norm, nazivPrikaz, {
      id: izbran.id,
      razlog: `AI meni, da gre za isto podjetje, a e-naslovi so z različnih domen (@${domena} in @${izbran.domene.join(', @')}).`,
    });
  }
  if (izbran && izbran.ista_domena) {
    console.log(`[match] domena_ai: "${nazivPrikaz}" → id=${izbran.id} (@${domena}) ${ai.razlog}`);
    return { companyId: izbran.id, source: 'domena_ai' };
  }
  if (izbran) {
    console.log(`[match] ai: "${nazivPrikaz}" → id=${izbran.id} ${ai.razlog}`);
    return { companyId: izbran.id, source: 'ai' };
  }

  // AI ni potrdil (ali ni dosegljiv). Ista domena ostane opozorilo za cloveka.
  const poDomeni = seznam.filter(k => k.ista_domena);
  const naj = poDomeni.find(k => k.kratica) ?? poDomeni.sort((a, b) => b.sim - a.sim)[0];
  return ustvariPodjetje(norm, nazivPrikaz, naj
    ? { id: naj.id, razlog: `E-naslov z iste domene (@${domena}), a ime se razlikuje — preverite.` }
    : null);
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { najdiPodjetjeAI, sluzbenaDomena, jeKratica };
