// ── DEL 1: Imports ────────────────────────────────────────────────────────
import express from 'express';
import { dbQuery } from '../db.js';
import {
  validirajVprasanja,
  normalizirajOdgovore,
  preveriObvezna,
  izracunajNapredek,
} from '../procesi/schema.js';
import { renderirajIzpolnjen } from '../procesi/render.js';
import { renderirajHtml } from '../pdf/render.js';
import { dodajIzPovezave, shraniTranskript, najnovejsiTranskript, jeUrl } from '../procesi/transcript.js';
import { posljiStranki, privzetoSporocilo, veljavenEmail, jePosiljanjeVklopljeno } from '../procesi/mail.js';
import { izracunajAnalizo } from '../procesi/analiza.js';

// ── DEL 2: Konstante ──────────────────────────────────────────────────────
const router = express.Router();

const STATUSI = new Set(['osnutek', 'zakljucen', 'poslan', 'arhiv']);

// ── DEL 3: Helper funkcije ────────────────────────────────────────────────

// Prebere celo sejo z imenom predloge. Vrne vrstico ali null.
async function naloziSejo(id) {
  const r = await dbQuery(`
    SELECT s.*, q.naziv_prikaz, q.slug AS predloga_slug
      FROM process_sessions s
      JOIN questionnaires q ON q.id = s.questionnaire_id
     WHERE s.id = $1
  `, [id]);
  return r?.rows?.[0] ?? null;
}

// Razclenitev :id parametra. Vrne stevilo ali null.
function idIzParam(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Skupni 400 za neveljaven id.
function slabId(res) {
  return res.status(400).json({ error: 'invalid_id' });
}

// Prireze niz ali vrne null (za neobvezna besedilna polja).
function nizAliNull(v, maxDolzina = 300) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, maxDolzina) : null;
}

// Vprasanja pred prvim sklopom so glava obrazca (Hotel, Oddelek, Datum,
// Svetovalec). Iste podatke vpisemo tudi v kartico sestanka, ki poganja
// seznam in filtre. Da komercialist imena hotela ne tipka dvakrat, glavo
// ob zacetku seje prednapolnimo iz kartice.
//
// Preslikava je NAMENOMA eksplicitna in ne po ugibanju imen: ce kdo v
// predlogi preimenuje ali odstrani vprasanje, se prednapolnitev tiho
// preskoci, namesto da bi pisala v napacno polje.
const GLAVA_IZ_KARTICE = {
  hotel: 'stranka_naziv',
  oddelek: 'oddelek',
  datum: 'datum_sestanka',
  svetovalec: 'svetovalec',
};

// Sestavi zacetne odgovore za novo sejo. Vrne objekt (lahko prazen).
function prednapolniGlavo(snapshot, kartica) {
  const answers = {};
  const idxPrveSekcije = snapshot.findIndex(q => q?.tip === 'section');
  const meja = idxPrveSekcije === -1 ? 0 : idxPrveSekcije;

  for (let i = 0; i < meja; i++) {
    const q = snapshot[i];
    if (!q) continue;
    const izvor = GLAVA_IZ_KARTICE[q.id];
    if (!izvor) continue;                       // npr. "predstavniki" — ni ustreznika
    const vrednost = kartica[izvor];
    if (typeof vrednost === 'string' && vrednost.trim()) {
      answers[q.id] = vrednost.trim();
    }
  }
  return answers;
}

// ── DEL 4: Rute — predloge ───────────────────────────────────────────────

// GET /api/procesi/predloge — knjiznica procesnih vprasalnikov.
// Loceno od /api/questionnaires, ker tu steje stevilo SEJ, ne stevilo
// odgovorov iz javnega obrazca (procesni vprasalniki v responses ne pisejo).
router.get('/predloge', async (_req, res) => {
  const r = await dbQuery(`
    SELECT q.id, q.slug, q.naziv_prikaz, q.opis, q.aktivna, q.updated_at,
           jsonb_array_length(q.questions) AS st_vprasanj,
           (SELECT count(*) FROM process_sessions s WHERE s.questionnaire_id = q.id)::int AS st_sej
      FROM questionnaires q
     WHERE q.namen = 'proces'
     ORDER BY q.aktivna DESC, q.naziv_prikaz
  `);
  if (!r) return res.status(500).json({ error: 'db_error' });
  res.json({ predloge: r.rows });
});

