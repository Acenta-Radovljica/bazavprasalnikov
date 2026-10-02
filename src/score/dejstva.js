// AI Business Score v2: facts from the follow-up block that the report can state as a
// consequence, not as an echo (Matjaž, 1. 10.: "I read what I already know").
//
// Pure and deterministic. Used by the template paragraph (predloga.js), the AI input
// (besedilo.js: the computed numbers are the only numbers the AI may add) and nothing else.
// v1 answers have no follow-up block, so every function returns nothing for them.

import { izbranoPodrocje } from '../../public/score/razvejitev.js';
import { javnaPodrocjaV2 } from './javna.js';
import { PODROCJA } from './vprasanja-v1.js';
import { VPRASANJA as V2 } from './vprasanja-v2.js';

const Q = Object.fromEntries(V2.map(q => [q.id, q]));
const eno = (o, id) => (Array.isArray(o?.[id]) ? o[id][0] : o?.[id]) ?? null;
const vec = (o, id) => (Array.isArray(o?.[id]) ? o[id] : []);

export const podrocjeSklopa = (odgovori) => izbranoPodrocje(javnaPodrocjaV2(), odgovori || {}, PODROCJA);

// Hours per month for searching suppliers and comparing prices (Word 5.2) -> [from, to].
const URE = { '2-5': [2, 5], '6-10': [6, 10], '11-20': [11, 20], vec_20: [20, null] };

// Numbers derived from the answers, as sentences the AI may quote (and the validator allows,
// because they are part of the AI input).
export function izracunano(odgovori = {}) {
  const out = [];
  const u = URE[eno(odgovori, 'nabava_ure')];
  if (podrocjeSklopa(odgovori) === 'nabava' && u) {
    out.push(u[1]
      ? `Za iskanje ponudnikov in primerjavo cen gre ${u[0]} do ${u[1]} ur na mesec, to je ${u[0] * 12} do ${u[1] * 12} ur na leto.`
      : `Za iskanje ponudnikov in primerjavo cen gre več kot ${u[0]} ur na mesec, to je več kot ${u[0] * 12} ur na leto.`);
  }
  return out;
}

// One sentence on what the follow-up answers mean for the company, or null. `kljuc` is the topic
// it uses, so the template does not say the same thing again in a list.
export function stavekPodrocja(odgovori = {}) {
  const p = podrocjeSklopa(odgovori);
  const a = (id) => eno(odgovori, id);
  const S = (kljuc, stavek) => ({ kljuc, stavek });
  switch (p) {
    case 'nabava':
      if (URE[a('nabava_ure')]) return S('nabava', izracunano(odgovori)[0]);
      if (a('nabava_ure') === 'ne_vem') return S('nabava', 'Koliko časa gre za primerjavo ponudb, ni izmerjeno, zato je tudi korist boljše nabave težko oceniti.');
      if (['ne_preverjamo', 'obcasno'].includes(a('nabavne_cene'))) return S('nabava', 'Ker cen dobaviteljev ne primerjate redno, se podražitev lahko opazi šele, ko je že plačana.');
      return null;
    case 'prodaja':
      if (['nekaj', 'veliko'].includes(a('ponudbe_ponavljajoce'))) return S('ponudbe', 'Ker se vrste ponudb ponavljajo, je velik del vsake nove ponudbe že zapisan v preteklih.');
      if (['2-3dni', 'vec_3dni', 'ni_definirano'].includes(a('odziv'))) return S('odziv', 'Ko odgovor na povpraševanje traja več dni, se stranka medtem lahko odloči za nekoga drugega.');
      return null;
    case 'marketing':
      if (['tedensko', 'veckrat_tedensko'].includes(a('vsebine_pogostost'))) return S('marketing', 'Ker vsebine pripravljate vsak teden, se vsaka ura, prihranjena pri eni objavi, ponovi večkrat na mesec.');
      if (['cas', 'rocno'].includes(a('marketing_izziv'))) return S('marketing', 'Ko vsebinam primanjkuje časa, marketing vedno znova umakne prostor nujnejšemu delu.');
      if (['ideje', 'nekonsistentno'].includes(a('marketing_izziv'))) return S('marketing', 'Brez rednega toka idej in enotnega tona komunikacija niha od objave do objave.');
      return null;
    case 'administracija':
      if (['ne', 'delno', 'tezko'].includes(a('baza_znanja'))) return S('iskanje', 'Ker znanje ni zbrano na enem mestu, zaposleni odgovore iščejo pri sodelavcih in v mapah, kar zmoti oba.');
      if (vec(odgovori, 'admin_opravila').filter(id => id !== 'drugo').length >= 2) return S('administracija', 'Administrativna opravila, ki vam vzamejo največ časa, se ponavljajo, zato jih lahko AI pripravi namesto vas.');
      return null;
    case 'vodstvo':
      if (['zelo_pocasi', 'pocasi'].includes(a('informacije_hitrost'))) return S('porocila', 'Ker do informacij za odločanje pridete počasi, se odločitve zamikajo ali sprejemajo brez celotne slike.');
      if (['ne', 'delno', 'neuporabna'].includes(a('kpi_porocila'))) return S('porocila', 'Brez uporabnih rednih poročil vodstvo spremembe opazi pozneje, kot bi jih lahko.');
      return null;
    case 'podpora':
      if (['dnevno', 'veckrat_dnevno'].includes(a('vprasanja_pogostost'))) return S('podpora', 'Ker ista vprašanja prihajajo vsak dan, gre velik del podpore v odgovore, ki so bili napisani že večkrat.');
      if (['ponavljajoca', 'iskanje'].includes(a('komunikacija_cas'))) return S('podpora', 'Čas pri komunikaciji s strankami gre v iskanje in ponavljanje odgovorov, ki že obstajajo.');
      return null;
    default:
      return null;
  }
}

// Where AI is used today (2.3) against where time and money go (4.1, 4.2 and the follow-up area).
// 'vrzel': AI helps elsewhere; 'ujemanje': AI already helps where it hurts; null: nothing to say.
export function primerjavaNalog(odgovori = {}) {
  const naloge = vec(odgovori, 'naloge').filter(id => id !== 'ne_uporabljamo');
  if (!naloge.length) return null;
  const boli = new Set();
  for (const id of ['izguba_casa', 'stroski']) {
    for (const oid of vec(odgovori, id)) { const s = Q[id]?.moznosti.find(o => o.id === oid)?.sig; if (s) boli.add(s); }
  }
  const p = podrocjeSklopa(odgovori);
  if (p) boli.add(p);
  if (!boli.size) return null;
  const pomaga = new Set(naloge.map(id => Q.naloge.moznosti.find(o => o.id === id)?.podr).filter(Boolean));
  return [...pomaga].some(x => boli.has(x)) ? 'ujemanje' : 'vrzel';
}

// The goal of the first AI project (11.2) in lower case, for the project card, or null.
export function cilj(odgovori = {}) {
  const o = Q.cilj.moznosti.find(m => m.id === eno(odgovori, 'cilj'));
  return o ? o.text.charAt(0).toLowerCase() + o.text.slice(1) : null;
}
