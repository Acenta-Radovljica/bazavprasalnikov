// AI Business Score: deterministic report text. Used when the AI text is not (yet) available,
// so a report is never empty. Pure function of the stored result + answers; no numbers or
// claims beyond what the respondent answered.

import { PODROCJE_NAZIV } from './vprasanja-v1.js';

const RAVEN = (v) => (v >= 67 ? 'visoka' : v >= 34 ? 'srednja' : 'nizka');

export function sestaviPredlogo(rezultat, podjetje = '') {
  const { dimenzije: d, stopnja, proces, ovira } = rezultat;
  const kdo = podjetje ? `V podjetju ${podjetje}` : 'V vašem podjetju';

  const odstavek = [
    `${kdo} je AI zrelost ${RAVEN(d.zrelost)}, potencial za izboljšave v procesih pa ${RAVEN(d.potencial)}.`,
    proces
      ? `Največ priložnosti vidimo na področju „${proces.naziv.toLowerCase()}“, kjer ste označili največ izgubljenega časa ali nepotrebnih stroškov.`
      : 'Iz odgovorov še ni jasno, kateri proces bi imel največ koristi, zato je smiselno to preveriti v kratkem pogovoru.',
    ovira ? `Kot največjo oviro ste navedli: ${ovira.toLowerCase()}.` : '',
  ].filter(Boolean).join(' ');

  const dobro = [];
  if (d.zrelost >= 50) dobro.push('AI v podjetju že uporabljate širše kot le posamezniki.');
  if (d.zrelost >= 75) dobro.push('Imate postavljena pravila in odgovornosti za uporabo AI.');
  if (d.pripravljenost >= 50) dobro.push('Pripravljeni ste narediti naslednji korak v kratkem času.');
  if (proces) dobro.push(`Jasno prepoznate, kje vam odteka čas: ${proces.naziv.toLowerCase()}.`);
  if (!dobro.length) dobro.push('Z izpolnjeno oceno ste naredili prvi korak: veste, kje ste danes.');

  const zatika = [];
  if (d.zrelost < 50) zatika.push('Uporaba AI je še odvisna od posameznikov, brez skupnega načina dela.');
  if (d.zrelost < 75) zatika.push('Manjkajo dogovorjena pravila za varno uporabo AI in podatkov.');
  if (d.potencial >= 50) zatika.push('Precej časa in denarja gre v ponavljajoča se opravila.');
  if (!proces) zatika.push('Še ni izbran proces, na katerem bi AI lahko hitro pokazal učinek.');
  if (!zatika.length) zatika.push('Največji izziv ni več orodje, ampak merjenje učinka AI v procesih.');

  const priloznosti = [];
  if (proces) priloznosti.push(`${proces.priporocilo} (področje: ${PODROCJE_NAZIV[proces.id]}).`);
  priloznosti.push(`${stopnja.priporocilo}.`);
  priloznosti.push('Izbor enega procesa z merljivim ciljem: koliko ur ali stroškov naj AI prihrani.');

  return { odstavek, dobro: dobro.slice(0, 3), zatika: zatika.slice(0, 3), priloznosti: priloznosti.slice(0, 3) };
}
