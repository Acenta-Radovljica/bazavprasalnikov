// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Normalizira ime podjetja za AI matching.
// Primer: "Hotel Cubo d.o.o." → "cubo"
// Razlog: razlicna pisanja istega podjetja se morajo zliti v isto vrstico companies.
function normalizirajNaziv(naziv) {
  if (!naziv || typeof naziv !== 'string') return '';

  let n = naziv.toLowerCase().trim();

  // 1) Pike zbrisi BREZ presledka, da "d.o.o." → "doo" (en zeton, ne trije).
  //    Ostalo interpunkcijo (vejice, oklepaje) pa zamenjaj s presledkom.
  n = n.replace(/\./g, '');
  n = n.replace(/[,;:()'"`]/g, ' ');

  // 2) Razdeli v zetone in odstrani pravne + hotelske oblike
  const dropTokens = new Set([
    'doo', 'dd', 'sp', 'kd', 'gmbh', 'ltd', 'inc', 'llc',
    'hotel', 'hostel', 'gostisce', 'gostilna', 'penzion',
    'apartmaji', 'apartma', 'terme', 'wellness', 'resort',
  ]);

  const tokens = n.split(/\s+/).filter(t => t && !dropTokens.has(t));

  // 3) Ce smo izbrisali vse (npr. vnos je bil samo "Hotel"), vrnemo originalni lowercased
  if (tokens.length === 0) return naziv.toLowerCase().trim();

  return tokens.join(' ');
}

// SHA256 hash IP-ja (GDPR-friendly — IP ni shranjen v plaintextu).
function hashIp(ip) {
  if (!ip) return null;
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
}

// ── DEL 5: Named exports ─────────────────────────────────────────────────
export { normalizirajNaziv, hashIp };
