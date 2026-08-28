// ── Cross-analiza procesnih vprasalnikov, FAZA 1 (determinirano) ──────────
//
// Majina zahteva iz FAZE 1: "analiza in primerjava vseh teh izpolnjenih
// vprasalnikov". Ta modul odgovori na tisti del vprasanja, na katerega je
// mogoce odgovoriti brez modela: KAJ SO STRANKE DEJANSKO ODGOVORILE.
//
// Zato tu ni nobenega AI klica in nobene ocene. Vsaka stevilka je prestevek
// nad `answers` in `questions_snapshot`. Faza 2 bo prav ta izpis podala modelu
// kot `<stevilke vir="sql">` — model jih sme citirati, ne izracunati. Ce bi
// stevilke racunal model, bi jih tudi izmisljal.
//
// Prompti za Fazo 2 so v `docs/prompti-cross-analiza.md`, ki je namenoma zunaj
// tega (javnega) repozitorija — glej .gitignore.
//
// Racunamo v Node in ne v SQL, ceprav dokument govori o SQL: definicija
// "izpolnjenega odgovora" ze zivi v schema.js (jeIzpolnjen) in jo uporabljajo
// seznam sej, /api/naloge in zakljucek seje. Druga, SQL-ova definicija istega
// pojma bi bila tretja resnica v isti aplikaciji.
//
// ── Nosilno pravilo tega modula: IMENOVALEC JE POSTEN ─────────────────────
// Vsaka seja nosi SVOJO kopijo vprasanj (questions_snapshot). Vprasanja se
// zato med sejami razlikujejo: predloga se je vmes spremenila ali pa je
// komercialist vprasanja prilagodil stranki. Pokritost vprasanja, ki obstaja
// v treh od dvanajstih snapshotov, je zato "2 od 3", nikoli "2 od 12".
// Deljenje s stevilom vseh sej bi tiho izumilo manjkajoce odgovore.

// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { nosiOdgovor, jeIzpolnjen, izracunajNapredek, odgovorVBesedilo } from './schema.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────

// Vprasanja z zaprtim naborom odgovorov — edina, ki jih je smiselno steti.
const TIPI_STEVNI = new Set(['radio', 'select', 'checkbox_multi']);

// Vprasanja tipa tabela (kazalniki uspesnosti). Ne stejejo se, primerjajo se
// vrstica ob vrstici.
const TIPI_TABELA = new Set(['table']);

// Prosto besedilo v primerjavi prirezemo; cel odgovor je na strani seje.
// 1200 znakov je priblizno pol strani in zadosca za primerjavo, ne da bi
// odziv narastel na megabajte.
const MAX_ODGOVOR_ZNAKOV = 1200;

// Varovalka: analiza cez vec sto sej bi bila neberljiva in pocasna. Ce je
// sej vec, to POVEMO (opozorilo v obsegu), ne odrezemo tiho.
const MAX_SEJ = 100;

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

function niz(v) {
  return v == null ? '' : String(v);
}

// Odstotek, zaokrozen. Imenovalec 0 vrne 0 (ne NaN, ne Infinity).
function odstotek(del, celota) {
  if (!celota) return 0;
  return Math.round((del / celota) * 100);
}

// Prirezi prosto besedilo. Vrne { vrednost, skrajsano }.
function prirezi(besedilo) {
  const s = niz(besedilo);
  if (s.length <= MAX_ODGOVOR_ZNAKOV) return { vrednost: s, skrajsano: false };
  return { vrednost: s.slice(0, MAX_ODGOVOR_ZNAKOV), skrajsano: true };
}

// Sklop (naslov sekcije), pod katerega spada vprasanje v danem snapshotu.
// Vprasanja pred prvo sekcijo so glava obrazca.
function sklopiSnapshota(snapshot) {
  const zemljevid = new Map();
  let trenutni = 'Osnovni podatki';
  for (const q of Array.isArray(snapshot) ? snapshot : []) {
    if (!q) continue;
    if (q.tip === 'section') { trenutni = niz(q.label); continue; }
    zemljevid.set(q.id, trenutni);
  }
  return zemljevid;
}

