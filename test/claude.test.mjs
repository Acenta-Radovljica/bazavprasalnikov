// Preveri odjemalca za Claude (src/ai/claude.js) brez pravega API-ja:
// globalni fetch zamenjamo z lazno funkcijo, ki zapise zahtevo in vrne
// pripravljen odgovor. Nastalo ob prehodu Opus 4.6 -> Opus 5.5 in
// Haiku -> Sonnet 5 za kvalifikacijo (25. 9. 2026): novejsa modela pred
// besedilo postavita blok "thinking", in stara koda (content[0].text) bi
// tiho vrnila prazno priporocilo.
process.env.ANTHROPIC_API_KEY = 'sk-test-lazni';

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

// Vrsta pripravljenih odgovorov; vsak klic fetch vzame naslednjega.
let odgovori = [];
const zahteve = [];
globalThis.fetch = async (url, opts) => {
  zahteve.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
  const { status = 200, telo } = odgovori.shift();
  return {
    status, ok: status >= 200 && status < 300,
    json: async () => telo,
    text: async () => (typeof telo === 'string' ? telo : JSON.stringify(telo)),
  };
};

const tihoOpozorilo = console.warn; const tihaNapaka = console.error;
console.warn = () => {}; console.error = () => {};

const {
  klicHaiku, klicSonnet, klicOpus, MODEL_HAIKU, MODEL_SONNET, MODEL_OPUS,
} = await import('../src/ai/claude.js');

const zRazmisljanjem = (besedilo, stop = 'end_turn') => ({
  stop_reason: stop,
  content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: besedilo }],
});

console.log('\n=== modeli ===');
t('Opus je claude-opus-5-5', MODEL_OPUS === 'claude-opus-5-5', MODEL_OPUS);
t('Sonnet je claude-sonnet-5', MODEL_SONNET === 'claude-sonnet-5', MODEL_SONNET);
t('Haiku ostaja 4.5', MODEL_HAIKU.startsWith('claude-haiku-4-5'), MODEL_HAIKU);

console.log('\n=== Opus: blok razmisljanja pred besedilom ===');
odgovori.push({ telo: zRazmisljanjem('PRIPOROCILA') });
let r = await klicOpus({ system: 's', user: 'u', maxTokens: 4000 });
let z = zahteve.at(-1);
t('vrne besedilo, ne praznega bloka razmisljanja', r === 'PRIPOROCILA', JSON.stringify(r));
t('model v zahtevi je Opus 5.5', z.body.model === 'claude-opus-5-5');
t('max_tokens ima prostor za razmisljanje', z.body.max_tokens === 16000, z.body.max_tokens);
t('effort je nastavljen izrecno', z.body.output_config?.effort === 'medium', JSON.stringify(z.body.output_config));
t('brez thinking.disabled (na 5.5 je to 400)', z.body.thinking === undefined);
t('brez temperature (na 5.5 je to 400)', z.body.temperature === undefined);
t('rezervni model vklopljen', z.body.fallbacks === 'default');
t('beta glava za rezervni model', z.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01', z.headers['anthropic-beta']);

console.log('\n=== vec besedilnih blokov se zdruzi ===');
odgovori.push({ telo: { stop_reason: 'end_turn', content: [
  { type: 'thinking', thinking: '' }, { type: 'text', text: 'A' }, { type: 'text', text: 'B' },
] } });
r = await klicOpus({ system: 's', user: 'u' });
t('besedilo iz vseh text blokov', r === 'AB', JSON.stringify(r));

console.log('\n=== zavrnitev ===');
odgovori.push({ telo: { stop_reason: 'refusal', stop_details: { category: 'bio' }, content: [] } });
r = await klicOpus({ system: 's', user: 'u' });
t('refusal vrne null', r === null, JSON.stringify(r));

console.log('\n=== odrezan odgovor ===');
odgovori.push({ telo: zRazmisljanjem('POLOVI', 'max_tokens') });
r = await klicOpus({ system: 's', user: 'u' });
t('Opus: odrezano vrne null (ne shrani polovicnega)', r === null, JSON.stringify(r));
odgovori.push({ telo: { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'DELNI' }] } });
r = await klicHaiku({ system: 's', user: 'u' });
t('Haiku: odrezano ohrani delni povzetek (staro vedenje)', r === 'DELNI', JSON.stringify(r));

console.log('\n=== prazen odgovor ===');
odgovori.push({ telo: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] } });
r = await klicOpus({ system: 's', user: 'u' });
t('samo blok razmisljanja vrne null, ne ""', r === null, JSON.stringify(r));

console.log('\n=== Sonnet (kvalifikacija) ===');
odgovori.push({ telo: zRazmisljanjem('{"kvalifikacija":"hot","razlog":"x"}') });
r = await klicSonnet({ system: 's', user: 'u', maxTokens: 300 });
z = zahteve.at(-1);
t('vrne JSON besedilo', r?.includes('"hot"'), JSON.stringify(r));
t('model v zahtevi je Sonnet 5', z.body.model === 'claude-sonnet-5');
t('max_tokens 300 + prostor za razmisljanje', z.body.max_tokens === 12300, z.body.max_tokens);

console.log('\n=== Haiku ostane brez novih parametrov ===');
odgovori.push({ telo: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'POVZETEK' }] } });
r = await klicHaiku({ system: 's', user: 'u', maxTokens: 600 });
z = zahteve.at(-1);
t('vrne besedilo', r === 'POVZETEK');
t('max_tokens nespremenjen', z.body.max_tokens === 600, z.body.max_tokens);
t('brez output_config (Haiku effort ne podpira)', z.body.output_config === undefined);
t('brez rezervnega modela in beta glave', z.body.fallbacks === undefined && !z.headers['anthropic-beta']);

console.log('\n=== racun zavrne beta za rezervni model ===');
const pred = zahteve.length;
odgovori.push({ status: 400, telo: '{"type":"error","error":{"message":"fallbacks: unsupported beta"}}' });
odgovori.push({ telo: zRazmisljanjem('BREZ FALLBACKA') });
r = await klicOpus({ system: 's', user: 'u' });
t('klic uspe z drugim poskusom', r === 'BREZ FALLBACKA', JSON.stringify(r));
t('natanko dva poskusa', zahteve.length - pred === 2, zahteve.length - pred);
z = zahteve.at(-1);
t('drugi poskus brez fallbacks', z.body.fallbacks === undefined);
t('drugi poskus brez beta glave', !z.headers['anthropic-beta']);
odgovori.push({ telo: zRazmisljanjem('NASLEDNJI') });
await klicSonnet({ system: 's', user: 'u' });
z = zahteve.at(-1);
t('izklop velja za naslednje klice (ne vsakic 400)', z.body.fallbacks === undefined && !z.headers['anthropic-beta']);

console.log('\n=== druga 400 napaka ne sprozi ponovitve ===');
const pred2 = zahteve.length;
odgovori.push({ status: 400, telo: '{"error":{"message":"messages: invalid"}}' });
r = await klicOpus({ system: 's', user: 'u' });
t('vrne null', r === null);
t('samo en poskus', zahteve.length - pred2 === 1, zahteve.length - pred2);

console.warn = tihoOpozorilo; console.error = tihaNapaka;
console.log(`\n${'─'.repeat(46)}\nOK: ${ok}   FAIL: ${fail}`);
if (padli.length) console.log('Padli:\n  - ' + padli.join('\n  - '));
process.exit(fail ? 1 : 0);
