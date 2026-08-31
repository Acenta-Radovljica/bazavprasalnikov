// Faza 2 Codexovih popravkov: zascita pred prepisom odgovorov med zavihki
// (answers_rev CAS na PATCH /api/procesi/seje/:id) + zastavica
// posiljanje_vklopljeno v GET seje/:id.
//
// Zagon: node test/reset-testne-baze.mjs && node test/answers-rev.test.mjs

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3399';
const AUTH = 'Basic ' + Buffer.from('test@acenta.si:testgeslo123').toString('base64');

let ok = 0, fail = 0;
const padli = [];
function t(ime, pogoj, dodatek = '') {
  if (pogoj) { ok++; console.log(`  OK   ${ime}`); }
  else { fail++; padli.push(ime); console.log(`  FAIL ${ime}   >>> ${dodatek}`); }
}
async function api(pot, opt = {}) {
  const res = await fetch(BASE + pot, {
    ...opt,
    headers: { Authorization: AUTH, 'content-type': 'application/json', ...(opt.headers || {}) },
  });
  const telo = await res.json().catch(() => null);
  return { status: res.status, telo };
}

console.log('\n=== 1. Izhodisce ===');
let r = await api('/api/procesi/predloge');
const predlogaId = r.telo?.predloge?.[0]?.id;
t('predloga obstaja', Number.isInteger(predlogaId), JSON.stringify(r.telo));

r = await api('/api/procesi/seje', {
  method: 'POST',
  body: JSON.stringify({ questionnaire_id: predlogaId, stranka_naziv: 'Rev Test Hotel' }),
});
const sid = r.telo?.seja?.id;
t('nova seja', Number.isInteger(sid), r.status);

r = await api(`/api/procesi/seje/${sid}`);
t('nova seja ima answers_rev = 0', r.telo?.seja?.answers_rev === 0, r.telo?.seja?.answers_rev);

console.log('\n=== 2. Stari klienti (brez answers_rev) se delujejo ===');
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH', body: JSON.stringify({ answers: { cilj: 'prvi zapis' } }),
});
t('PATCH brez revizije = 200', r.status === 200, r.status);
t('pisanje odgovorov dvigne revizijo na 1', r.telo?.answers_rev === 1, r.telo?.answers_rev);

console.log('\n=== 3. CAS: ujemajoca revizija ===');
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH', body: JSON.stringify({ answers: { cilj: 'drugi zapis' }, answers_rev: 1 }),
});
t('PATCH z ujemajoco revizijo = 200', r.status === 200, r.status);
t('revizija zdaj 2', r.telo?.answers_rev === 2, r.telo?.answers_rev);

console.log('\n=== 4. CAS: zastarela revizija (drug zavihek je pisal) ===');
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH', body: JSON.stringify({ answers: { cilj: 'zastarel zavihek' }, answers_rev: 1 }),
});
t('PATCH z zastarelo revizijo = 409', r.status === 409, r.status);
t('409 vrne napako answers_conflict', r.telo?.error === 'answers_conflict', r.telo?.error);
t('409 vrne svezo revizijo (2)', r.telo?.answers_rev === 2, r.telo?.answers_rev);

// Zastarel zapis NI smel prijeti.
r = await api(`/api/procesi/seje/${sid}`);
t('odgovor v bazi je se "drugi zapis"', r.telo?.seja?.answers?.cilj === 'drugi zapis', r.telo?.seja?.answers?.cilj);

console.log('\n=== 5. Ponovitev s svezo revizijo uspe (klientov retry) ===');
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH', body: JSON.stringify({ answers: { cilj: 'zapis po retryju' }, answers_rev: 2 }),
});
t('retry = 200', r.status === 200, r.status);
t('revizija zdaj 3', r.telo?.answers_rev === 3, r.telo?.answers_rev);

console.log('\n=== 6. Robovi ===');
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH', body: JSON.stringify({ answers_rev: 3 }),
});
t('answers_rev brez answers = 400', r.status === 400, r.status);
t('napaka answers_rev_brez_answers', r.telo?.error === 'answers_rev_brez_answers', r.telo?.error);

// Meta polja revizije NE dvignejo (sicer bi vsak popravek kartice sestanka
// sprozil lazen konflikt pri autosave odgovorov v drugem zavihku).
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH', body: JSON.stringify({ proces: 'meta ne dviga revizije' }),
});
t('meta PATCH = 200', r.status === 200, r.status);
r = await api(`/api/procesi/seje/${sid}`);
t('revizija po meta PATCH ostane 3', r.telo?.seja?.answers_rev === 3, r.telo?.seja?.answers_rev);

console.log('\n=== 7. posiljanje_vklopljeno ===');
// Testno okolje NIMA Resend kljuca; UI iz te zastavice onemogoci gumb z
// razlago, namesto da bi bil gumb aktiven in klik tiho padel.
t('GET seje/:id vraca posiljanje_vklopljeno = false',
  r.telo?.posiljanje_vklopljeno === false, JSON.stringify(r.telo?.posiljanje_vklopljeno));

console.log(`\n${'='.repeat(50)}\nSKUPAJ: ${ok} OK, ${fail} FAIL`);
if (fail) { console.log('Padli:', padli.join(' | ')); process.exit(1); }
