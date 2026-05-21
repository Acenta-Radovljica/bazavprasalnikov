// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { generirajPovzetek } from './generate_povzetek.js';
import { generirajPriporocila } from './generate_priporocila.js';
import { generirajInsights } from './generate_insights.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
// Debounce za priporocila: ko pride nov response za isto podjetje, resetiramo timer.
// Razlog: ce podjetje ima 5 respondentov v 2 minutah, ne klicemo Opus 5x.
const PRIPOROCILA_DEBOUNCE_MS = 60 * 1000;  // 60 sekund

// In-memory map: companyId → timer handle.
// Ker tece samo en Node proces, je dovolj. Ce bo kdaj scale-out, premaknemo
// na Redis ali BullMQ.
const debounceTimers = new Map();

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Catch-all wrapper za async funkcije, ki tecejo v ozadju (setImmediate).
// Razlog: brez tega bi neulovljen promise reject zrusil Node proces.
function vOzadju(label, fn) {
  setImmediate(async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[queue] napaka v ${label}:`, err.message);
    }
  });
}

// ── DEL 4: Exported funkcije ─────────────────────────────────────────────

// Sprozi povzetek TAKOJ v ozadju (ne caka).
// Webhook poklice to in vrne 200 brez cakanja na AI.
function sproziPovzetek(responseId) {
  if (!responseId) return;
  vOzadju(`povzetek(${responseId})`, () => generirajPovzetek(responseId));
}

// Sprozi priporocila z debounce-om. Vec klicev v 60s zdruzimo v enega.
function sproziPriporocila(companyId) {
  if (!companyId) return;

  // Ce ze obstaja timer, resetiramo
  if (debounceTimers.has(companyId)) {
    clearTimeout(debounceTimers.get(companyId));
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(companyId);
    vOzadju(`priporocila(${companyId})`, () => generirajPriporocila(companyId));
  }, PRIPOROCILA_DEBOUNCE_MS);

  debounceTimers.set(companyId, timer);
  console.log(`[queue] priporocila za company=${companyId} bodo sprozena cez ${PRIPOROCILA_DEBOUNCE_MS / 1000}s`);
}

// Sprozi cross-client insights v ozadju (brez debounce — admin klika ga sproza).
// Opcijsko: dni - koliko dni nazaj naj gleda response (default 90).
function sproziInsights({ dni } = {}) {
  vOzadju('insights', () => generirajInsights(dni ? { dni } : {}));
}

// ── DEL 5: Named exports ─────────────────────────────────────────────────
export { sproziPovzetek, sproziPriporocila, sproziInsights };
