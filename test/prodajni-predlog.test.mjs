// Jedro prodajnega predloga (src/ai/generate_prodajni_predlog.js) brez baze in
// brez AI: vhod, razclenitev odgovora, preverjanje izhoda in en popravek.
// AI je lazna funkcija, zato test ne porabi nobenega klica.
import {
  sestaviVhod, razcleni, imenaLjudi, prepovedanaImenaStrank, preveri, pripraviPredlog, MAX_ZNAKOV,
} from '../src/ai/generate_prodajni_predlog.js';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

const K = 'hotel-lipa-za-claude-2026-10-09';
const PODJETJE = `# Hotel Lipa d.o.o.

- Prodajni status pri Acenti: nov

## Kdo je izpolnjeval vprašalnike (4)

- Petra Novak, vodja recepcije (Moj AI načrt)
- Janez Kos, kuhar (Moj AI načrt)
- Anonimni odgovor (AI delavnica)
- maja@lipa.si (AI delavnica)

## Oddani vprašalniki (3)

1. \`odgovori/01-x.md\`: ...
`;
const ODG = `# Moj AI načrt: Petra Novak

### Katere naloge bi najraje optimizirali z AI?

> Vsak teden ročno prepisujemo rezervacije iz e-pošte v sistem, to vzame 5 ur na teden.

### Kaj vas moti?

> Odgovarjanje na ista vprašanja gostov, približno 30 % e-pošte.
`;
const datoteke = [
  { ime: `${K}/00-NAVODILA-ZA-CLAUDE.md`, vsebina: '# Navodila' },
  { ime: `${K}/01-podjetje.md`, vsebina: PODJETJE },
  { ime: `${K}/02-acenta-resitve.md`, vsebina: '# Katalog' },
  { ime: `${K}/odgovori/01-2026-10-01-moj-ai-nacrt-petra-novak.md`, vsebina: ODG },
  { ime: `${K}/odgovori/02-2026-10-01-moj-ai-nacrt-janez-kos.md`, vsebina: '# Janez' },
  { ime: `${K}/procesne-seje/01-2026-10-02-rezervacije.md`, vsebina: '# Seja' },
  { ime: `${K}/procesne-seje/01-2026-10-02-rezervacije-transkript.md`, vsebina: '# Transkript' },
];

console.log('\n=== sestaviVhod ===');
const v = sestaviVhod(datoteke);
t('korenska mapa odrezana', v.besedilo.includes('<datoteka ime="01-podjetje.md">') && !v.besedilo.includes(K));
t('stevci: 2 odgovora, 1 seja, 1 transkript, katalog',
  v.stevci.odgovori === 2 && v.stevci.seje === 1 && v.stevci.transkripti === 1 && v.stevci.katalog === true,
  JSON.stringify(v.stevci));
t('vsebina datoteke je v oznaki', /<datoteka ime="odgovori\/01-[^"]+">\n# Moj AI načrt/.test(v.besedilo));
t('ni opozoril, ni prevelik', v.opozorila.length === 0 && v.prevelik === false);
t('neveljavne vrstice izpusti', sestaviVhod([{ ime: 'a/x.md' }, null, { ime: 'a/y.md', vsebina: 'y' }]).stevci.datotek === 1);

const dolg = 'x'.repeat(MAX_ZNAKOV);
const vVelik = sestaviVhod([...datoteke, { ime: `${K}/procesne-seje/02-2026-10-03-a-transkript.md`, vsebina: dolg }]);
t('prevelik paket: transkripti izpusceni z opozorilom',
  vVelik.stevci.transkripti === 0 && vVelik.stevci.seje === 1 && vVelik.opozorila.length === 1 && !vVelik.prevelik,
  JSON.stringify({ ...vVelik.stevci, op: vVelik.opozorila }));
const vPrevelik = sestaviVhod([...datoteke, { ime: `${K}/odgovori/09-x.md`, vsebina: dolg }]);
t('prevelik brez transkriptov za izpustiti: prevelik=true', vPrevelik.prevelik === true);

console.log('\n=== razcleni ===');
const r = razcleni('uvod\n<za_direktorja>\n# D1\n</za_direktorja>\n<za_matjaza>\n# D2\n</za_matjaza>');
t('oba dokumenta', r?.za_direktorja === '# D1' && r?.za_matjaza === '# D2', JSON.stringify(r));
t('manjka eden: null', razcleni('<za_direktorja>x</za_direktorja>') === null);
t('prazen del: null', razcleni('<za_direktorja> </za_direktorja><za_matjaza>x</za_matjaza>') === null);
t('ni niz: null', razcleni(null) === null);

