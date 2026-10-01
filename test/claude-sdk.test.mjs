// Agent SDK path of the Claude client (CLAUDE_SDK=1: Maks's subscription instead of the metered API).
// A fake query() is injected: no subprocess, no network, no API credits, no subscription usage.
//
// Assertions:
//  1. klicSonnet/klicHaiku/klicOpus go through the SDK with the right model, no tools, no host
//     settings, thinking disabled, and a subprocess env WITHOUT the API key or app secrets.
//  2. Failures (throw, empty result, error subtype) return null, never fall back to the API.
//  3. The AI Business Score text (generirajBesedilo) works end to end through the SDK path.
//  4. With CLAUDE_SDK unset the SDK is not used.
//
// Run: node test/claude-sdk.test.mjs   (no server, no DB)

// Before the client loads: no API key (so a slip to the API path cannot make a real call) and
// fake app secrets that must never reach the subprocess.
process.env.ANTHROPIC_API_KEY = '';
process.env.DATABASE_URL = 'postgres://skrivnost@baza/x';
process.env.ADMIN_PASS = 'skrivno-geslo';
process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-test';
process.env.CLAUDE_SDK = '1';

const claude = await import('../src/ai/claude.js');
const { generirajBesedilo, imaAI } = await import('../src/score/besedilo.js');
const { izracunajScore } = await import('../src/score/izracunaj.js');

let ok = 0, fail = 0; const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}

const klici = [];
const lazni = (odgovor) => (input) => {
  klici.push(input);
  return (async function* () {
    if (odgovor instanceof Error) throw odgovor;
    yield { type: 'system', subtype: 'init' };
    if (odgovor !== null) yield { type: 'result', subtype: odgovor === 'napaka' ? 'error_max_turns' : 'success', result: odgovor === 'napaka' ? undefined : odgovor };
  })();
};

console.log('\n1. Klic prek SDK');
claude.__nastaviSdkQueryZaTeste(lazni('Pozdravljeni.'));
const r = await claude.klicSonnet({ system: 'SIS', user: 'UPORABNIK', maxTokens: 100 });
const k = klici.at(-1);
t('klicSonnet vrne besedilo iz SDK', r === 'Pozdravljeni.', r);
t('model = MODEL_SONNET, poziv in sistem podana', k?.options?.model === claude.MODEL_SONNET && k.prompt === 'UPORABNIK' && k.options.systemPrompt === 'SIS');
t('brez orodij, brez nastavitev gostitelja, brez razmišljanja', JSON.stringify(k.options.allowedTools) === '[]' && JSON.stringify(k.options.settingSources) === '[]' && k.options.thinking?.type === 'disabled');
t('okolje podprocesa: OAuth žeton DA, API ključ in skrivnosti aplikacije NE',
  k.options.env.CLAUDE_CODE_OAUTH_TOKEN === 'sk-ant-oat-test' && !('ANTHROPIC_API_KEY' in k.options.env) && !('DATABASE_URL' in k.options.env) && !('ADMIN_PASS' in k.options.env),
  Object.keys(k.options.env).join(','));
t('ima časovno omejitev (abortController)', k.options.abortController instanceof AbortController);
await claude.klicHaiku({ system: 's', user: 'u' });
t('klicHaiku prek SDK z MODEL_HAIKU', klici.at(-1).options.model === claude.MODEL_HAIKU);
await claude.klicOpus({ system: 's', user: 'u' });
t('klicOpus prek SDK z MODEL_OPUS', klici.at(-1).options.model === claude.MODEL_OPUS);

console.log('\n2. Napake vrnejo null');
claude.__nastaviSdkQueryZaTeste(lazni(new Error('podproces padel')));
t('izjema v SDK -> null', await claude.klicSonnet({ system: 's', user: 'u' }) === null);
claude.__nastaviSdkQueryZaTeste(lazni(null));
t('brez rezultata -> null', await claude.klicSonnet({ system: 's', user: 'u' }) === null);
claude.__nastaviSdkQueryZaTeste(lazni('napaka'));
t('rezultat z napako (error_max_turns) -> null', await claude.klicSonnet({ system: 's', user: 'u' }) === null);

console.log('\n3. Besedilo AI Business Score prek SDK');
const besedilo = {
  odstavek: 'V podjetju Primer AI uporabljajo posamezniki, skupnega načina dela pa še ni. Največ časa gre v pripravo ponudb in v ročno administracijo, kar zavira prodajo. Ker se odziv na povpraševanja vleče več dni, ostanejo stranke dlje brez odgovora. Želite ukrepati v kratkem, zato je pravi trenutek za prvi projekt z jasnim ciljem.',
  dobro: ['Zaposleni AI že preizkušajo pri pisanju besedil, zato imate prve izkušnje.', 'Dobro veste, katera opravila vzamejo največ časa, kar olajša izbor projekta.', 'Na vodstveni ravni je odločitev za AI že sprejeta, kar skrajša pot.', 'Imate odprt odnos do novih orodij v ekipi, kar zmanjša odpor.', 'Oceno je izpolnil direktor, ki o naslednjem koraku tudi odloča.'],
  zatika: ['Občutljivi podatki lahko uidejo v javna orodja, ker ni jasno, kaj je dovoljeno.', 'Nihče ne skrbi za to, da bi pobude za AI prišle do konca.', 'Izkušnje se ne prenašajo na sodelavce, zato vsak začenja znova.', 'Učinka uporabe zaenkrat nihče ne meri, zato ga je težko pokazati.', 'Ponudbe nastajajo ročno, kar podaljša čas do odgovora strankam.'],
  moznosti: ['Osnutke odgovorov strankam lahko pripravi pomočnik iz vaših cenikov.', 'Poročila za vodstvo se lahko sestavijo samodejno iz obstoječih podatkov.', 'Zapisniki sestankov z nalogami nastanejo brez ročnega dela.', 'Pogosta vprašanja strank dobijo odgovor tudi zvečer.', 'Dolge e-poštne niti lahko AI povzame v nekaj vrsticah.'],
};
claude.__nastaviSdkQueryZaTeste(lazni(JSON.stringify(besedilo)));
t('imaAI() = da, ko je CLAUDE_SDK=1 (brez API ključa)', imaAI() === true);
const odg = { panoga: 'trgovina', vloga: 'direktor', uporaba: 'posamezniki', sistematicnost: 'vsak_po_svoje', odgovorna_oseba: 'neformalno', razumevanje: 'povprecno', pravila: 'potrebovali', izguba_casa: ['ponudbe', 'administracija'], stroski: ['odzivnost'], potencial: ['prodaja'], odziv: '2-3dni', nabavne_cene: 'redno', ovira: 'kje_zaceti', hitrost: '1-3m', pomoc: 'pomocnik_prodaja', interpretacija: 'ne' };
const g = await generirajBesedilo(izracunajScore({ ...odg, velikost: '21-50' }), { uporaba: 'Posamezniki' }, 'Primer');
t('generirajBesedilo prek SDK vrne preverjeno besedilo v prvem poskusu', !!g.besedilo && g.poskusov === 1 && g.besedilo.moznosti.length >= 4, JSON.stringify(g).slice(0, 200));

console.log('\n4. Brez CLAUDE_SDK se SDK ne uporabi');
process.env.CLAUDE_SDK = '';
const prej = klici.length;
const brez = await claude.klicSonnet({ system: 's', user: 'u' });
t('SDK ni klican, brez API ključa -> null (nobenega omrežnega klica)', klici.length === prej && brez === null);
t('imaAI() = ne brez SDK in brez ključa', imaAI() === false);

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