// Izbrane moznosti enega odgovora, ne glede na tip. Vrne { izbrano, drugo }.
// radio/select imata najvec eno izbiro, checkbox_multi jih ima lahko vec —
// zato je oblika enotna in klicatelju ni treba vedeti, kateri tip bere.
function izbrane(q, v) {
  if (q.tip === 'checkbox_multi') {
    return {
      izbrano: Array.isArray(v?.izbrano) ? v.izbrano.map(niz).filter(Boolean) : [],
      drugo: niz(v?.drugo).trim(),
    };
  }
  const s = niz(v).trim();
  return { izbrano: s ? [s] : [], drugo: '' };
}

// ── DEL 4: Univerzum vprasanj ────────────────────────────────────────────

// Zgradi seznam vprasanj cez VSE vkljucene seje.
//
// Vrstni red: gremo od najnovejse seje proti najstarejsi in vsak nov id
// dodamo na konec. Najnovejsi snapshot tako doloci vrstni red (tak vprasalnik
// ekipa vidi danes), vprasanja, ki so ostala samo v starih sejah, pa padejo
// za njim in se ne izgubijo.
//
// Hkrati beleziamo NESKLADJA: isti id z drugacnim besedilom ali tipom v dveh
// snapshotih. Tiho zlitje bi pomenilo, da bi v en stolpec primerjave pristala
// odgovora na dve razlicni vprasanji.
function zgradiUniverzum(seje) {
  const vprasanja = new Map();   // id -> zapis
  const neskladja = [];

  // Seje so razvrscene od najnovejse (glej naloziSeje v ruti); id je serial,
  // zato je vrstni red deterministicen tudi brez datuma sestanka.
  for (const s of seje) {
    const snapshot = Array.isArray(s.questions_snapshot) ? s.questions_snapshot : [];
    const sklopi = sklopiSnapshota(snapshot);

    for (const q of snapshot) {
      if (!q || !nosiOdgovor(q.tip)) continue;

      const obstojec = vprasanja.get(q.id);
      if (!obstojec) {
        vprasanja.set(q.id, {
          id: q.id,
          label: niz(q.label),
          tip: q.tip,
          sklop: sklopi.get(q.id) || '',
          obvezno: !!q.obvezno,
          options: Array.isArray(q.options) ? q.options.map(niz) : [],
          columns: Array.isArray(q.columns) ? q.columns.map(niz) : [],
          dovoljuje_drugo: !!q.drugo,
          v_sejah: [s.id],
          tip_neskladen: false,
        });
        continue;
      }

      obstojec.v_sejah.push(s.id);

      if (obstojec.tip !== q.tip) {
        obstojec.tip_neskladen = true;
        neskladja.push({
          id: q.id, vrsta: 'tip', seja_id: s.id,
          opis: `vprasanje "${obstojec.label}" je v seji ${s.id} tipa ${q.tip}, drugod ${obstojec.tip}`,
        });
      }
      if (niz(q.label) !== obstojec.label) {
        neskladja.push({
          id: q.id, vrsta: 'label', seja_id: s.id,
          opis: `isti id, drugo besedilo: "${niz(q.label)}" (seja ${s.id}) proti "${obstojec.label}"`,
        });
      }
      // Moznosti zdruzimo: odgovor iz starejse seje je lahko izbira, ki je
      // v novi predlogi ni vec. Steti jo moramo, sicer izgine iz porazdelitve.
      for (const o of Array.isArray(q.options) ? q.options : []) {
        if (!obstojec.options.includes(niz(o))) obstojec.options.push(niz(o));
      }
    }
  }

  return { vprasanja: [...vprasanja.values()], neskladja };
}

// ── DEL 5: Pokritost ─────────────────────────────────────────────────────