// GET /api/procesi/predloge/:id — predloga z vprasanji (za urejevalnik)
router.get('/predloge/:id', async (req, res) => {
  const id = idIzParam(req.params.id);
  if (!id) return slabId(res);

  const r = await dbQuery(
    `SELECT id, slug, naziv_prikaz, opis, questions, aktivna, namen, created_at, updated_at
       FROM questionnaires WHERE id = $1 AND namen = 'proces'`,
    [id]
  );
  if (!r) return res.status(500).json({ error: 'db_error' });
  if (!r.rows.length) return res.status(404).json({ error: 'not_found' });

  res.json({ predloga: r.rows[0] });
});

// PATCH /api/procesi/predloge/:id — uredi vprasanja predloge.
//
// POZOR: to spremeni predlogo za PRIHODNJE seje. Ze zacete seje imajo svojo
// kopijo v questions_snapshot in se NE spremenijo — to je namen te locitve.
router.patch('/predloge/:id', async (req, res) => {
  const id = idIzParam(req.params.id);
  if (!id) return slabId(res);

  const obstaja = await dbQuery(
    `SELECT id FROM questionnaires WHERE id = $1 AND namen = 'proces'`, [id]
  );
  if (!obstaja) return res.status(500).json({ error: 'db_error' });
  if (!obstaja.rows.length) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  const updates = [];
  const params = [];
  let p = 1;

  if (Array.isArray(body.questions)) {
    const v = validirajVprasanja(body.questions);
    if (!v.ok) return res.status(400).json({ error: 'invalid_questions', detail: v.error });
    updates.push(`questions = $${p++}`);
    params.push(JSON.stringify(body.questions));
  }
  if (typeof body.naziv_prikaz === 'string' && body.naziv_prikaz.trim()) {
    updates.push(`naziv_prikaz = $${p++}`);
    params.push(body.naziv_prikaz.trim());
  }
  if (typeof body.opis === 'string') {
    updates.push(`opis = $${p++}`);
    params.push(body.opis.trim());
  }
  if (typeof body.aktivna === 'boolean') {
    updates.push(`aktivna = $${p++}`);
    params.push(body.aktivna);
  }

  if (!updates.length) return res.status(400).json({ error: 'no_fields_to_update' });

  updates.push('updated_at = NOW()');
  params.push(id);

  const r = await dbQuery(
    `UPDATE questionnaires SET ${updates.join(', ')} WHERE id = $${p}
     RETURNING id, slug, naziv_prikaz, aktivna, updated_at`,
    params
  );
  if (!r) return res.status(500).json({ error: 'db_error' });
  res.json({ ok: true, predloga: r.rows[0] });
});

// POST /api/procesi/predloge/:id/podvoji — kopija predloge pod novim slugom.
// Za primer "ta vprasalnik hocem prilagoditi za avtohise, hotelski naj ostane".
router.post('/predloge/:id/podvoji', async (req, res) => {
  const id = idIzParam(req.params.id);
  if (!id) return slabId(res);

  const slug = nizAliNull(req.body?.slug, 50)?.toLowerCase();
  const naziv = nizAliNull(req.body?.naziv_prikaz, 200);
  if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(slug)) {
    return res.status(400).json({ error: 'invalid_slug' });
  }
  if (!naziv) return res.status(400).json({ error: 'missing_naziv_prikaz' });

  const vir = await dbQuery(
    `SELECT questions, opis FROM questionnaires WHERE id = $1 AND namen = 'proces'`, [id]
  );
  if (!vir) return res.status(500).json({ error: 'db_error' });
  if (!vir.rows.length) return res.status(404).json({ error: 'not_found' });

  const r = await dbQuery(`
    INSERT INTO questionnaires (
      slug, naziv_prikaz, opis, questions,
      povzetek_system_prompt, povzetek_user_template,
      priporocila_system_prompt, priporocila_user_template,
      aktivna, namen
    ) VALUES ($1, $2, $3, $4, '', '', '', '', TRUE, 'proces')
    ON CONFLICT (slug) DO NOTHING
    RETURNING id, slug, naziv_prikaz
  `, [slug, naziv, vir.rows[0].opis, JSON.stringify(vir.rows[0].questions)]);

  if (!r) return res.status(500).json({ error: 'db_error' });
  if (!r.rows.length) return res.status(409).json({ error: 'slug_taken', slug });

  res.status(201).json({ ok: true, predloga: r.rows[0] });
});

