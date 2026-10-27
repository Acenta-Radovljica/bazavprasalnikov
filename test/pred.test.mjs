// Before the workshop: level of knowledge (public/admin/pred.js) and the
// checks around the AI themes (src/ai/generate_pred_teme.js) with a fake AI.
// No server, no database, no API key.
//
// Run: node test/pred.test.mjs
import { ravenZnanja, besediloNajsibkejsih, decimalno, RAVEN_SLUG } from '../public/admin/pred.js';
import { zberiBesedila, preveriTeme, pripraviTeme, normaliziraj, sestaviUporabnika } from '../src/ai/generate_pred_teme.js';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

// Seven made-up respondents with the same shape as the real survey.
const ODG = [
  { pog: 'Vsak dan', r: [2, 2, 2, 1], orodja: '- uporabljam chatGPT (imamo račun tudi na Claude, ampak ne uporabljam)' },
  { pog: 'Pogosto (večkrat na teden)', r: [2, 3, 2, 2], orodja: 'Copilot in Chat GPT, vendar uporabljam malo.' },
  { pog: 'Občasno (1–2× na teden)', r: [4, 4, 4, 4], orodja: 'ChatGPT' },
  { pog: 'Občasno (1–2× na teden)', r: [3, 3, 3, 3], orodja: 'Copilot, gemini ' },
  { pog: 'Vsak dan', r: [2, 2, 3, 2], orodja: 'Uporabil sem že Chat GPT, Copilot in Gemini. Chat za prevode, Gemini za grafike, Copilot-a pa šele spoznavam.' },
  { pog: 'Pogosto (večkrat na teden)', r: [3, 2, 3, 2], orodja: 'ChatGPT, Gimini' },
  { pog: 'Nikoli', r: [2, 1, 1, 2], orodja: 'Ne uporabljam je, razen kadar se pri iskanju podatkov vsili namesto wikipedie.' },
].map((o, i) => ({
  id: i + 1,
  q_slug: RAVEN_SLUG,
  raw_data: {
    q1_pogostost: o.pog,
    q4_razumevanje: String(o.r[0]), q5_orodja_znanje: String(o.r[1]), q6_prompti: String(o.r[2]), q7_omejitve: String(o.r[3]),
    q13_orodja_poznana: o.orodja,
  },
}));

// ── 1. Level ────────────────────────────────────────────────────────────
console.log('\n=== 1. Kako napredni so ===');
let r = ravenZnanja([...ODG, { q_slug: 'moj-ai-nacrt', raw_data: { q4_razumevanje: '1' } }]);
t('udeležencev 7 (drug vprašalnik ne šteje)', r.udelezencev === 7 && r.ocenilo === 7, JSON.stringify([r.udelezencev, r.ocenilo]));
t('povprečje 2,5 (69 / 28)', r.povprecje === 2.5 && decimalno(r.povprecje) === '2,5', r.povprecje);
t('stopnja: Osnovna raven, opozorilni ton', r.stopnja === 'Osnovna raven' && r.ton === 'warning', r.stopnja);
t('področja 2,6 / 2,4 / 2,6 / 2,3', r.podrocja.map(p => p.povprecje).join('|') === '2.6|2.4|2.6|2.3', r.podrocja.map(p => p.povprecje).join('|'));
t('najšibkejše: tveganja in omejitve', JSON.stringify(r.najsibkejsa) === '["Tveganja in omejitve"]', JSON.stringify(r.najsibkejsa));
t('pogostost 2 / 2 / 2 / 0 / 1', r.pogostost.map(p => `${p.naziv}:${p.st}`).join('|') === 'Vsak dan:2|Večkrat na teden:2|Občasno:2|Redko:0|Nikoli:1', r.pogostost.map(p => `${p.naziv}:${p.st}`).join('|'));
t('orodja: ChatGPT 5, Copilot 3, Gemini 3 (tudi »Gimini«), Claude 1', r.orodja.map(o => `${o.naziv}:${o.st}`).join('|') === 'ChatGPT:5|Copilot:3|Gemini:3|Claude:1', r.orodja.map(o => `${o.naziv}:${o.st}`).join('|'));
t('»ne uporabljam« ne šteje nobenega orodja', ravenZnanja([ODG[6]]).orodja.length === 0);