// Za vsako vprasanje: v koliko sejah OBSTAJA in v koliko od teh je odgovorjeno.
// Vrne tudi id-je sej, da stran zgradi matriko vprasanje x seja brez druge
// zahteve na streznik.
function izracunajPokritost(vprasanja, seje) {
  const poId = new Map(seje.map(s => [s.id, s]));

  return vprasanja.map(q => {
    const zOdgovorom = [];
    const brezOdgovora = [];

    for (const sid of q.v_sejah) {
      const s = poId.get(sid);
      if (!s) continue;
      const a = (s.answers && typeof s.answers === 'object') ? s.answers : {};
      (jeIzpolnjen(q, a[q.id]) ? zOdgovorom : brezOdgovora).push(sid);
    }

    return {
      id: q.id,
      label: q.label,
      tip: q.tip,
      sklop: q.sklop,
      obvezno: q.obvezno,
      // od_skupno NI stevilo vseh sej — je stevilo sej, ki to vprasanje sploh
      // imajo. Glej opombo o postenem imenovalcu na vrhu datoteke.
      od_skupno: q.v_sejah.length,
      odgovorjeno_v: zOdgovorom.length,
      odstotek: odstotek(zOdgovorom.length, q.v_sejah.length),
      seje_z_odgovorom: zOdgovorom,
      seje_brez_odgovora: brezOdgovora,
    };
  });
}

// ── DEL 6: Porazdelitve ──────────────────────────────────────────────────

// Za vprasanja z zaprtim naborom: koliko sej je izbralo katero moznost.
//
// Dve pasti, ki ju tu izrecno lovimo:
// 1. checkbox_multi ima lahko vec izbir na sejo. Vsota stolpcev je zato
//    lahko vecja od stevila sej in NI 100 %. Zato `vec_izbir: true` in
//    odstotek, ki je izrecno delez sej z odgovorom, ne delez izbir.
// 2. Vrednost, ki je v odgovoru, v snapshotu pa je med moznostmi ni
//    (predloga se je spremenila po tem, ko je seja ze imela odgovor).
//    Taka vrednost se steje in oznaci `izven_seznama`, ne izpusti.
function izracunajPorazdelitve(vprasanja, seje) {
  const poId = new Map(seje.map(s => [s.id, s]));
  const izpis = [];

  for (const q of vprasanja) {
    if (!TIPI_STEVNI.has(q.tip) || q.tip_neskladen) continue;

    const stevci = new Map();      // vrednost -> [seja_id]
    const drugo = [];
    let zOdgovorom = 0;

    for (const sid of q.v_sejah) {
      const s = poId.get(sid);
      if (!s) continue;
      const a = (s.answers && typeof s.answers === 'object') ? s.answers : {};
      const v = a[q.id];
      if (!jeIzpolnjen(q, v)) continue;
      zOdgovorom++;

      const { izbrano, drugo: prosto } = izbrane(q, v);
      for (const vrednost of izbrano) {
        if (!stevci.has(vrednost)) stevci.set(vrednost, []);
        stevci.get(vrednost).push(sid);
      }
      if (prosto) drugo.push({ seja_id: sid, stranka: niz(s.stranka_naziv), vrednost: prirezi(prosto).vrednost });
    }

    // Vrstni red moznosti sledi vprasalniku (ne velikosti), da je stolpec
    // primerljiv med sejami; vrednosti izven seznama gredo na konec.
    const znane = q.options.filter(o => stevci.has(o));
    const neznane = [...stevci.keys()].filter(v => !q.options.includes(v));

    const moznosti = [...znane, ...neznane].map(vrednost => ({
      vrednost,
      sej: stevci.get(vrednost).length,
      odstotek: odstotek(stevci.get(vrednost).length, zOdgovorom),
      seje: stevci.get(vrednost),
      izven_seznama: !q.options.includes(vrednost),
    }));

    // Neizbrane moznosti pokazemo z 0 — "te moznosti ni izbral nihce" je
    // ugotovitev, prazna vrstica pa videti kot manjkajoc podatek.
    for (const o of q.options) {
      if (!stevci.has(o)) moznosti.push({ vrednost: o, sej: 0, odstotek: 0, seje: [], izven_seznama: false });
    }

    izpis.push({
      id: q.id,
      label: q.label,
      tip: q.tip,
      sklop: q.sklop,
      od_skupno: q.v_sejah.length,
      odgovorjeno_v: zOdgovorom,
      vec_izbir: q.tip === 'checkbox_multi',
      osnova: 'sej z odgovorom',
      moznosti,
      drugo,
    });
  }

  return izpis;
}