// ── DEL 5: Rute — seje ───────────────────────────────────────────────────

// GET /api/procesi/seje — seznam sej.
// ?status=osnutek|zakljucen|poslan|arhiv   (privzeto vse razen arhiva)
// ?stranka=<iskalni niz>
router.get('/seje', async (req, res) => {
  const pogoji = [];
  const params = [];
  let p = 1;

  // status: konkretna vrednost | 'vse' (tudi arhiv) | nic (vse razen arhiva).
  // 'vse' je eksplicitno podprt, ker admin nalozi cel seznam in filtrira v
  // brskalniku; prej je to delovalo samo po naklucju (neznana vrednost je
  // padla skozi oba pogoja in filtra ni bilo).
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  if (status === 'vse') {
    // brez pogoja
  } else if (status) {
    if (!STATUSI.has(status)) {
      return res.status(400).json({ error: 'invalid_status', detail: status });
    }
    pogoji.push(`s.status = $${p++}`);
    params.push(status);
  } else {
    pogoji.push(`s.status <> 'arhiv'`);
  }

  const stranka = typeof req.query.stranka === 'string' ? req.query.stranka.trim() : '';
  if (stranka) {
    pogoji.push(`(s.stranka_naziv ILIKE $${p} OR s.proces ILIKE $${p})`);
    params.push(`%${stranka}%`);
    p++;
  }

  const where = pogoji.length ? `WHERE ${pogoji.join(' AND ')}` : '';

  const r = await dbQuery(`
    SELECT s.id, s.stranka_naziv, s.proces, s.oddelek, s.svetovalec,
           s.datum_sestanka, s.status, s.company_id,
           -- questionnaire_id rabi filter po vprasalniku v adminu; brez njega
           -- se filtrira po nicemer in vedno vrne prazen seznam.
           s.questionnaire_id,
           s.questions_snapshot, s.answers,
           s.created_at, s.updated_at, s.zakljucen_at,
           q.naziv_prikaz, q.slug AS predloga_slug,
           (SELECT count(*) FROM process_transcripts t
             WHERE t.session_id = s.id AND t.status = 'ok')::int AS st_transkriptov,
           (SELECT count(*) FROM process_emails e
             WHERE e.session_id = s.id AND e.status = 'poslan')::int AS st_poslanih
      FROM process_sessions s
      JOIN questionnaires q ON q.id = s.questionnaire_id
      ${where}
     ORDER BY s.updated_at DESC
     LIMIT 200
  `, params);

  if (!r) return res.status(500).json({ error: 'db_error' });

  // Napredek racunamo v Node, ne v SQL — logika je ze v schema.js in je
  // ne zelimo imeti napisane dvakrat na dva razlicna nacina.
  const seje = r.rows.map(s => {
    const { questions_snapshot, answers, ...ostalo } = s;
    return { ...ostalo, napredek: izracunajNapredek(questions_snapshot, answers) };
  });

  res.json({ seje });
});

