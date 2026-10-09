// ── DEL 1: Imports ────────────────────────────────────────────────────────
import 'dotenv/config';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_HAIKU_MS  = 30000;   // Haiku hitri, 30s je vec kot dovolj
const TIMEOUT_SONNET_MS = 90000;   // Sonnet 5 razmislja (adaptive), kratek JSON
const TIMEOUT_OPUS_MS   = 240000;  // Opus 5.5 vedno razmislja + dolg izhod

// Modeli — uporabljaj te konstante, nikoli string literal v kodi.
// Razlog: ce Anthropic izda nov model, posodobimo na enem mestu.
// 25. 9. 2026: Opus 4.6 -> Opus 5.5 (priporocila, insights), kvalifikacija
// s Haiku 4.5 na Sonnet 5 (boljsa presoja hot/warm/cold). Povzetki in
// matching ostanejo na Haiku.
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001';  // poceni, hitri (matching, povzetki)
const MODEL_SONNET = 'claude-sonnet-5';            // presoja (kvalifikacija leada)
const MODEL_OPUS   = 'claude-opus-5-5';            // kakovostno (priporocila, insights)

// Sonnet 5 in Opus 5.5 razmisljata, razmisljanje pa se steje v max_tokens.
// Klicatelji podajo maxTokens kot dolzino ODGOVORA; tu pristejemo prostor za
// razmisljanje, da odgovor ni odrezan (stop_reason "max_tokens").
const PROSTOR_ZA_RAZMISLJANJE = 12000;

// Opus 5.5 ima privzeto effort "medium" (Opus 5 je imel "high"), zato ga
// nastavimo izrecno. Po Anthropicovih meritvah je medium na 5.5 boljsi od
// high na Opus 5 pri analiticnem delu. Kvalifikacija je kratka presoja.
const EFFORT_OPUS   = 'medium';
const EFFORT_SONNET = 'medium';