t('brez ankete pred izobraževanjem: null', ravenZnanja([{ q_slug: 'napredni-ai', raw_data: { q1_zrelost: 'AI-first podjetje' } }]) === null);
t('brez samoocen: null', ravenZnanja([{ q_slug: RAVEN_SLUG, raw_data: { q1_pogostost: 'Vsak dan' } }]) === null);
r = ravenZnanja([{ q_slug: RAVEN_SLUG, raw_data: { q4_razumevanje: '9', q5_orodja_znanje: '', q6_prompti: 'x', q7_omejitve: '3' } }]);
t('neveljavne ocene se izpustijo', r.povprecje === 3 && r.podrocja.filter(p => p.povprecje !== null).length === 1, JSON.stringify(r.podrocja));
t('eno ocenjeno področje: brez »najšibkejšega«', r.najsibkejsa.length === 0);

// The number on the page and the label must agree: 2.96 is shown as 3,0.
const meja = [[3, 3, 3, 3], [3, 3, 3, 3], [3, 3, 3, 3], [3, 3, 3, 3], [3, 3, 3, 3], [3, 3, 3, 3], [3, 3, 3, 2]]
  .map(v => ({ q_slug: RAVEN_SLUG, raw_data: { q4_razumevanje: v[0], q5_orodja_znanje: v[1], q6_prompti: v[2], q7_omejitve: v[3] } }));
r = ravenZnanja(meja);
t('2,96 → 3,0 in Dobra raven (številka in oznaka se ujemata)', decimalno(r.povprecje) === '3,0' && r.stopnja === 'Dobra raven', `${r.povprecje} ${r.stopnja}`);
r = ravenZnanja([{ q_slug: RAVEN_SLUG, raw_data: { q4_razumevanje: 4, q5_orodja_znanje: 4, q6_prompti: 3, q7_omejitve: 4 } }]);
t('3,8: Napredna raven', r.stopnja === 'Napredna raven' && r.ton === 'success');
r = ravenZnanja([{ q_slug: RAVEN_SLUG, raw_data: { q4_razumevanje: 1, q5_orodja_znanje: 2, q6_prompti: 1, q7_omejitve: 2 } }]);
t('1,5: Začetna raven', r.stopnja === 'Začetna raven' && r.ton === 'danger');
t('izenačeni najšibkejši področji', JSON.stringify(r.najsibkejsa) === '["Razumevanje AI","Pisanje promptov"]', JSON.stringify(r.najsibkejsa));
r = ravenZnanja([{ q_slug: RAVEN_SLUG, raw_data: { q4_razumevanje: 2, q5_orodja_znanje: 2, q6_prompti: 2, q7_omejitve: 2 } }]);
t('vsa področja enaka: brez »najšibkejšega«', r.najsibkejsa.length === 0);

t('besedilo: ednina', besediloNajsibkejsih(['Tveganja in omejitve']) === 'Najšibkejše področje: tveganja in omejitve.');
t('besedilo: dvojina', besediloNajsibkejsih(['Razumevanje AI', 'Pisanje promptov']) === 'Najšibkejši področji: razumevanje AI in pisanje promptov.');
t('besedilo: množina', besediloNajsibkejsih(['A', 'B', 'C']) === 'Najšibkejša področja: a, b in c.');
t('besedilo: prazno', besediloNajsibkejsih([]) === '');