// POST /api/procesi/seje — zacni novo sejo (izpolnjevanje).
// Tu se zgodi kopiranje vprasanj iz predloge v sejo.
router.post('/seje', async (req, res) => {
  const body = req.body || {};

  const questionnaire_id = idIzParam(body.questionnaire_id);
  if (!questionnaire_id) return res.status(400).json({ error: 'missing_questionnaire_id' });

  const stranka_naziv = nizAliNull(body.stranka_naziv, 200);
  if (!stranka_naziv) return res.status(400).json({ error: 'missing_stranka_naziv' });

  const predloga = await dbQuery(
    `SELECT id, questions FROM questionnaires WHERE id = $1 AND namen = 'proces' AND aktivna = TRUE`,
    [questionnaire_id]
  );
  if (!predloga) return res.status(500).json({ error: 'db_error' });
  if (!predloga.rows.length) {
    return res.status(404).json({ error: 'predloga_ne_obstaja_ali_ni_aktivna' });
  }

  const snapshot = predloga.rows[0].questions;
  const v = validirajVprasanja(snapshot);
  if (!v.ok) {
    // Predloga v bazi je pokvarjena — bolje povedati zdaj kot pustiti
    // komercialista pred praznim obrazcem na sestanku.
    return res.status(500).json({ error: 'predloga_ni_veljavna', detail: v.error });
  }

  const company_id = idIzParam(body.company_id);   // neobvezno
  const kartica = {
    stranka_naziv,
    proces: nizAliNull(body.proces, 200),
    oddelek: nizAliNull(body.oddelek, 200),
    svetovalec: nizAliNull(body.svetovalec, 200),
    datum_sestanka: nizAliNull(body.datum_sestanka, 20),
  };

  const zacetniOdgovori = prednapolniGlavo(snapshot, kartica);

  const r = await dbQuery(`
    INSERT INTO process_sessions (
      questionnaire_id, company_id, stranka_naziv, proces, oddelek, svetovalec,
      datum_sestanka, questions_snapshot, answers, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'osnutek')
    RETURNING id, stranka_naziv, proces, status, created_at
  `, [
    questionnaire_id,
    company_id,
    kartica.stranka_naziv,
    kartica.proces,
    kartica.oddelek,
    kartica.svetovalec,
    kartica.datum_sestanka,
    JSON.stringify(snapshot),
    JSON.stringify(zacetniOdgovori),
  ]);

  if (!r) return res.status(500).json({ error: 'db_error' });
  res.status(201).json({ ok: true, seja: r.rows[0] });
});

// GET /api/procesi/seje/:id — cela seja z vprasanji, odgovori, transkripti,
// zgodovino poslanih emailov in predlogo spremnega besedila.
router.get('/seje/:id', async (req, res) => {
  const id = idIzParam(req.params.id);
  if (!id) return slabId(res);

  const seja = await naloziSejo(id);
  if (!seja) return res.status(404).json({ error: 'not_found' });

  const [transkripti, emaili] = await Promise.all([
    dbQuery(`
      SELECT id, soniox_url, znakov, vir, status, napaka, fetched_at,
             left(coalesce(raw_text, ''), 400) AS predogled
        FROM process_transcripts WHERE session_id = $1 ORDER BY fetched_at DESC
    `, [id]),
    dbQuery(`
      SELECT id, prejemnik, zadeva, status, napaka, poslal, sent_at
        FROM process_emails WHERE session_id = $1 ORDER BY sent_at DESC
    `, [id]),
  ]);

  res.json({
    seja,
    napredek: izracunajNapredek(seja.questions_snapshot, seja.answers),
    manjka_obveznih: preveriObvezna(seja.questions_snapshot, seja.answers),
    transkripti: transkripti?.rows ?? [],
    emaili: emaili?.rows ?? [],
    privzeto_sporocilo: privzetoSporocilo(seja),
    // UI brez tega ne more lociti "kljuc manjka" od "posiljanje je padlo";
    // gumb je ob false onemogocen z razlago, ne aktiven in tih.
    posiljanje_vklopljeno: jePosiljanjeVklopljeno(),
  });
});

