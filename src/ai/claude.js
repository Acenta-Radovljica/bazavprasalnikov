// ── DEL 1: Imports ────────────────────────────────────────────────────────
import 'dotenv/config';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 15000;

// Modeli — uporabljaj te konstante, nikoli string literal v kodi.
// Razlog: ce Anthropic izda nov model, posodobimo na enem mestu.
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';   // poceni, hitri (matching, povzetki)
const MODEL_OPUS  = 'claude-opus-4-6';              // kakovostno (priporocila, insights)

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Eksponentni backoff retry za 429 (rate limit) in 529 (overloaded).
// Acenta free tier: 10k tokens/min — pri spike-u dobimo 429.
async function callClaudeRaw(body, retryCount = 0) {
  if (!ANTHROPIC_KEY || ANTHROPIC_KEY.includes('vstavi')) {
    console.warn('[claude] ANTHROPIC_API_KEY ni nastavljen — preskocim');
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Retry na rate limit ali overload
    if ((res.status === 429 || res.status === 529) && retryCount < 3) {
      const delayMs = 1000 * Math.pow(2, retryCount); // 1s, 2s, 4s
      console.warn(`[claude] ${res.status} — retry ${retryCount + 1}/3 cez ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
      return callClaudeRaw(body, retryCount + 1);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
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

// ── DEL 4: Glavne exported funkcije ───────────────────────────────────────

// Klic Haiku modela. Vrne string odgovor ali null.
async function klicHaiku({ system, user, maxTokens = 500 }) {
  const data = await callClaudeRaw({
    model: MODEL_HAIKU,
    max_tokens: maxTokens,
    system: system,
    messages: [{ role: 'user', content: user }],
  });
  return data?.content?.[0]?.text ?? null;
}

// Klic Opus modela. Vrne string odgovor ali null.
async function klicOpus({ system, user, maxTokens = 2000 }) {
  const data = await callClaudeRaw({
    model: MODEL_OPUS,
    max_tokens: maxTokens,
    system: system,
    messages: [{ role: 'user', content: user }],
  });
  return data?.content?.[0]?.text ?? null;
}

// ── DEL 5: Named exports ─────────────────────────────────────────────────
export { klicHaiku, klicOpus, MODEL_HAIKU, MODEL_OPUS };