// ── 2. Texts for the themes ─────────────────────────────────────────────
console.log('\n=== 2. Besedila za teme ===');
const VPR = [
  { id: 'podjetje', label: 'Naziv podjetja', tip: 'text' },
  { id: 'q1_pogostost', label: 'Kako pogosto trenutno uporabljate orodja AI?', tip: 'radio' },
  { id: 'q8_zelje', label: 'Kaj bi si najbolj želeli pridobiti na AI delavnici?', tip: 'checkbox' },
  { id: 'q10_naloge', label: 'Katere naloge pri svojem delu bi najraje optimizirali z AI?', tip: 'textarea' },
  { id: 'q11_ovira', label: 'Kaj vam je pri uporabi AI trenutno največja težava ali ovira?', tip: 'textarea' },
  { id: 'q12_ideja', label: 'Ali imate idejo za uporabo AI, vendar ne veste, kako jo izvesti? Opišite jo.', tip: 'textarea' },
  { id: 'q13_orodja_poznana', label: 'Katera AI orodja že poznate in jih uporabljate?', tip: 'textarea' },
];
const VRSTICE = [
  { id: 101, vprasanja: VPR, raw_data: { podjetje: 'Zavod Lipa', q10_naloge: '- analize in poročila -oblikovanje za spletni marketing - pisanje besedil ', q11_ovira: 'prompti', q12_ideja: '', q13_orodja_poznana: 'ChatGPT' } },
  { id: 102, vprasanja: VPR, raw_data: { q10_naloge: 'priprava poročil in poročanje pri razpisih', q11_ovira: 'omejen dostop', q12_ideja: 'ne' } },
  { id: 103, vprasanja: VPR, raw_data: { q10_naloge: '', q12_ideja: '/', q11_ovira: 'nepoznavanje' } },
  { id: 104, vprasanja: VPR, raw_data: { q10_naloge: 'Prevodi besedil. Chat GPT pri prevajanju učim, katere besede in izrazi so primerni za nas, nato pa to vsakič sproti "pozablja" in dela po svoje.' } },
];
const zbrano = zberiBesedila(VRSTICE);
t('vsak odgovor dobi oznako R1..R4 in svoj id', zbrano.map(z => `${z.ref}=${z.responseId}`).join(',') === 'R1=101,R2=102,R3=103,R4=104');
t('samo vprašanji o delu (naloge, ideja), ne ovira/orodja/izbire', zbrano[0].besedila.map(b => b.vprasanje.slice(0, 7)).join('|') === 'Katere ', JSON.stringify(zbrano[0].besedila));
t('»ne« kot ideja se ohrani (model presodi), »/« in prazno ne', zbrano[1].besedila.length === 2 && zbrano[2].besedila.length === 0, JSON.stringify([zbrano[1].besedila.length, zbrano[2].besedila.length]));
const user = sestaviUporabnika(zbrano);
t('poziv brez odgovora brez besedila (R3) in brez imena podjetja', !user.includes('R3') && !user.includes('Zavod Lipa') && user.includes('R4'), user.slice(0, 200));

// ── 3. Checking the themes ──────────────────────────────────────────────
console.log('\n=== 3. Preverjanje tem ===');
let p = preveriTeme({ teme: [
  { naziv: 'Besedila za marketing', odgovori: ['R1'], citat: 'pisanje besedil', citat_iz: 'R1' },
  { naziv: 'Poročila za razpise', odgovori: ['R1', 'r2'], citat: '»priprava poročil in poročanje pri razpisih«', citat_iz: 'R2' },
  { naziv: 'Prevodi v slogu', odgovori: ['R4'], citat: '…katere besede in izrazi so primerni za nas, nato pa to vsakič sproti "pozablja"', citat_iz: 'R4' },
] }, zbrano);
t('veljavne teme ostanejo, brez težav', p.teme.length === 3 && p.tezave.length === 0, JSON.stringify(p.tezave));
t('razvrščeno po številu ljudi (2 pred 1)', p.teme[0].naziv === 'Poročila za razpise' && p.teme[0].odgovori.join(',') === '101,102', JSON.stringify(p.teme.map(x => x.naziv)));
t('oznake v id-je odgovorov, citat_odgovor', p.teme[0].citat_odgovor === 102);
t('narekovaji okoli citata odstranjeni', p.teme[0].citat === 'priprava poročil in poročanje pri razpisih', p.teme[0].citat);
t('notranji narekovaj citata ostane, tropičje odstranjeno', p.teme.find(x => x.naziv === 'Prevodi v slogu').citat.endsWith('"pozablja"') && !p.teme.find(x => x.naziv === 'Prevodi v slogu').citat.startsWith('…'));