// PATCH /api/procesi/seje/:id — AUTOSAVE med sestankom.
//
// Ta ruta je namenoma popustljiva: nikoli ne zavrne odgovorov zaradi
// manjkajocih obveznih polj. Med pogovorom s stranko se vpisuje po vrsti in
// nepopolno; blokada bi pomenila izgubljen zapis. Obvezna polja preveri
// /zakljuci.
router.patch('/seje/:id', async (req, res) => {
  const id = idIzParam(req.params.id);
  if (!id) return slabId(res);

  const seja = await naloziSejo(id);
  if (!seja) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};
  const updates = [];
  const params = [];
  let p = 1;

  // Vprasanja te seje (prilagoditev na stranko). Ne dotakne se predloge.
  let vprasanja = seja.questions_snapshot;
  if (Array.isArray(body.questions_snapshot)) {
    const v = validirajVprasanja(body.questions_snapshot);
    if (!v.ok) return res.status(400).json({ error: 'invalid_questions', detail: v.error });
    vprasanja = body.questions_snapshot;
    updates.push(`questions_snapshot = $${p++}`);
    params.push(JSON.stringify(vprasanja));
  }

  let opozorila = [];
  let piseOdgovore = false;
  if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
    // Zlijemo z obstojecimi odgovori, da delni PATCH ne izbrise ostalega.
    const zlito = { ...(seja.answers || {}), ...body.answers };
    const { answers, napake } = normalizirajOdgovore(vprasanja, zlito);
    opozorila = napake;
    piseOdgovore = true;
    updates.push(`answers = $${p++}`);
    params.push(JSON.stringify(answers));
    // Vsako pisanje odgovorov dvigne revizijo — tudi za stare kliente brez
    // answers_rev, da novejsi zavihek konflikt vedno opazi.
    updates.push('answers_rev = answers_rev + 1');
  }

  // CAS: ce klient poslje answers_rev, se zapis izvede samo ob ujemanju.
  // Brez answers_rev (stari klienti / meta polja) ostane stari nacin.
  const revKlienta = Number.isInteger(body.answers_rev) ? body.answers_rev : null;
  if (revKlienta !== null && !piseOdgovore) {
    return res.status(400).json({ error: 'answers_rev_brez_answers' });
  }

  for (const [polje, maxDolzina] of [
    ['stranka_naziv', 200], ['proces', 200], ['oddelek', 200], ['svetovalec', 200],
  ]) {
    if (typeof body[polje] === 'string') {
      const vrednost = polje === 'stranka_naziv'
        ? nizAliNull(body[polje], maxDolzina)
        : nizAliNull(body[polje], maxDolzina);
      if (polje === 'stranka_naziv' && !vrednost) {
        return res.status(400).json({ error: 'empty_stranka_naziv' });
      }
      updates.push(`${polje} = $${p++}`);
      params.push(vrednost);
    }
  }

  if (typeof body.datum_sestanka === 'string') {
    updates.push(`datum_sestanka = $${p++}`);
    params.push(nizAliNull(body.datum_sestanka, 20));
  }

  if (typeof body.company_id !== 'undefined') {
    updates.push(`company_id = $${p++}`);
    params.push(idIzParam(body.company_id));
  }

  if (typeof body.status === 'string') {
    const status = body.status.trim();
    if (!STATUSI.has(status)) return res.status(400).json({ error: 'invalid_status' });
    // Prehod v 'zakljucen' gre SAMO prek /zakljuci, kjer se preverijo
    // obvezna polja. Tu dovolimo le vrnitev v osnutek in arhiviranje.
    if (!['osnutek', 'arhiv'].includes(status)) {
      return res.status(400).json({ error: 'status_prek_te_rute_ni_dovoljen', detail: 'uporabi /zakljuci ali /poslji' });
    }
    updates.push(`status = $${p++}`);
    params.push(status);
  }

  if (!updates.length) return res.status(400).json({ error: 'no_fields_to_update' });

  updates.push('updated_at = NOW()');
  params.push(id);
  let where = `id = $${p++}`;
  if (revKlienta !== null) {
    where += ` AND answers_rev = $${p++}`;
    params.push(revKlienta);
  }

  const r = await dbQuery(
    `UPDATE process_sessions SET ${updates.join(', ')} WHERE ${where}
     RETURNING id, status, updated_at, questions_snapshot, answers, answers_rev`,
    params
  );
  if (!r) return res.status(500).json({ error: 'db_error' });

  // 0 vrstic ob CAS pogoju = drug zavihek je medtem pisal. Vrnemo svezo
  // revizijo, da klient ENKRAT ponovi (obrazec v zavihku je najnovejsa
  // volja uporabnika); seja sama gotovo obstaja, ker smo jo zgoraj nalozili.
  if (!r.rows.length) {
    const svez = await dbQuery(
      'SELECT answers_rev FROM process_sessions WHERE id = $1', [id]
    );
    return res.status(409).json({
      error: 'answers_conflict',
      answers_rev: svez?.rows?.[0]?.answers_rev ?? null,
    });
  }

  const posodobljena = r.rows[0];
  res.json({
    ok: true,
    seja: { id: posodobljena.id, status: posodobljena.status, updated_at: posodobljena.updated_at },
    napredek: izracunajNapredek(posodobljena.questions_snapshot, posodobljena.answers),
    answers_rev: posodobljena.answers_rev,
    opozorila,
  });
});

