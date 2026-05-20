// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Normalizira ime podjetja za AI matching.
// Primer: "Hotel Cubo d.o.o." → "cubo"
// Razlog: razlicna pisanja istega podjetja se morajo zliti v isto vrstico companies.
function normalizirajNaziv(naziv) {
  if (!naziv || typeof naziv !== 'string') return '';

  let n = naziv.toLowerCase().trim();

  // Odstrani pravne oblike
  n = n.replace(/\b(d\.o\.o\.?|d\.d\.?|s\.p\.?|k\.d\.?|gmbh|ltd|inc|llc)\b/gi, '');

  // Odstrani tipicne hotelske prefikse/sufikse (le ce niso edina beseda)
  const orig = n;
  n = n.replace(/\b(hotel|hostel|gostisce|gostilna|penzion|apartmaji|terme|wellness)\b/gi, '');
  // Ce smo s tem vse zbrisali, vrnemo prvotno
  if (!n.trim()) n = orig;

  // Vec presledkov → en presledek
  n = n.replace(/\s+/g, ' ').trim();

  return n;
}

// SHA256 hash IP-ja (GDPR-friendly — IP ni shranjen v plaintextu).
function hashIp(ip) {
  if (!ip) return null;
  return createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
}

// ── DEL 5: Named exports ─────────────────────────────────────────────────
export { normalizirajNaziv, hashIp };
