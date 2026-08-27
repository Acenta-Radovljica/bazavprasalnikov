// ── DEL 1: Imports ────────────────────────────────────────────────────────
import { dbQuery } from '../db.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────

// Soniox API klic je VKLOPLJIV. Brez ključa aplikacija ne poskusi ničesar
// samodejno — komercialist transkript prilepi ročno in vse deluje naprej.
const SONIOX_API_KEY  = process.env.SONIOX_API_KEY || '';
const SONIOX_API_BASE = process.env.SONIOX_API_BASE || 'https://api.soniox.com/v1';

// Koliko časa čakamo na Soniox. Krajše kot privzeti fetch timeout, ker
// ta klic teče med sestankom in ne sme obviseti.
const TIMEOUT_MS = 20000;

// Zgornja meja shranjenega transkripta. Enourni sestanek je ~50 tisoč znakov,
// 2 milijona je zato zelo velika rezerva, hkrati pa ustavi pobeglo vsebino.
const MAX_ZNAKOV = 2_000_000;

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Ali je niz videti kot http(s) URL? Uporabljamo za validacijo vnosa.
function jeUrl(s) {
  if (typeof s !== 'string' || !s.trim()) return false;
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Poskusi iz Soniox povezave izluščiti ID transkripcije.
//
// POZOR — NEPREVERJENO: nobene prave Soniox povezave še nisem videl, zato so
// ti vzorci ugibanje na podlagi običajnih oblik (/transcriptions/<id>,
// ?id=<id>, zadnji segment poti, ki je videti kot uuid/hash). Ko dobimo eno
// pravo povezavo, se popravi SAMO ta funkcija — vse ostalo ostane.
// Vrne null, če ID-ja ne prepozna; takrat pot prek API-ja odpade in
// uporabnik transkript prilepi ročno.
function izlusciSonioxId(url) {
  if (!jeUrl(url)) return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }

  // 1) Eksplicitni query parametri
  for (const kljuc of ['id', 'transcription_id', 'transcriptionId', 'file_id']) {
    const v = u.searchParams.get(kljuc);
    if (v && v.trim()) return v.trim();
  }

  // 2) Segment za znanim imenikom
  const segmenti = u.pathname.split('/').filter(Boolean);
  for (const kljuc of ['transcriptions', 'transcription', 'transcript', 'files', 'recordings']) {
    const i = segmenti.indexOf(kljuc);
    if (i !== -1 && segmenti[i + 1]) return decodeURIComponent(segmenti[i + 1]);
  }

  // 3) Zadnji segment, če je videti kot uuid ali dovolj dolg hash
  const zadnji = segmenti[segmenti.length - 1];
  if (zadnji && /^[A-Za-z0-9_-]{8,}$/.test(zadnji)) return decodeURIComponent(zadnji);

  return null;
}