// POST /api/procesi/seje/:id/zakljuci — preveri obvezna polja in zakljuci.
// ?vsiljeno=1 (ali body.vsiljeno) zakljuci tudi z manjkajocimi polji, ker
// stranka na sestanku ne pove vedno vsega — a manjkajoca polja vrnemo, da
// jih komercialist vidi.
router.post('/seje/:id/zakljuci', async (req, res) => {
  const id = idIzParam(req.params.id);
  if (!id) return slabId(res);

  const seja = await naloziSejo(id);
  if (!seja) return res.status(404).json({ error: 'not_found' });

  const manjka = preveriObvezna(seja.questions_snapshot, seja.answers);
  const vsiljeno = req.body?.vsiljeno === true || req.query.vsiljeno === '1';

  if (manjka.length && !vsiljeno) {
    return res.status(422).json({ error: 'manjkajo_obvezna_polja', manjka });
  }

  const r = await dbQuery(`
    UPDATE process_sessions
       SET status = 'zakljucen', zakljucen_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status IN ('osnutek', 'zakljucen')
     RETURNING id, status, zakljucen_at
  `, [id]);
  if (!r) return res.status(500).json({ error: 'db_error' });
  if (!r.rows.length) {
    return res.status(409).json({ error: 'napacen_status', detail: `seja je v statusu ${seja.status}` });
  }

  res.json({ ok: true, seja: r.rows[0], manjka });
});

// ── DEL 6: Rute — transkripti ────────────────────────────────────────────

// POST /api/procesi/seje/:id/transkript
// Dve poti, obe izpolnita Majino zahtevo (kopija besedila v NASI bazi):
//   { soniox_url: "..." }  -> aplikacija poskusi prenesti sama
//   { besedilo: "..." }    -> clovek prilepi (soniox_url je lahko zraven kot izvor)
router.post('/seje/:id/transkript', async (req, res) => {
  const id = idIzParam(req.params.id);
  if (!id) return slabId(res);

  const obstaja = await dbQuery('SELECT id FROM process_sessions WHERE id = $1', [id]);
  if (!obstaja) return res.status(500).json({ error: 'db_error' });
  if (!obstaja.rows.length) return res.status(404).json({ error: 'not_found' });

  const besedilo = typeof req.body?.besedilo === 'string' ? req.body.besedilo : '';
  const soniox_url = nizAliNull(req.body?.soniox_url, 2000);

  // Rocno prilepljeno besedilo ima PREDNOST: ce ga je clovek prinesel,
  // ne ugibamo po povezavi.
  if (besedilo.trim()) {
    const vrstica = await shraniTranskript({
      session_id: id, soniox_url, besedilo, vir: 'rocno',
    });
    if (!vrstica) return res.status(500).json({ error: 'db_error' });
    await dbQuery('UPDATE process_sessions SET updated_at = NOW() WHERE id = $1', [id]);
    return res.status(201).json({ ok: true, transkript: vrstica });
  }

  if (!soniox_url) {
    return res.status(400).json({ error: 'manjka_besedilo_ali_soniox_url' });
  }
  if (!jeUrl(soniox_url)) {
    return res.status(400).json({ error: 'neveljaven_url' });
  }

  const rezultat = await dodajIzPovezave({ session_id: id, soniox_url });
  await dbQuery('UPDATE process_sessions SET updated_at = NOW() WHERE id = $1', [id]);

  if (!rezultat.ok) {
    // 200 z ok:false — vrstica JE shranjena (s povezavo in razlogom napake),
    // zato to ni napaka zahteve. UI naj ponudi rocno lepljenje.
    return res.json({
      ok: false,
      napaka: rezultat.napaka,
      transkript: rezultat.vrstica,
      nasvet: 'Samodejni prenos ni uspel. Prilepite transkript rocno v polje besedila.',
    });
  }

  res.status(201).json({ ok: true, transkript: rezultat.vrstica });
});

