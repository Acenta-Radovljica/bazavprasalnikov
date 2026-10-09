// ── Izvoz podjetja za Claude ──────────────────────────────────────────────
// Iz odziva GET /api/companies/:id/izvoz sestavi datoteke Markdown in jih
// zapakira v ZIP. Paket gre v Claude, ki iz njega pripravi prodajni predlog
// AI procesov: seznam procesov za direktorja podjetja in interna priporocila
// za Matjaza.
//
// Cist modul brez DOM-a. Kar rabi stran (izluscevanje vprasanj iz HTML
// obrazca, ime izpolnjevalca; oboje v app.js), dobi kot parameter, zato ga
// test pozene v Node (test/izvoz.test.mjs).

const TZ = 'Europe/Ljubljana';

// Isto kot HONEYPOT v app.js: past za robote, ne odgovor stranke.
const HONEYPOT = 'company_url';
// Metapodatki oddaje, ki niso odgovor na vprasanje.
const NI_ODGOVOR = new Set([HONEYPOT, 'gdpr_consent', 'marketing_consent']);

const STATUS = {
  nov: 'nov', kvalificiran: 'kvalificiran', kontaktiran: 'kontaktiran', sestanek: 'sestanek',
  ponudba: 'ponudba poslana', dobljen: 'posel dobljen', izgubljen: 'posel izgubljen',
};
const STATUS_SEJE = {
  osnutek: 'osnutek (zapis morda ni dokončan)', zakljucen: 'zaključen',
  poslan: 'zaključen in poslan stranki', arhiv: 'arhiviran',
};
const VIR_TRANSKRIPTA = { rocno: 'ročno prilepljen', api: 'samodejno prenesen', scrape: 'samodejno prenesen' };

// ── Datumi in imena ───────────────────────────────────────────────────────

function deliCasa(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  return Object.fromEntries(p.map(x => [x.type, x.value]));
}