// fetch z časovno omejitvijo. Vrne Response ali null (nikoli ne vrže).
async function fetchSTimeoutom(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    console.error('[transcript] fetch napaka:', err.message, '|', url.slice(0, 80));
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Iz Soniox JSON odgovora sestavi golo besedilo.
// Soniox vrača različne oblike glede na endpoint in verzijo, zato pokrijemo
// več možnosti in ne predvidevamo ene same.
function besediloIzSonioxJson(data) {
  if (!data || typeof data !== 'object') return '';

  // a) že sestavljeno besedilo
  for (const kljuc of ['text', 'transcript', 'transcript_text']) {
    if (typeof data[kljuc] === 'string' && data[kljuc].trim()) return data[kljuc];
  }

  // b) besede/žetoni, ki jih je treba zlepiti
  const zbirke = [data.words, data.tokens, data.result?.words, data.transcript?.words];
  for (const z of zbirke) {
    if (Array.isArray(z) && z.length) {
      const s = z.map(w => (typeof w === 'string' ? w : (w?.text ?? w?.word ?? ''))).join(' ');
      if (s.trim()) return s.replace(/\s+([,.!?;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // c) segmenti / kanali z govorci
  const segmenti = data.segments || data.channels || data.result?.segments;
  if (Array.isArray(segmenti) && segmenti.length) {
    const vrstice = segmenti.map(s => {
      const govorec = s?.speaker ?? s?.speaker_id;
      const t = s?.text ?? s?.transcript ?? '';
      if (!String(t).trim()) return '';
      return govorec != null ? `[${govorec}] ${t}` : String(t);
    }).filter(Boolean);
    if (vrstice.length) return vrstice.join('\n');
  }

  return '';
}

// Iz HTML strani potegni golo besedilo. Zasilna pot, kadar povezava ni API,
// ampak navadna stran. Namenoma zelo groba — če stran zahteva prijavo ali
// vsebino nalaga z JavaScriptom, to NE bo delovalo in mora človek prilepiti
// transkript ročno.
function besediloIzHtml(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── DEL 4: Prenos transkripta ────────────────────────────────────────────

// Poskusi prenesti transkript iz Soniox povezave.
// Vrne { ok, besedilo, vir, napaka } — nikoli ne vrže.
//
// Vrstni red poskusov:
//   1. Soniox API (samo če je SONIOX_API_KEY nastavljen in ID prepoznan)
//   2. navaden GET na povezavo (JSON ali HTML)
// Če oboje odpove, vrne ok:false z razlogom — klicatelj naj uporabniku
// pokaže "prilepi ročno".
async function prenesiTranskript(soniox_url) {
  if (!jeUrl(soniox_url)) {
    return { ok: false, besedilo: '', vir: null, napaka: 'neveljaven_url' };
  }

  // ── Poskus 1: Soniox API ──
  const id = izlusciSonioxId(soniox_url);
  if (SONIOX_API_KEY && id) {
    const glave = { Authorization: `Bearer ${SONIOX_API_KEY}`, Accept: 'application/json' };
    // Dva znana vzorca poti; prvi, ki vrne uporabno besedilo, zmaga.
    const poti = [
      `${SONIOX_API_BASE}/transcriptions/${encodeURIComponent(id)}/transcript`,
      `${SONIOX_API_BASE}/transcriptions/${encodeURIComponent(id)}`,
    ];
    for (const pot of poti) {
      const res = await fetchSTimeoutom(pot, { headers: glave });
      if (!res || !res.ok) continue;
      let data = null;
      try { data = await res.json(); } catch { continue; }
      const besedilo = besediloIzSonioxJson(data);
      if (besedilo.trim()) {
        return { ok: true, besedilo: besedilo.slice(0, MAX_ZNAKOV), vir: 'api', napaka: null };
      }
    }
  }

  // ── Poskus 2: navaden GET na povezavo ──
  const res = await fetchSTimeoutom(soniox_url, {
    headers: { Accept: 'application/json, text/html;q=0.9, text/plain;q=0.8' },
  });
  if (!res) {
    return { ok: false, besedilo: '', vir: null, napaka: 'povezava_ni_dosegljiva' };
  }
  if (!res.ok) {
    return { ok: false, besedilo: '', vir: null, napaka: `http_${res.status}` };
  }

  const tip = (res.headers.get('content-type') || '').toLowerCase();
  let telo = '';
  try { telo = await res.text(); } catch {
    return { ok: false, besedilo: '', vir: null, napaka: 'telo_neberljivo' };
  }

  if (tip.includes('json')) {
    let data = null;
    try { data = JSON.parse(telo); } catch { data = null; }
    const besedilo = besediloIzSonioxJson(data);
    if (besedilo.trim()) {
      return { ok: true, besedilo: besedilo.slice(0, MAX_ZNAKOV), vir: 'api', napaka: null };
    }
    return { ok: false, besedilo: '', vir: null, napaka: 'json_brez_prepoznanega_besedila' };
  }

  const golo = tip.includes('html') ? besediloIzHtml(telo) : telo.trim();

  // Prekratek rezultat pomeni skoraj zagotovo prijavno stran ali JS-render,
  // ne transkript. Bolje priznati poraz kot shraniti "Sign in to continue".
  if (golo.length < 200) {
    return {
      ok: false, besedilo: '', vir: null,
      napaka: 'stran_ne_vsebuje_transkripta_verjetno_zahteva_prijavo',
    };
  }

  return { ok: true, besedilo: golo.slice(0, MAX_ZNAKOV), vir: 'scrape', napaka: null };
}

// ── DEL 5: Shranjevanje v bazo ───────────────────────────────────────────

// Shrani transkript k seji. To je jedro Majine zahteve: v bazi konča KOPIJA
// besedila, povezava je samo metapodatek o izvoru.
// Vrne shranjeno vrstico ali null.
async function shraniTranskript({ session_id, soniox_url = null, besedilo = '', vir = 'rocno', napaka = null }) {
  const cisto = typeof besedilo === 'string' ? besedilo.slice(0, MAX_ZNAKOV) : '';
  const status = cisto.trim() ? 'ok' : (napaka ? 'napaka' : 'caka');

  const r = await dbQuery(`
    INSERT INTO process_transcripts (session_id, soniox_url, raw_text, znakov, vir, status, napaka)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, session_id, soniox_url, znakov, vir, status, napaka, fetched_at
  `, [session_id, soniox_url, cisto || null, cisto.length, vir, status, napaka]);

  return r?.rows?.[0] ?? null;
}

// Povezava + samodejni prenos + shranjevanje v enem koraku.
// Če prenos ne uspe, vrstico VSEENO shranimo (status 'napaka', s povezavo),
// da povezava ni izgubljena in da uporabnik v UI vidi, kaj je šlo narobe.
async function dodajIzPovezave({ session_id, soniox_url }) {
  const rezultat = await prenesiTranskript(soniox_url);
  const vrstica = await shraniTranskript({
    session_id,
    soniox_url,
    besedilo: rezultat.besedilo,
    vir: rezultat.ok ? rezultat.vir : 'api',
    napaka: rezultat.ok ? null : rezultat.napaka,
  });
  return { ...rezultat, vrstica };
}

// Vrne najnovejši uspešen transkript seje (za email, AI in prikaz).
async function najnovejsiTranskript(session_id) {
  const r = await dbQuery(`
    SELECT id, soniox_url, raw_text, znakov, vir, status, fetched_at
      FROM process_transcripts
     WHERE session_id = $1 AND status = 'ok' AND raw_text IS NOT NULL
     ORDER BY fetched_at DESC
     LIMIT 1
  `, [session_id]);
  return r?.rows?.[0] ?? null;
}

// ── DEL 6: Named exports ─────────────────────────────────────────────────
export {
  jeUrl,
  izlusciSonioxId,
  besediloIzSonioxJson,
  besediloIzHtml,
  prenesiTranskript,
  shraniTranskript,
  dodajIzPovezave,
  najnovejsiTranskript,
  SONIOX_API_KEY,
};