// ── DEL 7: Kazalniki (tabelarna vprasanja) ───────────────────────────────

// Tabele se ne stejejo, primerjajo se. Stolpce hranimo PRI SEJI, ne samo na
// vrhu: ce je kdo tabeli dodal stolpec, bi skupna glava vrstice zamaknila.
function izracunajTabele(vprasanja, seje) {
  const poId = new Map(seje.map(s => [s.id, s]));
  const izpis = [];

  for (const q of vprasanja) {
    if (!TIPI_TABELA.has(q.tip) || q.tip_neskladen) continue;

    const vnosi = [];
    for (const sid of q.v_sejah) {
      const s = poId.get(sid);
      if (!s) continue;
      const a = (s.answers && typeof s.answers === 'object') ? s.answers : {};
      const v = a[q.id];
      if (!jeIzpolnjen(q, v)) continue;

      const snapshot = Array.isArray(s.questions_snapshot) ? s.questions_snapshot : [];
      const vSeji = snapshot.find(x => x?.id === q.id);
      const stolpci = Array.isArray(vSeji?.columns) ? vSeji.columns.map(niz) : q.columns;

      vnosi.push({
        seja_id: sid,
        stranka: niz(s.stranka_naziv),
        proces: niz(s.proces),
        stolpci,
        // Prazne vrstice odpadejo: tabela ima privzeto 3 vrstice, stranka pa
        // pogosto izpolni eno.
        vrstice: (Array.isArray(v) ? v : [])
          .filter(r => Array.isArray(r) && r.some(c => niz(c).trim()))
          .map(r => r.map(c => prirezi(niz(c).trim()).vrednost)),
      });
    }

    izpis.push({
      id: q.id,
      label: q.label,
      sklop: q.sklop,
      stolpci: q.columns,
      od_skupno: q.v_sejah.length,
      odgovorjeno_v: vnosi.length,
      seje: vnosi,
    });
  }

  return izpis;
}

// ── DEL 8: Besedilni odgovori (primerjava drug ob drugem) ────────────────

// Prosto besedilo je pri procesnem vprasalniku glavnina vsebine ("kaj je
// danes glavni problem?"). Determinirana primerjava ne more povedati, kaj
// je skupno — lahko pa odgovore vseh strank postavi pod isto vprasanje,
// kar je natanko tisto, kar clovek pri primerjavi pocne rocno.
function izracunajBesedilna(vprasanja, seje) {
  const poId = new Map(seje.map(s => [s.id, s]));
  const izpis = [];

  for (const q of vprasanja) {
    if (TIPI_STEVNI.has(q.tip) || TIPI_TABELA.has(q.tip)) continue;

    const odgovori = [];
    for (const sid of q.v_sejah) {
      const s = poId.get(sid);
      if (!s) continue;
      const a = (s.answers && typeof s.answers === 'object') ? s.answers : {};
      const v = a[q.id];
      if (!jeIzpolnjen(q, v)) continue;

      const { vrednost, skrajsano } = prirezi(odgovorVBesedilo(q, v));
      odgovori.push({
        seja_id: sid,
        stranka: niz(s.stranka_naziv),
        proces: niz(s.proces),
        oddelek: niz(s.oddelek),
        datum_sestanka: s.datum_sestanka ?? null,
        vrednost,
        skrajsano,
      });
    }

    izpis.push({
      id: q.id,
      label: q.label,
      tip: q.tip,
      sklop: q.sklop,
      obvezno: q.obvezno,
      od_skupno: q.v_sejah.length,
      odgovorjeno_v: odgovori.length,
      odgovori,
    });
  }

  return izpis;
}

// ── DEL 9: Obseg analize ─────────────────────────────────────────────────