// GET /api/procesi/seje/:id/transkript/:tid — cel surov transkript.
// Loceno od GET seje, ker je lahko zelo velik in ga ne zelimo v vsakem odzivu.
router.get('/seje/:id/transkript/:tid', async (req, res) => {
  const id = idIzParam(req.params.id);
  const tid = idIzParam(req.params.tid);
  if (!id || !tid) return slabId(res);

  const r = await dbQuery(`
    SELECT id, session_id, soniox_url, raw_text, znakov, vir, status, napaka, fetched_at
      FROM process_transcripts WHERE id = $1 AND session_id = $2
  `, [tid, id]);
  if (!r) return res.status(500).json({ error: 'db_error' });
  if (!r.rows.length) return res.status(404).json({ error: 'not_found' });

  res.json({ transkript: r.rows[0] });
});

// ── DEL 7: Rute — predogled, PDF, posiljanje ─────────────────────────────

// GET /api/procesi/seje/:id/predogled?namen=stranka|interno
// Vrne HTML. To je surovina za email in hkrati tiskalni pogled.
router.get('/seje/:id/predogled', async (req, res) => {
  const id = idIzParam(req.params.id);
  if (!id) return slabId(res);

  const seja = await naloziSejo(id);
  if (!seja) return res.status(404).json({ error: 'not_found' });

  const namen = req.query.namen === 'interno' ? 'interno' : 'stranka';
  const transkript = namen === 'interno' ? await najnovejsiTranskript(id) : null;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderirajIzpolnjen({ seja, transkript, namen }));
});

