// ── Naloge ("Danes") ──────────────────────────────────────────────────────
// Prva stran admina odgovarja na eno vprasanje: kaj je treba narediti.
// Ta ruta zato ne vraca stevcev (tiste ima /api/stats), ampak SEZNAM DELA,
// razvrscen v tri vedra:
//
//   ukrepaj     — na nas, blokira napredek (seja brez transkripta, zakljucena
//                 seja, ki ni poslana, odgovor brez priporocil ...)
//   caka        — se premika brez nas (zastala seja tujega svetovalca, poslano
//                 stranki brez odziva)
//   zakljuceno  — kaj je bilo v zadnjih 7 dneh dejansko konec (potrditev, da
//                 seznam ni samo dolg)
//
// Vsak element ima `tip`, po katerem stran izbere besedilo in gumbe. Besedila
// so NALASC v brskalniku, ne tu: SQL in slovenscina se ne mesata.
//
// Vse poizvedbe so BRALNE. Ruta nicesar ne spremeni.
import express from 'express';
import { dbQuery } from '../db.js';
import { izracunajNapredek } from '../procesi/schema.js';

const router = express.Router();

// Koliko dni brez posodobitve pomeni, da je osnutek "zastal".
const ZASTALO_DNI = 3;
// Koliko dni po poslanem dopisu brez odziva stranke sprozi follow-up.
const BREZ_ODZIVA_DNI = 5;
// Varovalka, da dolg seznam ne pobije strani.
const LIMIT_NA_VEDRO = 25;

// Seje s stevilom transkriptov in poslanih dopisov. Napredek se racuna v
// Node prek izracunajNapredek(), ISTO kot v /api/procesi/seje — dve razlicni
// definiciji "izpolnjenosti" v isti aplikaciji sta vir prepirov.
async function naloziSeje() {
  const r = await dbQuery(`
    SELECT s.id, s.stranka_naziv, s.proces, s.oddelek, s.svetovalec, s.status,
           s.datum_sestanka, s.updated_at, s.zakljucen_at,
           s.questions_snapshot, s.answers,
           (SELECT count(*) FROM process_transcripts t
             WHERE t.session_id = s.id AND t.status = 'ok')::int AS st_transkriptov,
           (SELECT count(*) FROM process_emails e
             WHERE e.session_id = s.id AND e.status = 'poslan')::int AS st_poslanih,
           (SELECT max(e.sent_at) FROM process_emails e
             WHERE e.session_id = s.id AND e.status = 'poslan') AS zadnji_poslan_at,
           (SELECT count(*) FROM process_emails e
             WHERE e.session_id = s.id AND e.status = 'napaka')::int AS st_napak
      FROM process_sessions s
     WHERE s.status <> 'arhiv'
     ORDER BY s.updated_at DESC
     LIMIT 200
  `);
  if (!r) return null;
  return r.rows.map((s) => {
    const { questions_snapshot, answers, ...ostalo } = s;
    return { ...ostalo, napredek: izracunajNapredek(questions_snapshot, answers) };
  });
}

// Lead stran: podjetja, ki cakajo na AI ali na oceno.
async function naloziLeade() {
  const r = await dbQuery(`
    SELECT
      -- Ima odgovore, nima nobenega priporocila.
      (SELECT count(*) FROM companies c
        WHERE NOT EXISTS (SELECT 1 FROM company_priporocila cp WHERE cp.company_id = c.id)
          AND EXISTS (SELECT 1 FROM responses r WHERE r.company_id = c.id)
      )::int AS brez_priporocil,
      -- Priporocila obstajajo, a je za njimi prisel novejsi odgovor.
      (SELECT count(*) FROM company_priporocila cp
        WHERE EXISTS (
          SELECT 1 FROM responses r
           WHERE r.company_id = cp.company_id
             AND r.questionnaire_id = cp.questionnaire_id
             AND r.submitted_at > cp.updated_at
        )
      )::int AS zastarela_priporocila
  `);
  if (!r) return null;
  return r.rows[0];
}

// Nova podjetja brez kvalifikacije — samo iz lead vprasalnikov, da se v
// seznamu ne pojavijo shramba in procesni obrazci.
async function naloziNeocenjene() {
  const r = await dbQuery(`
    SELECT c.id AS company_id, c.naziv_prikaz, max(r.submitted_at) AS zadnji_odgovor
      FROM companies c
      JOIN responses r ON r.company_id = c.id
      JOIN questionnaires q ON q.id = r.questionnaire_id
     WHERE c.kvalifikacija IS NULL
       AND q.je_lead_vprasalnik = TRUE
     GROUP BY c.id, c.naziv_prikaz
     ORDER BY max(r.submitted_at) DESC
     LIMIT $1
  `, [LIMIT_NA_VEDRO]);
  return r ? r.rows : null;
}

// Poslano stranki, a brez odziva — merilo je datum poslanega dopisa.
function jeStarejseOd(datum, dni) {
  if (!datum) return false;
  return Date.now() - new Date(datum).getTime() > dni * 86400000;
}