p = preveriTeme({ teme: [
  { naziv: 'Izmišljena tema', odgovori: ['R1'], citat: 'priprava ponudb za skupine', citat_iz: 'R1' },
  { naziv: 'Neznan odgovor', odgovori: ['R9'], citat: 'x x x', citat_iz: 'R9' },
  { naziv: 'Odgovor brez besedila', odgovori: ['R3'], citat: 'nepoznavanje', citat_iz: 'R3' },
  { naziv: 'Citat iz druge teme', odgovori: ['R1'], citat: 'priprava poročil', citat_iz: 'R2' },
  { naziv: 'Poročila za razpise', odgovori: ['R2'], citat: 'poročanje pri razpisih', citat_iz: 'R2' },
  { naziv: 'poročila  ZA razpise', odgovori: ['R1'], citat: 'analize in poročila', citat_iz: 'R1' },
  { naziv: '', odgovori: ['R1'], citat: 'analize', citat_iz: 'R1' },
] }, zbrano);
t('citat, ki ga ni v odgovoru, pade', p.tezave.some(x => x.includes('Izmišljena tema') && x.includes('ni dobesedno')), JSON.stringify(p.tezave));
t('neznana oznaka pade', p.tezave.some(x => x.includes('R9')));
t('odgovor brez besedila o delu ne more nositi teme', p.tezave.some(x => x.includes('Odgovor brez besedila')));
t('citat_iz mora biti med odgovori teme', p.tezave.some(x => x.includes('Citat iz druge teme') && x.includes('citat_iz')));
t('podvojena tema (velike črke, presledki) pade', p.tezave.some(x => x.includes('podvojena')));
t('prazen naziv pade', p.tezave.some(x => x.includes('naziv manjka')));
t('ostane samo veljavna', p.teme.length === 1 && p.teme[0].naziv === 'Poročila za razpise', JSON.stringify(p.teme.map(x => x.naziv)));
t('brez seznama tem: težava', preveriTeme({ x: 1 }, zbrano).tezave[0].includes('teme'));
t('normalizacija: velike črke, presledki, narekovaji', normaliziraj('  »Pisanje   BESEDIL« ') === normaliziraj('"pisanje besedil"'));

// ── 4. One correction with a fake AI ────────────────────────────────────
console.log('\n=== 4. Popravek z laznim AI ===');
const DOBRA = { naziv: 'Poročila za razpise', odgovori: ['R1', 'R2'], citat: 'priprava poročil', citat_iz: 'R2' };
const SLABA = { naziv: 'Ponudbe', odgovori: ['R1'], citat: 'pisanje ponudb', citat_iz: 'R1' };
let klici = [];
let izid = await pripraviTeme(zbrano, { klic: async (x) => { klici.push(x); return JSON.stringify({ teme: [DOBRA] }); } });
t('brez napak: en klic', izid.ok && izid.teme.length === 1 && klici.length === 1);
t('sistemsko navodilo zahteva dobeseden citat in JSON', /dobeseden citat/.test(klici[0].system) && /IZKLJUČNO veljaven JSON/.test(klici[0].system));

klici = [];
const odgovori = [JSON.stringify({ teme: [DOBRA, SLABA] }), '```json\n' + JSON.stringify({ teme: [DOBRA, { ...SLABA, citat: 'pisanje besedil' }] }) + '\n```'];
izid = await pripraviTeme(zbrano, { klic: async (x) => { klici.push(x); return odgovori[klici.length - 1]; } });
t('napaka: drugi klic s seznamom napak in prejšnjim odgovorom', klici.length === 2 && klici[1].user.includes('Tvoj prejšnji odgovor') && klici[1].user.includes('»Ponudbe«'), klici[1]?.user.slice(-300));
t('po popravku obe temi veljavni (JSON v ograji)', izid.ok && izid.teme.length === 2 && !izid.tezave.length, JSON.stringify(izid));

klici = [];
izid = await pripraviTeme(zbrano, { klic: async () => { klici.push(1); return JSON.stringify({ teme: [DOBRA, SLABA] }); } });
t('popravek ne pomaga: ostane veljavna, napaka zapisana', izid.ok && izid.teme.length === 1 && izid.tezave.length === 1 && klici.length === 2);

izid = await pripraviTeme(zbrano, { klic: async () => 'Žal ne morem.' });
t('dvakrat brez JSON-a: ni uspelo', !izid.ok && /veljavnega/.test(izid.napaka), JSON.stringify(izid));

klici = [];
izid = await pripraviTeme(zbrano, { klic: async () => { klici.push(1); return klici.length === 1 ? JSON.stringify({ teme: [DOBRA] }) + ' smeti' : 'x'; } });
t('JSON z dodanim besedilom se prebere, en klic', izid.ok && izid.teme.length === 1 && klici.length === 1);

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