console.log('\n=== imenaLjudi / prepovedanaImenaStrank ===');
const imena = imenaLjudi(datoteke);
t('imena izpolnjevalcev brez anonimnih in e-naslovov', JSON.stringify(imena) === JSON.stringify(['Petra Novak', 'Janez Kos']), JSON.stringify(imena));
t('brez 01-podjetje.md: prazno', imenaLjudi([{ ime: 'x/odgovori/1.md', vsebina: '' }]).length === 0);

const katalog = {
  resitve: [
    { kje: 'Več hotelov na Bledu (Hotel Brinovec, Vila Zvoncek), hotel Javorje', smemo_omeniti: false },
    { kje: 'Elektrotest (izvedeno); Zavod Kultura Testovo (pripravljeno)', smemo_omeniti: false },
    { kje: 'Interno pri Acenti (Ads Radar)', smemo_omeniti: true },
  ],
};
const stranke = prepovedanaImenaStrank(katalog, 'Javni zavod Kultura Testovo');
t('prepovedana imena: Brinovec, Zvoncek, Javorje, Elektrotest', ['Brinovec', 'Zvoncek', 'Javorje', 'Elektrotest'].every(s => stranke.includes(s)), JSON.stringify(stranke));
t('splosne besede in lastno podjetje niso prepovedani', !stranke.some(s => ['Hotel', 'Vila', 'Bledu', 'Zavod', 'Kultura', 'Testovo', 'Več'].includes(s)), JSON.stringify(stranke));
t('resitev, ki jo smemo omeniti, ne prispeva imen', !stranke.includes('Radar'));

console.log('\n=== preveri ===');
const vhod = v.besedilo;
const kontekst = { vhod, imena, stranke };
const DOBER = `Pri anketah je sodelovalo 4 ljudi.

### 1. Rezervacije iz e-pošte (recepcija)

- **Kaj pravijo vaši ljudje**: »Vsak teden ročno prepisujemo rezervacije iz e-pošte v sistem.« Vodja recepcije ocenjuje 5 ur na teden.
- **Zahtevnost uvedbe**: srednja.

### 2. Odgovori gostom (recepcija)

- **Kaj pravijo vaši ljudje**: »Odgovarjanje na ista vprašanja gostov« vzame okoli 30 % e-pošte.

| proces | korist |
|---|---|
| Rezervacije | čas |`;
const dober = { za_direktorja: DOBER, za_matjaza: 'Petra Novak je zagovornica. Copilota ne predlagamo, Javorje je referenca. Vir: odgovori/01.md' };
const tDober = preveri(dober, kontekst);
t('dober predlog: brez tezav (dokument 2 sme imena, orodja, datoteke)', tDober.length === 0, JSON.stringify(tDober));

const tezave = (d1) => preveri({ za_direktorja: d1, za_matjaza: 'x' }, kontekst);
t('splosno orodje v dokumentu 1', tezave(`${DOBER}\nPredlagamo Microsoft Copilot in DeepL.`).some(x => x.includes('copilot') && x.includes('deepl')));
t('ChatGPT z razmikom in sklonom', tezave(`${DOBER}\nz Chat GPT-jem`).some(x => x.includes('splošno orodje')));
t('proces brez citata', tezave(`${DOBER}\n\n### 3. Poročila (vodstvo)\n\nRočno sestavljanje poročil.`).some(x => x.includes('»3. Poročila (vodstvo)« nima')));
t('brez razdelkov procesov', tezave('Samo uvod.').some(x => x.includes('nima razdelkov')));
t('izmisljena stevilka z enoto', tezave(`${DOBER}\nPrihranek okoli 15 ur na mesec.`).some(x => x.includes('»15 ur«')));
t('izmisljen odstotek', tezave(`${DOBER}\nManj napak za 40 %.`).some(x => x.includes('»40 %«')));
t('stevilka iz vhoda z drugo enoto je izmisljena', tezave(`${DOBER}\nUvedba v 5 dneh.`).some(x => x.includes('»5 dneh«')));
t('stevilka iz vhoda z isto enoto je v redu (5 ur, 30 %)', !tezave(DOBER).some(x => x.includes('številke')));
t('e-naslov', tezave(`${DOBER}\nKontakt: maja@lipa.si`).some(x => x.includes('e-naslov')));
t('telefon', tezave(`${DOBER}\nPokličite 041 123 456.`).some(x => x.includes('telefonsko')));
t('ime datoteke', tezave(`${DOBER}\nVir: odgovori/01-x.md`).some(x => x.includes('imena datotek')));
t('ime zaposlenega', tezave(`${DOBER}\nTo je povedala Petra Novak.`).some(x => x.includes('Petra Novak')));
t('priimek v sklonu', tezave(`${DOBER}\nPo mnenju ge. Novakove`).some(x => x.includes('po imenu')) === false
  && tezave(`${DOBER}\nKot pravi Novaku`).some(x => x.includes('po imenu')), 'sklon do 2 crki');