// "8. 10. 2026". DATE stolpci pridejo kot gol niz (src/db.js), zato brez pretvorbe v cas.
export function dan(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${+m[3]}. ${+m[2]}. ${m[1]}`;
  const p = deliCasa(v);
  return p ? `${+p.day}. ${+p.month}. ${p.year}` : '';
}

function danInUra(v) {
  const p = deliCasa(v);
  return p ? `${+p.day}. ${+p.month}. ${p.year} ob ${p.hour}.${p.minute}` : '';
}

// "2026-10-08" za imena datotek, da se razvrstijo po casu.
function isoDan(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})$/);
  if (m) return m[1];
  const p = deliCasa(v);
  return p ? `${p.year}-${p.month}-${p.day}` : '';
}

// Ime za datoteko: brez sumnikov in presledkov ("Kovačič" -> "kovacic").
export function slug(s, max = 40) {
  return String(s ?? '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, max).replace(/-+$/, '');
}

const st2 = (i) => String(i + 1).padStart(2, '0');
const prazno = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const citat = (t) => String(t).trim().split(/\r?\n/).map(v => `> ${v}`.trimEnd()).join('\n');

// ── Odgovori ──────────────────────────────────────────────────────────────

// En odgovor v besedilo. Pri izbirnih vprasanjih se shrani `value`, clovek pa
// je videl `label` ("imamo" -> "Imamo dostop"), zato se vrednost prevede.
export function besediloOdgovora(q, v) {
  if (prazno(v)) return '';
  if (v === true || v === 'on') return 'Da';
  if (v === false) return 'Ne';
  const oznake = new Map((Array.isArray(q?.options) ? q.options : []).map(o =>
    (o && typeof o === 'object')
      ? [String(o.value ?? o.label ?? ''), String(o.label ?? o.value ?? '')]
      : [String(o), String(o)]));
  const ena = (x) => (x && typeof x === 'object')
    ? JSON.stringify(x)
    : (oznake.get(String(x)) ?? String(x)).trim();
  if (Array.isArray(v)) return v.map(ena).filter(Boolean).join('; ');
  return ena(v);
}

// Vprasanja z odgovori v vrstnem redu obrazca. Neodgovorjena se izpustijo
// (Claude ne rabi praznih vrstic), stejejo pa v "odgovorjeno X od Y".
export function vrsticeOdgovora(raw, vprasanja) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const qs = Array.isArray(vprasanja) ? vprasanja : [];
  const obdelani = new Set(NI_ODGOVOR);
  const vrstice = [];
  let sklop = '', st = 0, odgovorjeno = 0;

  for (const q of qs) {
    if (!q || obdelani.has(q.id)) continue;
    obdelani.add(q.id);
    if (q.tip === 'section') { sklop = q.label || ''; continue; }
    if (q.sklop) sklop = q.sklop;
    st++;
    const odgovor = besediloOdgovora(q, r[q.id]);
    if (!odgovor) continue;
    odgovorjeno++;
    vrstice.push({ sklop, vprasanje: q.label || q.id, odgovor });
  }

  // Polja brez vprasanja (stare oddaje, preimenovana vprasanja): pod kljucem,
  // da se ne izgubijo.
  for (const [k, v] of Object.entries(r)) {
    if (obdelani.has(k) || k.startsWith('_') || prazno(v)) continue;
    const odgovor = besediloOdgovora({}, v);
    if (odgovor) vrstice.push({ sklop: qs.length ? 'Ostala polja' : 'Odgovori', vprasanje: k, odgovor });
  }

  return { vrstice, st, odgovorjeno };
}

function izvorVprasanj(r) {
  if (r.score) return `iz aplikacije AI Business Score (različica ${r.score.score_version})`;
  if (r.ima_snapshot) return 'kopija ob oddaji (točno to, kar je izpolnjevalec videl)';
  if (r.vprasalnik_urejen_po_oddaji) {
    return 'današnja različica vprašalnika; vprašalnik je bil po oddaji urejen, zato se nekatera besedila lahko razlikujejo od tistih, ki jih je izpolnjevalec videl';
  }
  return 'današnja različica vprašalnika (od oddaje ni bil urejen)';
}

function mdScore(rez) {
  if (!rez) return [];
  const d = rez.dimenzije || {};
  const L = ['', '## Rezultat AI Business Score (izračunan ob oddaji)', ''];
  if (rez.skupno != null) L.push(`- Skupna ocena: ${rez.skupno} od 100`);
  if (rez.stopnja?.naziv) L.push(`- Stopnja AI zrelosti: ${rez.stopnja.naziv}`);
  if (Object.keys(d).length) {
    L.push(`- Po dimenzijah (od 100): zrelost ${d.zrelost}, potencial procesov ${d.potencial}, pripravljenost ${d.pripravljenost}, finančni potencial ${d.financni}`);
  }
  if (rez.proces?.naziv) {
    L.push(`- Področje z največjim potencialom: ${rez.proces.naziv}${rez.proces.priporocilo ? ` (priporočen prvi projekt: ${rez.proces.priporocilo})` : ''}`);
  }
  if (rez.ovira) L.push(`- Največja ovira po mnenju izpolnjevalca: ${rez.ovira}`);
  if (rez.lead?.razred) {
    L.push(`- Interna prodajna ocena leada: razred ${rez.lead.razred}${rez.lead.razlogi?.length ? ` (${rez.lead.razlogi.join(', ')})` : ''}`);
  }
  return L;
}

function mdOdgovora(r, oseba, odg, podjetje) {
  const L = [
    `# ${r.q_naziv}: ${oseba.ime}`, '',
    `- Podjetje: ${podjetje}`,
    `- Izpolnil/-a: ${oseba.ime}${oseba.vloga ? `, ${oseba.vloga}` : ''}`,
    `- Oddano: ${danInUra(r.submitted_at)}`,
  ];
  if (odg.st) L.push(`- Odgovorjenih vprašanj: ${odg.odgovorjeno} od ${odg.st}`);
  L.push(`- Besedila vprašanj: ${izvorVprasanj(r)}`);

  let sklop = null;
  if (!odg.vrstice.length) L.push('', '_Odgovor nima izpolnjenih polj._');
  for (const v of odg.vrstice) {
    if (v.sklop !== sklop) {
      sklop = v.sklop;
      if (sklop) L.push('', `## ${sklop}`);
    }
    L.push('', `### ${v.vprasanje}`, '', citat(v.odgovor));
  }

  L.push(...mdScore(r.score?.rezultat));
  if (r.ai_povzetek) {
    L.push('', '## Samodejni AI povzetek tega odgovora', '',
      '_Pripravila ga je aplikacija; vir so zgornji odgovori._', '', r.ai_povzetek.trim());
  }
  return L.join('\n') + '\n';
}