// Ce varnostni klasifikator zavrne zahtevo (stop_reason "refusal"), jo API
// sam ponovi na priporoceni rezervni model. Beta — ce jo racun zavrne z 400,
// jo za ta proces izklopimo in klic ponovimo brez nje (glej callClaudeRaw).
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
let fallbackVklopljen = true;

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Eksponentni backoff retry za 429 (rate limit) in 529 (overloaded).
async function callClaudeRaw(body, { timeoutMs, retryCount = 0 } = {}) {
  if (!ANTHROPIC_KEY || ANTHROPIC_KEY.includes('vstavi')) {
    console.warn('[claude] ANTHROPIC_API_KEY ni nastavljen — preskocim');
    return null;
  }

  const zFallbackom = body.fallbacks !== undefined && fallbackVklopljen;
  const poslano = { ...body };
  if (!zFallbackom) delete poslano.fallbacks;

  const headers = {
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  if (zFallbackom) headers['anthropic-beta'] = FALLBACK_BETA;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? TIMEOUT_HAIKU_MS);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(poslano),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Retry na rate limit ali overload
    if ((res.status === 429 || res.status === 529) && retryCount < 3) {
      const delayMs = 1000 * Math.pow(2, retryCount); // 1s, 2s, 4s
      console.warn(`[claude] ${res.status} — retry ${retryCount + 1}/3 cez ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
      return callClaudeRaw(body, { timeoutMs, retryCount: retryCount + 1 });
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // Beta za rezervni model ni na voljo temu racunu: izklopi jo in ponovi
      // enkrat brez nje, da AI ne pade zaradi varovalke.
      if (res.status === 400 && zFallbackom && /fallback/i.test(errText)) {
        console.warn('[claude] fallback beta zavrnjena — nadaljujem brez nje:', errText.slice(0, 200));
        fallbackVklopljen = false;
        return callClaudeRaw(body, { timeoutMs, retryCount });
      }
      console.error(`[claude] HTTP ${res.status}:`, errText.slice(0, 200));
      return null;
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    console.error('[claude] fetch napaka:', err.message);
    return null;
  }
}

// Iz odgovora vzame besedilo. Novejsi modeli pred besedilo postavijo bloke
// "thinking" (s praznim besedilom), zato NE beremo content[0] — prej je to
// tiho vrnilo prazen niz. Zavrnjen odgovor vrne null. Odrezan odgovor vrne
// null samo pri modelih, ki razmisljajo (odrezanoJeNapaka): tam je obicajno
// razmisljanje pojedlo proracun in je besedilo polovicno. Haiku ohrani staro
// vedenje (delni povzetek je boljsi kot nic).
function izlusciBesedilo(data, model, { odrezanoJeNapaka = true } = {}) {
  if (!data) return null;
  if (data.stop_reason === 'refusal') {
    console.warn(`[claude] ${model} je zavrnil zahtevo:`, data.stop_details?.category ?? 'brez kategorije');
    return null;
  }
  if (data.stop_reason === 'max_tokens') {
    console.warn(`[claude] ${model} odgovor odrezan (${data.usage?.output_tokens ?? '?'} izhodnih tokenov)`);
    if (odrezanoJeNapaka) return null;
  }
  const besedilo = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  return besedilo || null;
}

// ── Agent SDK: Maksova naročnina namesto plačljivega API-ja (1. 10. 2026) ──
// CLAUDE_SDK=1 → klicHaiku/klicSonnet/klicOpus gredo prek Agent SDK (CLAUDE_CODE_OAUTH_TOKEN),
// ne prek API-ja. Vzorec iz acenta-os packages/ai/src/sdk.ts (pregledal Codex, isti kot LitScanner):
// SDK zažene vgrajen `claude` kot podproces; brez ANTHROPIC_API_KEY v njegovem okolju se prijavi z
// OAuth žetonom naročnine. Podproces dobi samo nujne spremenljivke (nikoli DATABASE_URL, ADMIN_PASS,
// RESEND ...), brez orodij, brez nastavitev gostitelja, razmišljanje izklopljeno (v ponudbah je
// povzročalo 502), trd čas. Ob napaki vrne null (klicatelji to že znajo) in NIKOLI ne pade nazaj
// na API, ker bi to spet trošilo kredite.
const sdkVklopljen = () => process.env.CLAUDE_SDK === '1';
const SDK_ENV = [
  'CLAUDE_CODE_OAUTH_TOKEN', 'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'NODE_ENV',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'LANG', 'LC_ALL', 'TZ',
  // Windows (lokalni razvoj): CLI tu najde svojo prijavo.
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC',
];
function sdkOkolje() {
  const out = {};
  for (const k of SDK_ENV) if (process.env[k] !== undefined) out[k] = process.env[k];
  return out;
}
// Test seam: testi podajo lažni query(), da se ne zažene noben podproces in ni klica.
let sdkQueryZaTeste = null;
function __nastaviSdkQueryZaTeste(fn) { sdkQueryZaTeste = fn; }

async function sdkKlic({ system, user, model, timeoutMs }) {
  let query = sdkQueryZaTeste;
  if (!query) {
    try { ({ query } = await import('@anthropic-ai/claude-agent-sdk')); }
    catch (e) { console.error('[claude] Agent SDK ni na voljo:', e.message); return null; }
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  let besedilo = '';
  try {
    for await (const msg of query({
      prompt: user,
      options: {
        systemPrompt: system,
        model,
        allowedTools: [],        // samo besedilo, brez orodij
        maxTurns: 6,             // rezerva, če model poskusi orodje
        settingSources: [],      // nikoli ne beri .claude nastavitev gostitelja
        env: sdkOkolje(),
        thinking: { type: 'disabled' },
        abortController: ctrl,
      },
    })) {
      if (msg.type === 'result' && msg.subtype === 'success' && typeof msg.result === 'string') besedilo = msg.result;
    }
    const out = besedilo.trim();
    return out === '' ? null : out;
  } catch (e) {
    console.error('[claude] SDK napaka:', e.name === 'AbortError' ? `čas potekel (${timeoutMs} ms)` : e.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── DEL 4: Glavne exported funkcije ───────────────────────────────────────

// Klic Haiku modela. Vrne string odgovor ali null.
async function klicHaiku({ system, user, maxTokens = 500 }) {
  if (sdkVklopljen()) return sdkKlic({ system, user, model: MODEL_HAIKU, timeoutMs: 60000 });
  const data = await callClaudeRaw({
    model: MODEL_HAIKU,
    max_tokens: maxTokens,
    system: system,
    messages: [{ role: 'user', content: user }],
  }, { timeoutMs: TIMEOUT_HAIKU_MS });
  return izlusciBesedilo(data, MODEL_HAIKU, { odrezanoJeNapaka: false });
}

// Klic Sonnet modela. Vrne string odgovor ali null. effort: 'low' za besedila, kjer
// je cas pomemben (porocilo AI Business Score caka nanj), privzeto EFFORT_SONNET.
async function klicSonnet({ system, user, maxTokens = 500, effort = EFFORT_SONNET }) {
  if (sdkVklopljen()) return sdkKlic({ system, user, model: MODEL_SONNET, timeoutMs: TIMEOUT_SONNET_MS });
  const data = await callClaudeRaw({
    model: MODEL_SONNET,
    max_tokens: maxTokens + PROSTOR_ZA_RAZMISLJANJE,
    system: system,
    output_config: { effort },
    messages: [{ role: 'user', content: user }],
    fallbacks: 'default',
  }, { timeoutMs: TIMEOUT_SONNET_MS });
  return izlusciBesedilo(data, MODEL_SONNET);
}

// Klic Opus modela. Vrne string odgovor ali null. effort 'high' in daljsi
// timeoutMs za redke, dolge izdelke (prodajni predlog); privzeto EFFORT_OPUS.
async function klicOpus({ system, user, maxTokens = 2000, effort = EFFORT_OPUS, timeoutMs = TIMEOUT_OPUS_MS }) {
  if (sdkVklopljen()) return sdkKlic({ system, user, model: MODEL_OPUS, timeoutMs });
  const data = await callClaudeRaw({
    model: MODEL_OPUS,
    max_tokens: maxTokens + PROSTOR_ZA_RAZMISLJANJE,
    system: system,
    output_config: { effort },
    messages: [{ role: 'user', content: user }],
    fallbacks: 'default',
  }, { timeoutMs });
  return izlusciBesedilo(data, MODEL_OPUS);
}

// ── DEL 5: Named exports ─────────────────────────────────────────────────
export {
  klicHaiku, klicSonnet, klicOpus,
  sdkVklopljen, __nastaviSdkQueryZaTeste,
  MODEL_HAIKU, MODEL_SONNET, MODEL_OPUS,
  izlusciBesedilo,
};