// GET /api/procesi/seje/:id/pdf?namen=stranka|interno
router.get('/seje/:id/pdf', async (req, res) => {
  const id = idIzParam(req.params.id);
  if (!id) return slabId(res);

  const seja = await naloziSejo(id);
  if (!seja) return res.status(404).json({ error: 'not_found' });

  const namen = req.query.namen === 'interno' ? 'interno' : 'stranka';
  const transkript = namen === 'interno' ? await najnovejsiTranskript(id) : null;

  const pdf = await renderirajHtml(renderirajIzpolnjen({ seja, transkript, namen }));
  if (!pdf) {
    return res.status(503).json({
      error: 'pdf_ni_na_voljo',
      detail: 'Chromium ni dosegljiv. Uporabi /predogled in natisni iz brskalnika.',
    });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="seja-${id}.pdf"`);
  res.send(Buffer.from(pdf));
});

// POST /api/procesi/seje/:id/poslji — poslji izpolnjen vprasalnik STRANKI.
//
// Edina ruta v tem modulu, ki gre iz hise. Zato zahteva:
//   - izrecen prejemnik (nikoli ne ugibamo iz odgovorov),
//   - potrjeno: true (varovalka proti nakljucnemu POST-u iz UI-ja),
//   - zakljuceno sejo ali izrecno vsiljeno posiljanje osnutka.
router.post('/seje/:id/poslji', async (req, res) => {
  const id = idIzParam(req.params.id);
  if (!id) return slabId(res);

  const seja = await naloziSejo(id);
  if (!seja) return res.status(404).json({ error: 'not_found' });

  const body = req.body || {};

  if (body.potrjeno !== true) {
    return res.status(400).json({
      error: 'ni_potrjeno',
      detail: 'Posiljanje stranki zahteva potrjeno: true.',
    });
  }

  const prejemnik = nizAliNull(body.prejemnik, 200);
  if (!prejemnik || !veljavenEmail(prejemnik)) {
    return res.status(400).json({ error: 'neveljaven_prejemnik' });
  }

  if (seja.status === 'osnutek' && body.vsiljeno !== true) {
    const manjka = preveriObvezna(seja.questions_snapshot, seja.answers);
    return res.status(422).json({
      error: 'seja_ni_zakljucena',
      detail: 'Najprej zakljuci sejo ali poslji z vsiljeno: true.',
      manjka,
    });
  }

  const rezultat = await posljiStranki({
    seja,
    prejemnik,
    zadeva: nizAliNull(body.zadeva, 300),
    sporocilo: typeof body.sporocilo === 'string' ? body.sporocilo : null,
    priloziPdf: body.prilozi_pdf !== false,
    poslal: nizAliNull(body.poslal, 200),
  });

  if (!rezultat.ok) {
    return res.status(502).json({ error: 'posiljanje_ni_uspelo', detail: rezultat.napaka });
  }

  res.json({ ok: true, resend_id: rezultat.resend_id, prejemnik });
});

// ── DEL 8: Ruta — cross-analiza (FAZA 1, determinirano) ──────────────────

// GET /api/procesi/analiza — primerjava izpolnjenih vprasalnikov cez seje.
//
// Tu ni AI klica. Vsaka stevilka je prestevek nad odgovori (src/procesi/analiza.js);
// Faza 2 bo ta izpis podala modelu kot dejstva, ki jih sme citirati, ne racunati.
//
// Filtri (vsi neobvezni):
//   ?status=zakljucen,poslan   seznam statusov | 'vse' | privzeto vse razen arhiva
//   ?predloga=<questionnaire_id>
//   ?od=YYYY-MM-DD & ?do=YYYY-MM-DD   po datumu sestanka
//   ?svetovalec=<niz>  ?stranka=<niz>
//
// Filtri so v SQL in ne v brskalniku (za razliko od seznama sej): analiza
// prenasa cele snapshote in odgovore, zato je nabor treba zozati PRED
// prenosom, ne po njem.
router.get('/analiza', async (req, res) => {
  const pogoji = [];
  const params = [];
  let p = 1;

  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  if (status === 'vse') {
    // brez pogoja
  } else if (status) {
    // Seznam je dovoljen, ker je "zakljucene in poslane" (= izpolnjeni
    // vprasalniki, ki jih je smiselno primerjati) osnovni pogled te strani.
    const izbrani = status.split(',').map(s => s.trim()).filter(Boolean);
    for (const s of izbrani) {
      if (!STATUSI.has(s)) return res.status(400).json({ error: 'invalid_status', detail: s });
    }
    if (!izbrani.length) return res.status(400).json({ error: 'invalid_status', detail: status });
    pogoji.push(`s.status = ANY($${p++})`);
    params.push(izbrani);
  } else {
    pogoji.push(`s.status <> 'arhiv'`);
  }

  const predloga = idIzParam(req.query.predloga);
  if (typeof req.query.predloga === 'string' && req.query.predloga.trim() && !predloga) {
    return res.status(400).json({ error: 'invalid_predloga' });
  }
  if (predloga) {
    pogoji.push(`s.questionnaire_id = $${p++}`);
    params.push(predloga);
  }

  // Datum sestanka je DATE; primerjamo z nizom, ker ga tako tudi beremo
  // (pg.types.setTypeParser(1082) v src/db.js — brez tega se datum premakne
  // za dan nazaj).
  for (const [kljuc, operator] of [['od', '>='], ['do', '<=']]) {
    const v = typeof req.query[kljuc] === 'string' ? req.query[kljuc].trim() : '';
    if (!v) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return res.status(400).json({ error: 'invalid_datum', detail: kljuc });
    }
    pogoji.push(`s.datum_sestanka ${operator} $${p++}::date`);
    params.push(v);
  }

  for (const [kljuc, stolpec] of [['svetovalec', 's.svetovalec'], ['stranka', 's.stranka_naziv']]) {
    const v = typeof req.query[kljuc] === 'string' ? req.query[kljuc].trim() : '';
    if (!v) continue;
    pogoji.push(`${stolpec} ILIKE $${p++}`);
    params.push(`%${v}%`);
  }

  const where = pogoji.length ? `WHERE ${pogoji.join(' AND ')}` : '';

  const r = await dbQuery(`
    SELECT s.id, s.stranka_naziv, s.proces, s.oddelek, s.svetovalec,
           s.datum_sestanka, s.status, s.questionnaire_id,
           s.questions_snapshot, s.answers,
           q.naziv_prikaz
      FROM process_sessions s
      JOIN questionnaires q ON q.id = s.questionnaire_id
      ${where}
     ORDER BY s.datum_sestanka DESC NULLS LAST, s.id DESC
     LIMIT 200
  `, params);

  if (!r) return res.status(500).json({ error: 'db_error' });

  const analiza = izracunajAnalizo(r.rows);
  res.json({
    ...analiza,
    filtri: {
      status: status || 'brez arhiva',
      predloga: predloga ?? null,
      od: req.query.od ?? null,
      do: req.query.do ?? null,
      svetovalec: req.query.svetovalec ?? null,
      stranka: req.query.stranka ?? null,
    },
  });
});

// ── DEL 9: Named export ──────────────────────────────────────────────────
export { router };