// ── Procesne seje ─────────────────────────────────────────────────────────

function mdSeje(s, transkriptDatoteka) {
  const naslov = s.proces || s.q_naziv;
  const L = [`# Zapis s sestanka: ${naslov}`, ''];
  const polja = [
    ['Vprašalnik', s.q_naziv], ['Stranka', s.stranka_naziv], ['Proces', s.proces],
    ['Oddelek', s.oddelek], ['Svetovalec (Acenta)', s.svetovalec],
    ['Datum sestanka', dan(s.datum_sestanka)], ['Status zapisa', STATUS_SEJE[s.status] || s.status],
    ['Transkript', transkriptDatoteka ? `v datoteki ${transkriptDatoteka}` : 'ni shranjen'],
  ];
  for (const [k, v] of polja) if (v) L.push(`- ${k}: ${v}`);

  L.push('', '## Kaj je svetovalec zapisal med sestankom');
  // vprasalnikVBesedilo (streznik) pise sklope kot "## "; tu so en nivo nizje.
  const besedilo = String(s.besedilo || '').trim().replace(/^## /gm, '### ');
  L.push('', besedilo || '_Vprašalnik seje je prazen._');

  if (s.ai_povzetek) {
    L.push('', '## Samodejni AI povzetek seje', '', '_Pripravila ga je aplikacija._', '', s.ai_povzetek.trim());
  }
  return L.join('\n') + '\n';
}

function mdTranskripta(s, sejaDatoteka) {
  const L = [
    `# Transkript sestanka: ${s.proces || s.q_naziv}${s.datum_sestanka ? ` (${dan(s.datum_sestanka)})` : ''}`, '',
    `Zapis svetovalca s tega sestanka je v datoteki ${sejaDatoteka}.`,
  ];
  if (s.transkripti.length > 1) {
    L.push('', `Število shranjenih transkriptov: ${s.transkripti.length}. Lahko gre za več delov istega sestanka ali za popravljeno različico; preverite po vsebini.`);
  }
  s.transkripti.forEach((t, i) => {
    L.push('', `## Transkript ${i + 1}: shranjen ${dan(t.fetched_at)}, ${VIR_TRANSKRIPTA[t.vir] || t.vir}`, '', String(t.raw_text).trim());
  });
  return L.join('\n') + '\n';
}

// ── Pregled podjetja in navodila ──────────────────────────────────────────

function mdPodjetja(data, kazalo, ljudje) {
  const c = data.company;
  const L = [`# ${c.naziv_prikaz}`, '', `Izvoz iz Acentine baze vprašalnikov, ${danInUra(data.izvozeno_at)}.`, ''];
  L.push(`- Prodajni status pri Acenti: ${STATUS[c.status] || c.status || 'ni določen'}`);
  if (c.kvalifikacija) {
    L.push(`- Ocena leada: ${c.kvalifikacija.toUpperCase()}${c.kvalifikacija_razlog ? ` (${c.kvalifikacija_razlog})` : ''}`);
  }
  if (c.created_at) L.push(`- V bazi od: ${dan(c.created_at)}`);
  if (c.last_response_at) L.push(`- Zadnji odgovor: ${dan(c.last_response_at)}`);

  if (c.interne_opombe) {
    L.push('', `## Interne opombe Acente${c.interne_opombe_updated_at ? ` (${dan(c.interne_opombe_updated_at)})` : ''}`, '',
      '_Kar vemo mi, ne iz odgovorov. Stranka tega ne vidi._', '', String(c.interne_opombe).trim());
  }

  if (ljudje.length) {
    L.push('', `## Kdo je izpolnjeval vprašalnike (${ljudje.length})`, '');
    for (const o of ljudje) L.push(`- ${o.ime}${o.vloga ? `, ${o.vloga}` : ''} (${o.vprasalniki.join(', ')})`);
  }

  for (const [naslov, vrstice] of kazalo) {
    if (!vrstice.length) continue;
    L.push('', `## ${naslov}`, '', ...vrstice);
  }
  return L.join('\n') + '\n';
}

const STATUS_KATALOGA = {
  produkcija: 'v produkciji', pilot: 'v pilotu', prototip: 'prototip ali demo',
  ponudba: 'samo ponudba, še ni zgrajeno', ideja: 'ideja', ustavljeno: 'ustavljeno',
};

function imaKatalog(k) {
  return !!(k && ((k.resitve || []).length || String(k.ne_priporocamo || '').trim()));
}

function mdKataloga(k) {
  const L = [
    '# Katalog Acentinih rešitev', '',
    'Kaj Acenta zna narediti in kje to že deluje. Status je zapisan pošteno: rešitve »v pilotu« ne opisujte kot »v produkciji«.',
  ];
  for (const r of k.resitve || []) {
    L.push('', `## ${r.naziv}`, '', `- Status: ${STATUS_KATALOGA[r.status] || r.status}`);
    if (r.tezava) L.push(`- Težava, ki jo reši: ${r.tezava}`);
    if (r.kaj_naredi) L.push(`- Kaj naredi AI in kaj ostane človeku: ${r.kaj_naredi}`);
    if (r.kje) L.push(`- Kje že deluje: ${r.kje}`);
    if (r.panoga) L.push(`- Panoga: ${r.panoga}`);
    L.push(`- Smemo stranko omeniti pred drugo stranko: ${r.smemo_omeniti ? 'da' : 'ne (v dokumentu za direktorja je ne imenujte)'}`);
  }
  if (String(k.ne_priporocamo || '').trim()) {
    L.push('', '## Česa ne priporočamo', '', String(k.ne_priporocamo).trim());
  }
  return L.join('\n') + '\n';
}

function mdNavodil(data, stevci) {
  const ime = data.company.naziv_prikaz;
  const katalog = imaKatalog(data.katalog);
  const opombe = !!String(data.company.interne_opombe || '').trim();
  const gradivo = [
    `- \`01-podjetje.md\`: osnovni podatki, ${opombe ? 'interne opombe Acente, ' : ''}seznam ljudi, ki so sodelovali, in kazalo vseh virov.`,
  ];
  if (katalog) {
    gradivo.push('- `02-acenta-resitve.md`: katalog rešitev, ki jih Acenta že zna narediti, s poštenim statusom, in seznam, česa ne priporočamo.');
  }
  if (stevci.odgovori) {
    gradivo.push(`- \`odgovori/\`: oddani vprašalniki (${stevci.odgovori}). Vsaka datoteka pove, kdo je izpolnjeval (ime in vloga, kadar sta znana) in kdaj.`);
  }
  if (stevci.seje) {
    gradivo.push(`- \`procesne-seje/\`: zapisi s sestankov (${stevci.seje}), ki jih je med pogovorom s stranko vodil naš svetovalec${stevci.transkripti ? `, in transkripti teh sestankov (${stevci.transkripti})` : ''}.`);
  }
  if (stevci.priporocila) {
    gradivo.push('- `obstojeca-ai-priporocila/`: priporočila, ki jih je prej samodejno pripravila naša aplikacija, vsako iz enega samega vprašalnika. So izhodišče za primerjavo, ne dejstvo: lahko so zastarela ali enostranska.');
  }

  const viri = ['Odgovori zaposlenih'];
  if (stevci.seje) viri.push('zapisi sestankov');
  if (stevci.transkripti) viri.push('transkripti');
  const glavniVir = viri.length === 1
    ? 'Odgovori zaposlenih so'
    : `${viri.slice(0, -1).join(', ')} in ${viri.at(-1)} so`;

  const pravila = [
    `Preberite vse datoteke, preden začnete pisati. ${glavniVir} glavni vir.`,
    'Izluščite vsak proces ali opravilo, ki ga želi kdo olajšati, pospešiti ali avtomatizirati, tudi kadar tega ne pove naravnost (npr. »vsak teden ročno prepisujemo naročila«). Enake želje različnih ljudi združite v en proces in preštejte, koliko ljudi ga omenja.',
    'Vsak proces podprite z virom: kdo ga je omenil in kratek dobeseden citat. V dokumentu 2 dodajte še ime datoteke, da Matjaž vir lahko preveri; v dokumentu 1 imen datotek ni.',
    'Ne izmišljujte številk, cen, rokov ali prihrankov. Številko navedite samo, če jo je dal nekdo v gradivu, in povejte, kdo. Kjer številke ni, napišite, kako jo bomo izmerili (npr. »koliko ur na teden: vprašati vodjo recepcije«).',
    'Ne obljubljajte rezultatov in ne navajajte cen naših storitev. Ceno pripravi Matjaž.',
    'Ločite, kar so ljudje povedali, od svojih predpostavk. Predpostavke označite.',
    'Če si odgovori nasprotujejo ali se želje vodstva in zaposlenih razlikujejo, to izrecno zapišite. Za prodajo je to pomemben podatek.',
    `Ne predlagajte splošnih orodij, ki jih podjetje lahko kupi samo (Microsoft Copilot, naročnine ChatGPT, DeepL, Canva ipd.), in ne pripravljajte načrta izobraževanja. Acenta za stranko izdela in uvede rešitev za konkreten proces; vsak predlagani proces opišite kot tako rešitev.${stevci.priporocila ? ' Obstoječa AI priporočila v paketu so pogosto prav taka splošna, zato jih v tem delu ne povzemajte.' : ''}${katalog && String(data.katalog.ne_priporocamo || '').trim() ? ' Upoštevajte tudi razdelek »Česa ne priporočamo« v `02-acenta-resitve.md`.' : ''}`,
  ];
  if (katalog) {
    pravila.push(
      'Vsak proces povežite z rešitvijo iz kataloga, kadar ta obstaja, in njen status navedite tako, kot je zapisan. Proces brez ustrezne rešitve v katalogu označite kot »nova rešitev«.',
      'Drugo stranko iz kataloga v dokumentu 1 omenite samo, kjer piše »Smemo stranko omeniti: da«. V dokumentu 2 so imena strank dovoljena.',
    );
  }
  if (opombe) {
    pravila.push('Interne opombe v `01-podjetje.md` so dejstva, ki jih vemo mi (npr. katera orodja podjetje že ima). Upoštevajte jih, v dokumentu 1 pa jih ne navajajte.');
  }

  return `# Navodila za Claude: prodajni predlog AI procesov za ${ime}

## Namen

Matjaž iz agencije Acenta gre s tem gradivom k direktorju podjetja ${ime}. Direktorju želi pokazati, katere procese v njegovem podjetju je smiselno avtomatizirati ali podpreti z umetno inteligenco, in mu dati seznam, iz katerega direktor sam izbere, s čim začeti. Seznam mora temeljiti na tem, kar si želijo njegovi zaposleni. Cilj je, da podjetje izvedbo zaupa Acenti.

Pripravite dva ločena dokumenta:

1. **Seznam procesov za direktorja**: Matjaž ga pokaže ali pošlje direktorju.
2. **Prodajna priporočila za Matjaža**: interni list, kako predlog predstaviti in kaj ponuditi. Ni za stranko.

## Gradivo v paketu

${gradivo.join('\n')}

## Kako delate

${pravila.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## Dokument 1: Seznam procesov za direktorja

Pišite slovensko, direktorja vikajte. Brez splošnih fraz (»odlična kakovost«, »najboljši na trgu«) in brez tehničnega žargona: bralec je direktor, ki odloča, ne tehnik. Zaposlene navajajte po vlogi ali oddelku, ne po imenu, in ne vključujte e-naslovov ali telefonskih številk.

Začnite z dvema ali tremi stavki: koliko ljudi je sodelovalo in kaj smo od njih slišali.

Nato za vsak proces, razvrščeno od najbolj priporočenega:

- **Ime procesa** in oddelek
- **Kaj pravijo vaši ljudje**: kako poteka danes in kaj jih moti, z enim ali dvema kratkima citatoma
- **Kako bi pomagala umetna inteligenca**: konkretno, kaj naredi AI in kaj ostane človeku
- **Kaj pridobite**: čas, manj napak, hitrejši odziv, prihodek; samo kar izhaja iz gradiva
- **Zahtevnost uvedbe**: nizka, srednja ali visoka, z enim stavkom zakaj (kateri sistemi in podatki so potrebni)
- **Koliko ljudi si to želi**: število in vloge

Na koncu tabela za izbiro: proces | kdo si ga želi | korist | zahtevnost | naše priporočilo (za začetek / naslednji korak / kasneje). Pod tabelo en stavek, ki direktorja povabi, naj izbere enega ali dva procesa za začetek, in predlog naslednjega koraka (kratek sestanek, na katerem skupaj izberemo prvi proces).

## Dokument 2: Prodajna priporočila za Matjaža

Kratko, v alinejah, imena ljudi so tu dovoljena:

- **S čim odpreti pogovor**: proces z največ podpore med ljudmi in najhitrejšim vidnim rezultatom; zakaj prav ta
- **Prvi projekt**: obseg, kdo pri stranki sodeluje, kako bomo izmerili uspeh; brez cene
- **Kdo odloča in kdo bo zagovornik**: kdo si spremembe najbolj želi in kdo ima besedo
- **Možni zadržki direktorja** (strošek, varnost podatkov, odziv zaposlenih, pomanjkanje časa) in kako nanje odgovoriti z dejstvi iz gradiva
- **Česa ne vemo**: vprašanja, ki jih mora Matjaž postaviti, preden pripravi ponudbo
- **Znaki pripravljenosti za nakup** in opozorila (npr. »samo raziskujemo«, ni proračuna), kadar so v gradivu
`;
}

// ── Sestava paketa ────────────────────────────────────────────────────────

// data = odziv /api/companies/:id/izvoz
// vprasanjaZa(r) -> vprasanja odgovora (app.js: vprasanjaZaPrikaz)
// izpolnjevalec(raw, vprasanja) -> { ime, vloga, ... } (app.js)
// Vrne [{ ime: 'mapa/datoteka.md', vsebina: '...' }].
export function sestaviDatoteke(data, { vprasanjaZa, izpolnjevalec }) {
  const podjetje = data.company.naziv_prikaz;
  const koren = imeMape(data);
  const datoteke = [];
  const dodaj = (pot, vsebina) => datoteke.push({ ime: `${koren}/${pot}`, vsebina });

  const kazaloOdg = [], kazaloSej = [], kazaloPrip = [];
  const ljudje = new Map();
  let stTranskriptov = 0;

  (data.responses || []).forEach((r, i) => {
    const vprasanja = r.score ? [] : vprasanjaZa(r);
    const oseba = izpolnjevalec(r.raw_data, vprasanja);
    const odg = r.score
      ? { vrstice: r.score.vrstice.map(([vprasanje, odgovor]) => ({ sklop: '', vprasanje, odgovor })), st: 0, odgovorjeno: 0 }
      : vrsticeOdgovora(r.raw_data, vprasanja);
    const pot = `odgovori/${st2(i)}-${isoDan(r.submitted_at)}-${slug(r.q_slug || r.q_naziv, 30)}-${slug(oseba.ime, 30) || 'anonimno'}.md`;
    dodaj(pot, mdOdgovora(r, oseba, odg, podjetje));
    kazaloOdg.push(`${i + 1}. \`${pot}\`: ${r.q_naziv}, ${oseba.ime}${oseba.vloga ? ` (${oseba.vloga})` : ''}, ${dan(r.submitted_at)}`);

    // Isti clovek na vec vprasalnikih je en clovek; anonimni odgovori so vsak svoj.
    const kljuc = oseba.imaIme ? oseba.ime.toLowerCase() : `#${r.id}`;
    if (!ljudje.has(kljuc)) ljudje.set(kljuc, { ime: oseba.ime, vloga: oseba.vloga, vprasalniki: [] });
    const o = ljudje.get(kljuc);
    if (!o.vloga && oseba.vloga) o.vloga = oseba.vloga;
    if (!o.vprasalniki.includes(r.q_naziv)) o.vprasalniki.push(r.q_naziv);
  });

  (data.seje || []).forEach((s, i) => {
    const osnova = `procesne-seje/${st2(i)}-${isoDan(s.datum_sestanka || s.created_at)}-${slug(s.proces || s.q_naziv, 40) || 'seja'}`;
    const tr = s.transkripti?.length ? `${osnova}-transkript.md` : null;
    dodaj(`${osnova}.md`, mdSeje(s, tr));
    if (tr) {
      dodaj(tr, mdTranskripta(s, `${osnova}.md`));
      stTranskriptov += s.transkripti.length;
    }
    const opis = [s.proces, s.oddelek].filter(Boolean).join(', ') || s.q_naziv;
    kazaloSej.push(`${i + 1}. \`${osnova}.md\`: ${opis}${s.svetovalec ? `, svetovalec ${s.svetovalec}` : ''}${s.datum_sestanka ? `, ${dan(s.datum_sestanka)}` : ''}${tr ? ', s transkriptom' : ''}`);
  });

  (data.priporocila || []).forEach((p, i) => {
    const pot = `obstojeca-ai-priporocila/${st2(i)}-${slug(p.naziv_prikaz, 40) || 'vprasalnik'}.md`;
    dodaj(pot, [
      `# Samodejna AI priporočila: ${p.naziv_prikaz}`, '',
      `> Pripravila jih je aplikacija ${dan(p.updated_at)}, samo iz odgovorov na ta vprašalnik. Uporabite jih kot izhodišče za primerjavo, ne kot dejstvo.`,
      '', String(p.vsebina || '').trim(), '',
    ].join('\n'));
    kazaloPrip.push(`${i + 1}. \`${pot}\`: ${p.naziv_prikaz}, ${dan(p.updated_at)}`);
  });

  const stevci = {
    odgovori: kazaloOdg.length, seje: kazaloSej.length,
    transkripti: stTranskriptov, priporocila: kazaloPrip.length,
  };
  const kazalo = [
    [`Oddani vprašalniki (${kazaloOdg.length})`, kazaloOdg],
    [`Zapisi s sestankov (${kazaloSej.length})`, kazaloSej],
    [`Obstoječa AI priporočila (${kazaloPrip.length})`, kazaloPrip],
  ];

  return [
    { ime: `${koren}/00-NAVODILA-ZA-CLAUDE.md`, vsebina: mdNavodil(data, stevci) },
    { ime: `${koren}/01-podjetje.md`, vsebina: mdPodjetja(data, kazalo, [...ljudje.values()]) },
    ...(imaKatalog(data.katalog) ? [{ ime: `${koren}/02-acenta-resitve.md`, vsebina: mdKataloga(data.katalog) }] : []),
    ...datoteke,
  ];
}

export function imeMape(data) {
  return `${slug(data.company.naziv_prikaz, 40) || 'podjetje'}-za-claude-${isoDan(data.izvozeno_at)}`;
}

// ── ZIP ───────────────────────────────────────────────────────────────────
// Brez stiskanja (metoda "stored"): datoteke so majhno besedilo, zapis pa je
// tako preprost, da ne rabi knjiznice.

const CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bajti) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bajti.length; i++) c = CRC_TABELA[(c ^ bajti[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// datoteke = [{ ime, vsebina: string }] -> Uint8Array (veljaven .zip)
export function zip(datoteke, cas = new Date()) {
  const enc = new TextEncoder();
  // Cas v DOS obliki (lokalni cas, 2-sekundna natancnost), kot ga pricakuje ZIP.
  const dosCas = (cas.getHours() << 11) | (cas.getMinutes() << 5) | (cas.getSeconds() >> 1);
  const dosDan = ((Math.max(cas.getFullYear(), 1980) - 1980) << 9) | ((cas.getMonth() + 1) << 5) | cas.getDate();
  const UTF8 = 0x0800; // bit 11: imena datotek so UTF-8

  const lokalni = [], centralni = [];
  let odmik = 0;
  for (const d of datoteke) {
    const ime = enc.encode(d.ime);
    const vsebina = enc.encode(d.vsebina);
    const crc = crc32(vsebina);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, UTF8, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, dosCas, true);
    lh.setUint16(12, dosDan, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, vsebina.length, true);
    lh.setUint32(22, vsebina.length, true);
    lh.setUint16(26, ime.length, true);
    lh.setUint16(28, 0, true);
    lokalni.push(new Uint8Array(lh.buffer), ime, vsebina);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, UTF8, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosCas, true);
    ch.setUint16(14, dosDan, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, vsebina.length, true);
    ch.setUint32(24, vsebina.length, true);
    ch.setUint16(28, ime.length, true);
    ch.setUint32(42, odmik, true);
    centralni.push(new Uint8Array(ch.buffer), ime);

    odmik += 30 + ime.length + vsebina.length;
  }

  const velikostCentralnega = centralni.reduce((s, b) => s + b.length, 0);
  const konec = new DataView(new ArrayBuffer(22));
  konec.setUint32(0, 0x06054b50, true);
  konec.setUint16(8, datoteke.length, true);
  konec.setUint16(10, datoteke.length, true);
  konec.setUint32(12, velikostCentralnega, true);
  konec.setUint32(16, odmik, true);

  const deli = [...lokalni, ...centralni, new Uint8Array(konec.buffer)];
  const izhod = new Uint8Array(deli.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of deli) { izhod.set(b, p); p += b.length; }
  return izhod;
}
