// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { generirajPovzetek } from './generate_povzetek.js';
import { generirajPriporocila } from './generate_priporocila.js';
import { generirajInsights } from './generate_insights.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
// Debounce za priporocila: ko pride nov response za isto podjetje x vprasalnik,
// resetiramo timer. Razlog: ce podjetje ima 5 respondentov v 2 minutah, ne
// klicemo Opus 5x. Po multi-questionnaire prehodu je kljuc kombinacija
// (companyId, questionnaireId) — debounci za razlicne vprasalnike so loceni.
const PRIPOROCILA_DEBOUNCE_MS = 60 * 1000;  // 60 sekund

// In-memory map: `${companyId}:${questionnaireId}` → timer handle.
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

// Sprozi povzetek TAKOJ v ozadju (ne caka). Webhook poklice to in vrne 200
// brez cakanja na AI. Povzetek modul sam najde questionnaire prek JOIN-a.
function sproziPovzetek(responseId) {
  if (!responseId) return;
  vOzadju(`povzetek(${responseId})`, () => generirajPovzetek(responseId));
}

// Sprozi priporocila z debounce-om. Vec klicev v 60s zdruzimo v enega.
// MORA dobiti questionnaireId — vsako podjetje ima locena priporocila per
// vprasalnik (tabela company_priporocila).
function sproziPriporocila(companyId, questionnaireId) {
  if (!companyId || !questionnaireId) return;

  const key = `${companyId}:${questionnaireId}`;

  // Ce ze obstaja timer, resetiramo
  if (debounceTimers.has(key)) {
    clearTimeout(debounceTimers.get(key));
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(key);
    vOzadju(`priporocila(c=${companyId} q=${questionnaireId})`,
      () => generirajPriporocila(companyId, questionnaireId));
  }, PRIPOROCILA_DEBOUNCE_MS);

  debounceTimers.set(key, timer);
  console.log(`[queue] priporocila za company=${companyId} q=${questionnaireId} bodo sprozena cez ${PRIPOROCILA_DEBOUNCE_MS / 1000}s`);
}

// Sprozi cross-client insights v ozadju (brez debounce — admin klika ga sproza).
function sproziInsights({ dni } = {}) {
  vOzadju('insights', () => generirajInsights(dni ? { dni } : {}));
}

// ── DEL 5: Named exports ─────────────────────────────────────────────────
export { sproziPovzetek, sproziPriporocila, sproziInsights };
