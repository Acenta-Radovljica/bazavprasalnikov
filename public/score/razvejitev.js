// AI Business Score v2: which follow-up questions a respondent gets. Pure, no DOM, no imports.
//
// Loaded by BOTH the quiz in the browser (./razvejitev.js) and the server validation
// (src/score/oddaja.js), with the same public question set, so the two can never disagree on
// which questions are required.
//
// Input is the public question set from /ai-business-score/vprasanja.json: a question with
// `podrocje` belongs to that area's follow-up block; options of `proces90` carry the area they
// pick; options of the time and cost questions carry the area they point to.

// The area whose follow-up block is shown, or null (no block).
// 1. The area picked at "one process in the next 90 days".
// 2. "Operativa" or "Ne vem": the area named most often under time and cost, ties broken by
//    `vrstniRed` (business impact order). Nothing named there: no block.
export function izbranoPodrocje(vprasanja, odgovori, vrstniRed) {
  const q90 = vprasanja.find(q => q.id === 'proces90');
  const izbira = q90?.moznosti.find(o => o.id === odgovori?.proces90);
  if (!izbira) return null;
  if (izbira.podrocje) return izbira.podrocje;
  const stej = {};
  for (const id of ['izguba_casa', 'stroski']) {
    const q = vprasanja.find(x => x.id === id);
    const v = odgovori?.[id];
    for (const oid of Array.isArray(v) ? v : []) {
      const p = q?.moznosti.find(o => o.id === oid)?.podrocje;
      if (p) stej[p] = (stej[p] || 0) + 1;
    }
  }
  return vrstniRed.reduce((best, p) => ((stej[p] || 0) > (best ? stej[best] : 0) ? p : best), null);
}

// Questions the respondent sees, in order: every common question plus the chosen area's block.
export function vidnaVprasanja(vprasanja, odgovori, vrstniRed) {
  const p = izbranoPodrocje(vprasanja, odgovori, vrstniRed);
  return vprasanja.filter(q => !q.podrocje || q.podrocje === p);
}