// Kaj je v naboru in kje je podatka premalo, da bi karkoli trdili.
// Ta odsek gre v Fazi 2 v prompt kot `opozorilo_pokritosti`.
function izracunajObseg(seje, odrezanih) {
  const stranke = new Set();
  const poStatusu = { osnutek: 0, zakljucen: 0, poslan: 0, arhiv: 0 };
  const predloge = new Map();
  const svetovalci = new Set();
  let vsotaOdstotkov = 0;

  for (const s of seje) {
    const kljuc = niz(s.stranka_naziv).trim().toLowerCase();
    if (kljuc) stranke.add(kljuc);
    if (poStatusu[s.status] !== undefined) poStatusu[s.status]++;
    if (niz(s.svetovalec).trim()) svetovalci.add(niz(s.svetovalec).trim());

    const p = predloge.get(s.questionnaire_id) || {
      id: s.questionnaire_id, naziv_prikaz: niz(s.naziv_prikaz), sej: 0,
    };
    p.sej++;
    predloge.set(s.questionnaire_id, p);

    vsotaOdstotkov += izracunajNapredek(s.questions_snapshot, s.answers).odstotek;
  }

  const opozorila = [];
  if (seje.length === 0) {
    opozorila.push('V naboru ni nobene seje: filter je preozek ali pa takih sestankov se ni. Prazen izpis zato ne pomeni, da stranke niso odgovarjale.');
  }
  if (seje.length > 0 && seje.length < 3) {
    opozorila.push(`Sej je ${seje.length}. Vzorca iz tega ni mogoce trditi, posamezna opazanja pa so veljavna.`);
  }
  if (poStatusu.osnutek > 0) {
    opozorila.push(`${poStatusu.osnutek} od ${seje.length} sej je osnutkov (se izpolnjujejo). Pokritost je zato nizja, kot bo ob zakljucku.`);
  }
  if (predloge.size > 1) {
    opozorila.push(`Seje uporabljajo ${predloge.size} razlicne predloge. Vprasanja z istim id-jem so lahko razlicna — glej neskladja.`);
  }
  if (odrezanih > 0) {
    opozorila.push(`Nabor je bil omejen na ${MAX_SEJ} sej; ${odrezanih} najstarejsih ni vkljucenih.`);
  }

  return {
    sej: seje.length,
    strank: stranke.size,
    svetovalcev: svetovalci.size,
    po_statusu: poStatusu,
    predloge: [...predloge.values()].sort((a, b) => b.sej - a.sej),
    povprecna_izpolnjenost: seje.length ? Math.round(vsotaOdstotkov / seje.length) : 0,
    odrezanih,
    opozorila,
  };
}

// ── DEL 10: Vstopna tocka ────────────────────────────────────────────────

// seje = vrstice iz process_sessions (z questions_snapshot, answers in
// naziv_prikaz predloge), razvrscene od najnovejse. Vrne cel izpis analize.
//
// Funkcija je cista: nima dostopa do baze in ne vrze. Zato jo je mogoce
// testirati brez Postgresa in bo v Fazi 2 njen izpis sel neposredno v prompt.
function izracunajAnalizo(vhodneSeje) {
  const vse = Array.isArray(vhodneSeje) ? vhodneSeje : [];
  const seje = vse.slice(0, MAX_SEJ);
  const odrezanih = vse.length - seje.length;

  const { vprasanja, neskladja } = zgradiUniverzum(seje);

  return {
    obseg: izracunajObseg(seje, odrezanih),
    seje: seje.map(s => ({
      id: s.id,
      stranka_naziv: niz(s.stranka_naziv),
      proces: niz(s.proces),
      oddelek: niz(s.oddelek),
      svetovalec: niz(s.svetovalec),
      datum_sestanka: s.datum_sestanka ?? null,
      status: s.status,
      predloga: niz(s.naziv_prikaz),
      questionnaire_id: s.questionnaire_id,
      napredek: izracunajNapredek(s.questions_snapshot, s.answers),
    })),
    pokritost: izracunajPokritost(vprasanja, seje),
    porazdelitve: izracunajPorazdelitve(vprasanja, seje),
    tabele: izracunajTabele(vprasanja, seje),
    besedilna: izracunajBesedilna(vprasanja, seje),
    neskladja,
  };
}

// ── DEL 11: Named exports ────────────────────────────────────────────────
export {
  MAX_SEJ,
  MAX_ODGOVOR_ZNAKOV,
  TIPI_STEVNI,
  izracunajAnalizo,
  zgradiUniverzum,
  izracunajPokritost,
  izracunajPorazdelitve,
  izracunajTabele,
  izracunajBesedilna,
  izracunajObseg,
};