t('kratek priimek (Kos) ni preverjen, da ne lovi besed', !tezave(`${DOBER}\nKos kruha.`).some(x => x.includes('po imenu')));
t('druga stranka brez dovoljenja', tezave(`${DOBER}\nPodobno delamo v hotelu Javorje.`).some(x => x.includes('Javorje')));
t('druga stranka v sklonu', tezave(`${DOBER}\nkot pri Elektrotestu`).some(x => x.includes('Elektrotest')));
t('prazen dokument 2', preveri({ za_direktorja: DOBER, za_matjaza: ' ' }, kontekst).some(x => x.includes('Matjaža je prazen')));

console.log('\n=== pripraviPredlog (lazni AI) ===');
const ovij = (d1, d2 = '# Za Matjaža') => `<za_direktorja>\n${d1}\n</za_direktorja>\n<za_matjaza>\n${d2}\n</za_matjaza>`;
function lazni(odgovori) {
  const klici = [];
  return { klici, klic: async ({ system, user }) => { klici.push({ system, user }); return odgovori[klici.length - 1] ?? null; } };
}

let f = lazni([ovij(DOBER)]);
let izid = await pripraviPredlog(datoteke, { klic: f.klic, katalog, nazivPodjetja: 'Hotel Lipa d.o.o.' });
t('dober prvi odgovor: en klic, ok, brez opozoril', f.klici.length === 1 && izid.ok && izid.opozorila.length === 0, JSON.stringify(izid.opozorila));
t('system pove obliko z oznakama', f.klici[0].system.includes('<za_direktorja>') && f.klici[0].system.includes('00-NAVODILA-ZA-CLAUDE.md'));
t('user je paket datotek', f.klici[0].user.includes('<datoteka ime="00-NAVODILA-ZA-CLAUDE.md">'));
t('stevci v izidu', izid.stevci.odgovori === 2 && izid.stevci.seje === 1);

f = lazni([ovij(`${DOBER}\nUporabite Canvo.`), ovij(DOBER, '# Popravljen')]);
izid = await pripraviPredlog(datoteke, { klic: f.klic, katalog, nazivPodjetja: 'Hotel Lipa d.o.o.' });
t('tezava: drugi klic s popravkom, rezultat popravljen', f.klici.length === 2 && izid.ok && izid.za_matjaza === '# Popravljen' && izid.opozorila.length === 0);
t('popravek vsebuje prejsnji osnutek in tezavo',
  f.klici[1].user.includes('<prejsnji_osnutek>') && f.klici[1].user.includes('Uporabite Canvo.') && f.klici[1].user.includes('splošno orodje (canvo)'),
  f.klici[1].user.slice(-400));

f = lazni([ovij(`${DOBER}\nUporabite Canvo.`), ovij(`${DOBER}\nUporabite Canvo.`)]);
izid = await pripraviPredlog(datoteke, { klic: f.klic, katalog });
t('se vedno slabo po popravku: shrani z opozorili', izid.ok && izid.opozorila.length === 1 && f.klici.length === 2, JSON.stringify(izid.opozorila));

f = lazni([ovij(`${DOBER}\nUporabite Canvo.`), 'brez oznak']);
izid = await pripraviPredlog(datoteke, { klic: f.klic, katalog });
t('popravek brez oznak: ostane prvi osnutek z opozorili', izid.ok && izid.za_direktorja.includes('Canvo') && izid.opozorila.length === 1);

f = lazni(['brez oznak', ovij(DOBER)]);
izid = await pripraviPredlog(datoteke, { klic: f.klic, katalog });
t('prvi brez oznak, popravek dober: ok', izid.ok && f.klici.length === 2 && izid.opozorila.length === 0);

f = lazni(['brez oznak', 'spet brez']);
izid = await pripraviPredlog(datoteke, { klic: f.klic, katalog });
t('oba brez oznak: napaka', !izid.ok && izid.napaka.includes('obeh dokumentov'));

f = lazni([null]);
izid = await pripraviPredlog(datoteke, { klic: f.klic, katalog });
t('AI se ne odzove: napaka brez ponovnega klica', !izid.ok && f.klici.length === 1 && izid.napaka.includes('ni odzval'));

izid = await pripraviPredlog([], { klic: lazni([]).klic });
t('prazen paket: napaka', !izid.ok && izid.napaka.includes('prazen'));

f = lazni([ovij(DOBER)]);
izid = await pripraviPredlog([...datoteke, { ime: `${K}/procesne-seje/02-a-transkript.md`, vsebina: dolg }], { klic: f.klic, katalog });
t('opozorilo o izpuscenih transkriptih pride v izid', izid.ok && izid.opozorila.some(x => x.includes('Transkripti')));

console.log(`\n${'─'.repeat(46)}\nOK: ${ok}   FAIL: ${fail}`);
if (padli.length) console.log('Padli:\n  - ' + padli.join('\n  - '));
process.exit(fail ? 1 : 0);