// GET /api/naloge
router.get('/', async (_req, res) => {
  const [seje, leadi, neocenjeni] = await Promise.all([
    naloziSeje(), naloziLeade(), naloziNeocenjene(),
  ]);
  if (!seje || !leadi || !neocenjeni) return res.status(500).json({ error: 'db_error' });

  const ukrepaj = [];
  const caka = [];
  const zakljuceno = [];

  for (const s of seje) {
    const skupno = {
      session_id: s.id,
      stranka_naziv: s.stranka_naziv,
      proces: s.proces,
      oddelek: s.oddelek,
      svetovalec: s.svetovalec,
      napredek: s.napredek,
      datum_sestanka: s.datum_sestanka,
      updated_at: s.updated_at,
    };

    // 1. Neuspelo posiljanje je najbolj nujno: komercialist misli, da je
    //    stranka dopis dobila, pa ga ni.
    if (s.st_napak > 0 && s.st_poslanih === 0) {
      ukrepaj.push({ ...skupno, tip: 'posiljanje_padlo', prioriteta: 1 });
      continue;
    }

    // 2. Zakljucena seja, ki stranki se ni bila poslana.
    if (s.status === 'zakljucen' && s.st_poslanih === 0) {
      ukrepaj.push({
        ...skupno, tip: 'za_poslati', prioriteta: 2,
        zakljucen_at: s.zakljucen_at, ima_transkript: s.st_transkriptov > 0,
      });
      continue;
    }

    // 3. Osnutek brez transkripta — Majina zahteva iz FAZE 1.
    if (s.status === 'osnutek' && s.st_transkriptov === 0) {
      const zastalo = jeStarejseOd(s.updated_at, ZASTALO_DNI);
      (zastalo ? caka : ukrepaj).push({
        ...skupno,
        tip: zastalo ? 'seja_zastala' : 'brez_transkripta',
        prioriteta: zastalo ? 6 : 3,
        dni_brez_sprememb: Math.floor((Date.now() - new Date(s.updated_at).getTime()) / 86400000),
      });
      continue;
    }

    // 4. Osnutek s transkriptom, ki ni bil zakljucen.
    if (s.status === 'osnutek') {
      const zastalo = jeStarejseOd(s.updated_at, ZASTALO_DNI);
      (zastalo ? caka : ukrepaj).push({
        ...skupno, tip: zastalo ? 'seja_zastala' : 'za_zakljucit',
        prioriteta: zastalo ? 6 : 4,
        dni_brez_sprememb: Math.floor((Date.now() - new Date(s.updated_at).getTime()) / 86400000),
      });
      continue;
    }

    // 5. Poslano stranki: ali cakamo odziv, ali je opravljeno.
    if (s.status === 'poslan') {
      if (jeStarejseOd(s.zadnji_poslan_at, BREZ_ODZIVA_DNI)) {
        caka.push({
          ...skupno, tip: 'brez_odziva', prioriteta: 7,
          poslan_at: s.zadnji_poslan_at,
        });
      } else {
        zakljuceno.push({ ...skupno, tip: 'poslano', poslan_at: s.zadnji_poslan_at });
      }
    }
  }

  // Zakljucene in poslane seje zadnjih 7 dni gredo v tretje vedro, da je
  // vidno, kaj je bilo konec — brez tega seznam samo raste.
  for (const s of seje) {
    if (s.status === 'zakljucen' && s.st_poslanih > 0 && !jeStarejseOd(s.zakljucen_at, 7)) {
      zakljuceno.push({
        session_id: s.id, stranka_naziv: s.stranka_naziv, proces: s.proces,
        napredek: s.napredek, tip: 'zakljuceno', zakljucen_at: s.zakljucen_at,
      });
    }
  }

  // Agregirani vnosi: en element na vrsto, ne 8 enakih vrstic.
  if (leadi.brez_priporocil > 0) {
    ukrepaj.push({ tip: 'brez_priporocil', prioriteta: 5, stevilo: leadi.brez_priporocil });
  }
  if (leadi.zastarela_priporocila > 0) {
    ukrepaj.push({ tip: 'zastarela_priporocila', prioriteta: 5, stevilo: leadi.zastarela_priporocila });
  }
  for (const c of neocenjeni) {
    ukrepaj.push({
      tip: 'neocenjen_odgovor', prioriteta: 8,
      company_id: c.company_id, naziv_prikaz: c.naziv_prikaz, zadnji_odgovor: c.zadnji_odgovor,
    });
  }

  ukrepaj.sort((a, b) => (a.prioriteta ?? 99) - (b.prioriteta ?? 99));
  caka.sort((a, b) => (a.prioriteta ?? 99) - (b.prioriteta ?? 99));
  zakljuceno.sort((a, b) => new Date(b.zakljucen_at ?? b.poslan_at ?? 0) - new Date(a.zakljucen_at ?? a.poslan_at ?? 0));

  res.json({
    ukrepaj: ukrepaj.slice(0, LIMIT_NA_VEDRO),
    caka: caka.slice(0, LIMIT_NA_VEDRO),
    zakljuceno: zakljuceno.slice(0, LIMIT_NA_VEDRO),
    skupno: { ukrepaj: ukrepaj.length, caka: caka.length, zakljuceno: zakljuceno.length },
  });
});

export { router };
