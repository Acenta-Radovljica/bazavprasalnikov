// ── DEL 1: Imports ────────────────────────────────────────────────────────
import 'dotenv/config';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER ?? 'ai@acenta.si';
const ADMIN_PASS = process.env.ADMIN_PASS ?? 'vstavi_v_fazi_4';

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Konstantno-casovni primerjava — preprecuje timing attacke na geslo.
// Najden trik: primerjamo char-by-char dolzino in vsakega znaka, dokler ne pridemo do konca.
function konstantnoCasovnaPrimerjava(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── DEL 4: Glavni middleware ─────────────────────────────────────────────

// Express middleware za Basic Auth. Uporabi se na vseh /api/* in /admin/* poteh.
// Brskalnik prikaze nativni login popup. Po uspesnem loginu cache-a kredencije
// dokler je zavihek odprt.
function basicAuth(req, res, next) {
  // Ce je admin password se placeholder, dovoli vse (samo za prvi deploy — dokler
  // ne posodobimo env var). Logiramo glasno opozorilo.
  if (ADMIN_PASS.includes('vstavi')) {
    console.warn('[auth] OPOZORILO: ADMIN_PASS ni nastavljen — dostop je ODPRT');
    return next();
  }

  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Basic' || !token) {
    res.set('WWW-Authenticate', 'Basic realm="Bazavprasalnikov Admin", charset="UTF-8"');
    return res.status(401).json({ error: 'unauthorized' });
  }

  let decoded;
  try {
    decoded = Buffer.from(token, 'base64').toString('utf-8');
  } catch {
    res.set('WWW-Authenticate', 'Basic realm="Bazavprasalnikov Admin"');
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const idx = decoded.indexOf(':');
  const user = idx === -1 ? decoded : decoded.slice(0, idx);
  const pass = idx === -1 ? '' : decoded.slice(idx + 1);

  const userOk = konstantnoCasovnaPrimerjava(user, ADMIN_USER);
  const passOk = konstantnoCasovnaPrimerjava(pass, ADMIN_PASS);

  if (!userOk || !passOk) {
    res.set('WWW-Authenticate', 'Basic realm="Bazavprasalnikov Admin"');
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  next();
}

// ── DEL 5: Named export ──────────────────────────────────────────────────
export { basicAuth };
