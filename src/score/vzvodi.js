// AI Business Score: "what would raise your score". Pure and deterministic.
//
// For each maturity question the respondent has not maxed out, move the answer ONE level up,
// rescore with the real scorer and report the gain. No invented numbers: every point shown is
// what izracunajScore() would give for that changed answer. Also tells whether the respondent
// asked for a talk (povzetekOdgovorov).

import { izracunajScore } from './izracunaj.js';
import { VPRASANJA } from './vprasanja-v1.js';

const Q = Object.fromEntries(VPRASANJA.map(q => [q.id, q]));

// Tie-break = what a company can do soonest (rules and an owner before a strategy).
const RED = ['pravila', 'odgovorna_oseba', 'razumevanje', 'sistematicnost', 'uporaba'];

// Action text per question and TARGET option (the next level up).
const KORAK = {
  pravila: {
    osnovna: 'Pripravite osnovna priporočila za varno uporabo AI in podatkov.',
    interna: 'Osnovna priporočila spremenite v interna pravila, ki veljajo za vse.',
    politika: 'Sprejmite politiko uporabe AI in varovanja podatkov.',
  },
  odgovorna_oseba: {
    neformalno: 'Določite nekoga, ki spremlja, kaj bi AI lahko naredil za vas.',
    brez_odgovornosti: 'Imenujte osebo, ki skrbi za razvoj uporabe AI v podjetju.',
    da: 'Osebi za AI dajte jasno odgovornost in cilj.',
    ekipa: 'Postavite ekipo ali formalno AI funkcijo.',
  },
  razumevanje: {
    slabo: 'Pokažite zaposlenim, kako jim AI pomaga pri njihovih nalogah.',
    povprecno: 'Organizirajte kratko delavnico za zaposlene na njihovih primerih.',
    dobro: 'Zaposlenim pokažite primere uporabe AI iz njihovega oddelka.',
    zelo_dobro: 'Uvedite redno izmenjavo dobrih primerov uporabe AI med oddelki.',
  },
  sistematicnost: {
    vsak_po_svoje: 'Ugotovite, kdo AI že uporablja in za katere naloge.',
    priporocila: 'Zapišite nekaj internih priporočil, kako AI uporabljati pri delu.',
    po_oddelkih: 'Dogovorite se za načine uporabe AI po oddelkih.',
    strategija: 'Postavite AI strategijo z jasnimi procesi in odgovornostmi.',
  },
  uporaba: {
    posamezniki: 'Naj AI pri vsakdanjih nalogah preizkusi nekaj zaposlenih.',
    vec_zaposlenih: 'Razširite redno uporabo AI s posameznikov na več zaposlenih.',
    oddelki: 'Uvedite AI v delo enega celotnega oddelka.',
    procesi: 'AI vgradite v en poslovni proces, da teče kot del dela.',
  },
};

// Next option with a higher maturity value than the current one (null = already at the top).
function naslednja(q, trenutna) {
  const zdaj = trenutna?.zre ?? 0;
  const i = trenutna ? q.moznosti.indexOf(trenutna) : -1;
  return q.moznosti.slice(i + 1).find(o => (o.zre ?? 0) > zdaj) || null;
}

// `verzija`: the score version of the submission (maturity questions are the same in v1 and v2,
// the rest of the score is not), so the gains match the score shown on the report.
export function izracunajVzvode(odgovori = {}, velikost = null, max = 3, verzija = 'v1') {
  const vhod = { ...odgovori, velikost };
  const osnova = izracunajScore(vhod, verzija);
  const vzvodi = [];
  for (const id of RED) {
    const q = Q[id];
    if (!q) continue;
    const trenutna = q.moznosti.find(o => o.id === String(odgovori[id] ?? '')) || null;
    const cilj = naslednja(q, trenutna);
    if (!cilj || !KORAK[id]?.[cilj.id]) continue;
    const nov = izracunajScore({ ...vhod, [id]: cilj.id }, verzija);
    const zrelost = nov.dimenzije.zrelost - osnova.dimenzije.zrelost;
    if (zrelost <= 0) continue;
    vzvodi.push({ id, cilj: cilj.id, korak: KORAK[id][cilj.id], zrelost, skupno: nov.skupno - osnova.skupno });
  }
  vzvodi.sort((a, b) => b.zrelost - a.zrelost || RED.indexOf(a.id) - RED.indexOf(b.id));
  const izbrani = vzvodi.slice(0, max);

  // All chosen steps together, rescored for real (not a sum of rounded deltas).
  const skupaj = izbrani.length
    ? izracunajScore({ ...vhod, ...Object.fromEntries(izbrani.map(v => [v.id, v.cilj])) }, verzija)
    : osnova;

  return {
    vzvodi: izbrani.map(({ id, korak, zrelost, skupno }) => ({ id, korak, zrelost, skupno })),
    skupaj: {
      zrelost: skupaj.dimenzije.zrelost,
      skupno: skupaj.skupno,
      stopnja: skupaj.stopnja.naziv,
      novaStopnja: skupaj.stopnja.naziv !== osnova.stopnja.naziv,
    },
  };
}

// The report no longer echoes answer texts (1. 10. 2026, Matjaž: "only what I ticked");
// only whether the respondent asked for a talk, which changes the report's closing.
export function povzetekOdgovorov(odgovori = {}) {
  return { zeliPogovor: odgovori.hitrost === 'pogovor' || odgovori.interpretacija === 'pogovor' };
}
