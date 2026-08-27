const BASE = 'http://127.0.0.1:3399';
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
  const ct = res.headers.get('content-type') || '';
  const telo = ct.includes('json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => '');
  return { status: res.status, telo };
}

console.log('\n=== 1. Predloge ===');
let r = await api('/api/procesi/predloge');
t('GET predloge = 200', r.status === 200, r.status);
const predloga = r.telo?.predloge?.[0];
t('ena procesna predloga', r.telo?.predloge?.length === 1, r.telo?.predloge?.length);
t('51 vprasanj', predloga?.st_vprasanj === 51, predloga?.st_vprasanj);
t('0 sej na zacetku', predloga?.st_sej === 0, predloga?.st_sej);

console.log('\n=== 2. Avtorizacija ===');
const brezAuth = await fetch(BASE + '/api/procesi/predloge');
t('brez auth = 401', brezAuth.status === 401, brezAuth.status);

console.log('\n=== 3. Javni obrazec NE servira procesnega vprasalnika ===');
const javni = await fetch(BASE + '/f/ocena-poslovnega-potenciala-ai');
t('GET /f/<proces> = 404', javni.status === 404, javni.status);
const javniPost = await fetch(BASE + '/f/ocena-poslovnega-potenciala-ai', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ gdpr_consent: true, hotel: 'x' }),
});
t('POST /f/<proces> = 404', javniPost.status === 404, javniPost.status);

console.log('\n=== 4. Lead tok se dela (regresija) ===');
const lead = await fetch(BASE + '/f/moj-ai-nacrt');
t('GET /f/moj-ai-nacrt ni 404', lead.status !== 404, lead.status);

console.log('\n=== 5. Nova seja ===');
r = await api('/api/procesi/seje', {
  method: 'POST',
  body: JSON.stringify({
    questionnaire_id: predloga.id,
    stranka_naziv: 'Hotel Astoria Bled',
    proces: 'priprava urnikov zaposlenih',
    oddelek: 'recepcija',
    svetovalec: 'Maks Zager',
    datum_sestanka: '2026-08-24',
  }),
});
t('POST seja = 201', r.status === 201, r.status);
const sid = r.telo?.seja?.id;
t('vrne id', Number.isInteger(sid), sid);

r = await api(`/api/procesi/seje/${sid}`);
t('GET seja = 200', r.status === 200, r.status);
t('snapshot ima 51 vprasanj', r.telo?.seja?.questions_snapshot?.length === 51, r.telo?.seja?.questions_snapshot?.length);
t('status = osnutek', r.telo?.seja?.status === 'osnutek', r.telo?.seja?.status);
// Glava se ob zacetku prednapolni iz kartice sestanka (hotel, oddelek,
// datum, svetovalec) — zato seja NE starta prazna. "predstavniki" nima
// ustreznika v kartici in ostane prazen.
t('napredek 4 od 43 polj (prednapolnjena glava)',
   r.telo?.napredek?.izpolnjenih === 4 && r.telo?.napredek?.skupaj === 43,
   JSON.stringify(r.telo?.napredek));
t('hotel prednapolnjen', r.telo?.seja?.answers?.hotel === 'Hotel Astoria Bled', r.telo?.seja?.answers?.hotel);
t('datum prednapolnjen', r.telo?.seja?.answers?.datum === '2026-08-24', r.telo?.seja?.answers?.datum);
t('svetovalec prednapolnjen', r.telo?.seja?.answers?.svetovalec === 'Maks Zager', r.telo?.seja?.answers?.svetovalec);
t('predstavniki NISO ugibani', !r.telo?.seja?.answers?.predstavniki, r.telo?.seja?.answers?.predstavniki);
t('5 obveznih manjka (hotel je ze izpolnjen)', r.telo?.manjka_obveznih?.length === 5,
   JSON.stringify(r.telo?.manjka_obveznih?.map(m => m.id)));
// Regresija: DATE je pg vracal kot Date, JSON pa ga je serializiral v UTC,
// zato je vpisani 24. 8. v odzivu postal 23. 8. (slovenski +02:00).
t('datum_sestanka je gol niz YYYY-MM-DD', r.telo?.seja?.datum_sestanka === '2026-08-24',
   JSON.stringify(r.telo?.seja?.datum_sestanka));
t('datum se ni premaknil za dan nazaj', !String(r.telo?.seja?.datum_sestanka).startsWith('2026-08-23'),
   JSON.stringify(r.telo?.seja?.datum_sestanka));
t('privzeto sporocilo se zacne s Pozdravljeni', String(r.telo?.privzeto_sporocilo || '').startsWith('Pozdravljeni,'),
   String(r.telo?.privzeto_sporocilo || '').slice(0, 30));

console.log('\n=== 6. Autosave vseh tipov odgovorov ===');
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH',
  body: JSON.stringify({ answers: {
    hotel: 'Hotel Astoria Bled',
    cilj: 'Skrajšati pripravo urnikov in zmanjšati število popravkov.',
    korist: { izbrano: ['prihranek časa', 'manj napak'], drugo: 'manj konfliktov v ekipi' },
    odlocitev_razlicno: 'delno',
    kazalniki: [
      ['Ure priprave urnika', '6 h/teden', '1 h/teden', 'evidenca vodje'],
      ['Popravki po objavi', '8/mesec', '2/mesec', 'interni zapis'],
      ['', '', '', ''],
    ],
  } }),
});
t('PATCH = 200', r.status === 200, r.status);
t('brez opozoril', (r.telo?.opozorila || []).length === 0, JSON.stringify(r.telo?.opozorila));

r = await api(`/api/procesi/seje/${sid}`);
const a = r.telo?.seja?.answers || {};
t('text shranjen', a.hotel === 'Hotel Astoria Bled', a.hotel);
t('textarea s sumniki', String(a.cilj).includes('Skrajšati') && String(a.cilj).includes('število'), a.cilj);
t('checkbox_multi izbrano', JSON.stringify(a.korist?.izbrano) === JSON.stringify(['prihranek časa', 'manj napak']),
   JSON.stringify(a.korist));
t('checkbox_multi drugo', a.korist?.drugo === 'manj konfliktov v ekipi', a.korist?.drugo);
t('radio shranjen', a.odlocitev_razlicno === 'delno', a.odlocitev_razlicno);
t('tabela 3x4', Array.isArray(a.kazalniki) && a.kazalniki.length === 3 && a.kazalniki[0].length === 4,
   JSON.stringify(a.kazalniki));
t('celica tabele', a.kazalniki?.[1]?.[1] === '8/mesec', a.kazalniki?.[1]?.[1]);

console.log('\n=== 7. Normalizacija zavrne smeti ===');
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH',
  body: JSON.stringify({ answers: {
    odlocitev_razlicno: 'MOGOCE_NEKAJ_CISTO_DRUGEGA',
    korist: { izbrano: ['več prihodkov', 'IZMISLJENA_MOZNOST'], drugo: 'x' },
  } }),
});
t('PATCH kljub smetem = 200 (autosave ne blokira)', r.status === 200, r.status);
t('vrne 2 opozorili', (r.telo?.opozorila || []).length === 2, JSON.stringify(r.telo?.opozorila));
r = await api(`/api/procesi/seje/${sid}`);
t('neveljaven radio zavrzen', r.telo?.seja?.answers?.odlocitev_razlicno === '',
   JSON.stringify(r.telo?.seja?.answers?.odlocitev_razlicno));
t('neveljavna moznost zavrzena, veljavna ostane',
   JSON.stringify(r.telo?.seja?.answers?.korist?.izbrano) === JSON.stringify(['več prihodkov']),
   JSON.stringify(r.telo?.seja?.answers?.korist?.izbrano));
t('delni PATCH ni izbrisal ostalega', r.telo?.seja?.answers?.hotel === 'Hotel Astoria Bled',
   r.telo?.seja?.answers?.hotel);

console.log('\n=== 8. Zakljucek preveri obvezna polja ===');
r = await api(`/api/procesi/seje/${sid}/zakljuci`, { method: 'POST', body: '{}' });
t('nepopolna seja = 422', r.status === 422, r.status);
t('vrne seznam manjkajocih', Array.isArray(r.telo?.manjka) && r.telo.manjka.length > 0, r.telo?.manjka?.length);
t('manjkajoci imajo label', !!r.telo?.manjka?.[0]?.label, JSON.stringify(r.telo?.manjka?.[0]));

console.log('\n=== 9. Transkript: rocno prilepljen ===');
const trBesedilo = 'Govorec A: Urnike pripravljamo v Excelu, vsak teden znova. '.repeat(20);
r = await api(`/api/procesi/seje/${sid}/transkript`, {
  method: 'POST', body: JSON.stringify({ besedilo: trBesedilo, soniox_url: 'https://soniox.com/t/abc123' }),
});
t('POST transkript = 201', r.status === 201, r.status);
t('vir = rocno', r.telo?.transkript?.vir === 'rocno', r.telo?.transkript?.vir);
t('status = ok', r.telo?.transkript?.status === 'ok', r.telo?.transkript?.status);
t('znakov prestetih', r.telo?.transkript?.znakov === trBesedilo.length, r.telo?.transkript?.znakov);
const tid = r.telo?.transkript?.id;

r = await api(`/api/procesi/seje/${sid}/transkript/${tid}`);
t('surovo besedilo shranjeno V BAZI', r.telo?.transkript?.raw_text === trBesedilo,
   `dolzina ${r.telo?.transkript?.raw_text?.length} vs ${trBesedilo.length}`);
t('povezava ohranjena kot izvor', r.telo?.transkript?.soniox_url === 'https://soniox.com/t/abc123');

console.log('\n=== 10. Transkript: neuspel samodejni prenos ===');
r = await api(`/api/procesi/seje/${sid}/transkript`, {
  method: 'POST', body: JSON.stringify({ soniox_url: 'https://soniox.invalid/nekaj/xyz789' }),
});
t('vrne 200 z ok:false', r.status === 200 && r.telo?.ok === false, `${r.status} ok=${r.telo?.ok}`);
t('vrstica vseeno shranjena', !!r.telo?.transkript?.id, JSON.stringify(r.telo?.transkript));
t('status = napaka', r.telo?.transkript?.status === 'napaka', r.telo?.transkript?.status);
t('napaka zabelezena', !!r.telo?.transkript?.napaka, r.telo?.transkript?.napaka);
t('ponudi rocno pot', String(r.telo?.nasvet || '').includes('rocno'), r.telo?.nasvet);

r = await api(`/api/procesi/seje/${sid}/transkript`, {
  method: 'POST', body: JSON.stringify({ soniox_url: 'to-ni-url' }),
});
t('neveljaven URL = 400', r.status === 400, r.status);
r = await api(`/api/procesi/seje/${sid}/transkript`, { method: 'POST', body: '{}' });
t('prazna zahteva = 400', r.status === 400, r.status);

console.log('\n=== 11. Predogled ===');
r = await api(`/api/procesi/seje/${sid}/predogled?namen=stranka`);
const hStranka = String(r.telo);
t('predogled = 200', r.status === 200, r.status);
t('vsebuje odgovor', hStranka.includes('Skrajšati pripravo urnikov'));
t('vsebuje stranko', hStranka.includes('Hotel Astoria Bled'));
t('vsebuje tabelo kazalnikov', hStranka.includes('Ure priprave urnika'));
t('za stranko NE vsebuje transkripta', !hStranka.includes('Urnike pripravljamo v Excelu'));
t('za stranko skrije prazna polja', !hStranka.includes('ni izpolnjeno'));
t('sumniki v HTML niso pokvarjeni', !hStranka.includes('�'));

r = await api(`/api/procesi/seje/${sid}/predogled?namen=interno`);
const hInterno = String(r.telo);
t('interni predogled vsebuje transkript', hInterno.includes('Urnike pripravljamo v Excelu'));
t('interni predogled pokaze prazna polja', hInterno.includes('ni izpolnjeno'));

console.log('\n=== 12. KLJUCNO: urejanje predloge ne spremeni ze zacete seje ===');
const predlogaPrej = await api(`/api/procesi/predloge/${predloga.id}`);
const novaVprasanja = [...predlogaPrej.telo.predloga.questions,
  { id: 'cisto_novo_vprasanje', label: 'Dodano PO zacetku seje', tip: 'text' }];
r = await api(`/api/procesi/predloge/${predloga.id}`, {
  method: 'PATCH', body: JSON.stringify({ questions: novaVprasanja }),
});
t('PATCH predloge = 200', r.status === 200, r.status);

r = await api(`/api/procesi/predloge/${predloga.id}`);
t('predloga ima zdaj 52 vprasanj', r.telo?.predloga?.questions?.length === 52, r.telo?.predloga?.questions?.length);

r = await api(`/api/procesi/seje/${sid}`);
t('ZE ZACETA seja ima se vedno 51', r.telo?.seja?.questions_snapshot?.length === 51,
   r.telo?.seja?.questions_snapshot?.length);
t('seja NE vsebuje novega vprasanja',
   !r.telo.seja.questions_snapshot.some(q => q.id === 'cisto_novo_vprasanje'));

const seja2 = await api('/api/procesi/seje', {
  method: 'POST', body: JSON.stringify({ questionnaire_id: predloga.id, stranka_naziv: 'Nov Hotel' }),
});
r = await api(`/api/procesi/seje/${seja2.telo.seja.id}`);
t('NOVA seja pa dobi 52', r.telo?.seja?.questions_snapshot?.length === 52,
   r.telo?.seja?.questions_snapshot?.length);

console.log('\n=== 13. Prilagoditev vprasanj SAMO za to sejo ===');
r = await api(`/api/procesi/seje/${sid}`);
const snap = r.telo.seja.questions_snapshot;
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH',
  body: JSON.stringify({ questions_snapshot: [...snap,
    { id: 'samo_za_astorio', label: 'Kdo dela nočno izmeno?', tip: 'text' }] }),
});
t('PATCH snapshot = 200', r.status === 200, r.status);
r = await api(`/api/procesi/predloge/${predloga.id}`);
t('predloga OSTANE 52 (ni okuzena)', r.telo?.predloga?.questions?.length === 52,
   r.telo?.predloga?.questions?.length);
r = await api(`/api/procesi/seje/${sid}`);
t('seja ima 52 svojih', r.telo?.seja?.questions_snapshot?.length === 52,
   r.telo?.seja?.questions_snapshot?.length);
t('seja ima svoje vprasanje', r.telo.seja.questions_snapshot.some(q => q.id === 'samo_za_astorio'));

console.log('\n=== 14. Validacija: pokvarjena vprasanja zavrnjena ===');
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH', body: JSON.stringify({ questions_snapshot: [{ id: 'a', label: 'A', tip: 'izmisljen_tip' }] }),
});
t('neveljaven tip = 400', r.status === 400, r.status);
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH', body: JSON.stringify({ questions_snapshot: [
    { id: 'dup', label: 'A', tip: 'text' }, { id: 'dup', label: 'B', tip: 'text' }] }),
});
t('podvojen id = 400', r.status === 400, r.status);
r = await api(`/api/procesi/seje/${sid}`, {
  method: 'PATCH', body: JSON.stringify({ questions_snapshot: [{ id: 'r', label: 'R', tip: 'radio' }] }),
});
t('radio brez options = 400', r.status === 400, r.status);
r = await api(`/api/procesi/seje/${sid}`);
t('po zavrnitvah je seja se vedno cela', r.telo?.seja?.questions_snapshot?.length === 52,
   r.telo?.seja?.questions_snapshot?.length);

console.log('\n=== 15. Posiljanje: varovalke ===');
r = await api(`/api/procesi/seje/${sid}/poslji`, {
  method: 'POST', body: JSON.stringify({ prejemnik: 'test@example.com' }),
});
t('brez potrjeno = 400', r.status === 400 && r.telo?.error === 'ni_potrjeno', `${r.status} ${r.telo?.error}`);
r = await api(`/api/procesi/seje/${sid}/poslji`, {
  method: 'POST', body: JSON.stringify({ potrjeno: true, prejemnik: 'nikakor-ni-email' }),
});
t('neveljaven email = 400', r.status === 400 && r.telo?.error === 'neveljaven_prejemnik', `${r.status} ${r.telo?.error}`);
r = await api(`/api/procesi/seje/${sid}/poslji`, {
  method: 'POST', body: JSON.stringify({ potrjeno: true, prejemnik: 'test@example.com' }),
});
t('nezakljucena seja = 422', r.status === 422 && r.telo?.error === 'seja_ni_zakljucena', `${r.status} ${r.telo?.error}`);

console.log('\n=== 16. Vsiljen zakljucek ===');
r = await api(`/api/procesi/seje/${sid}/zakljuci`, { method: 'POST', body: JSON.stringify({ vsiljeno: true }) });
t('vsiljen zakljucek = 200', r.status === 200, r.status);
t('status = zakljucen', r.telo?.seja?.status === 'zakljucen', r.telo?.seja?.status);
t('vrne kaj je manjkalo', Array.isArray(r.telo?.manjka) && r.telo.manjka.length > 0, r.telo?.manjka?.length);

console.log('\n=== 17. Posiljanje brez Resend kljuca javi napako (ne tiho) ===');
r = await api(`/api/procesi/seje/${sid}/poslji`, {
  method: 'POST', body: JSON.stringify({ potrjeno: true, prejemnik: 'test@example.com', prilozi_pdf: false }),
});
t('brez kljuca = 502 (ne lazni uspeh)', r.status === 502, r.status);
t('razlog naveden', r.telo?.detail === 'resend_kljuc_ni_nastavljen', r.telo?.detail);

console.log('\n=== 18. Neuspesno posiljanje je zabelezeno ===');
r = await api(`/api/procesi/seje/${sid}`);
const emaili = r.telo?.emaili || [];
t('poskus v revizijski sledi', emaili.length === 1, emaili.length);
t('oznacen kot napaka', emaili[0]?.status === 'napaka', emaili[0]?.status);
t('seja NI oznacena kot poslana', r.telo?.seja?.status === 'zakljucen', r.telo?.seja?.status);

console.log('\n=== 19. Seznam sej ===');
r = await api('/api/procesi/seje');
t('seznam = 200', r.status === 200, r.status);
t('dve seji', r.telo?.seje?.length === 2, r.telo?.seje?.length);
const s1 = r.telo.seje.find(s => s.id === sid);
t('napredek izracunan', s1?.napredek?.izpolnjenih > 0, JSON.stringify(s1?.napredek));
t('stete samo uspesne transkripte', s1?.st_transkriptov === 1, s1?.st_transkriptov);
t('poslanih 0', s1?.st_poslanih === 0, s1?.st_poslanih);
r = await api('/api/procesi/seje?stranka=Astoria');
t('filter po stranki', r.telo?.seje?.length === 1, r.telo?.seje?.length);
r = await api('/api/procesi/seje?status=osnutek');
t('filter po statusu', (r.telo?.seje || []).every(s => s.status === 'osnutek'),
   JSON.stringify((r.telo?.seje || []).map(s => s.status)));

console.log('\n=== 20. Regresija: lead vprasalniki nedotaknjeni ===');
r = await api('/api/questionnaires');
const vsi = r.telo?.questionnaires || [];
t('vseh vprasalnikov 5', vsi.length === 5, vsi.length);
t('lead jih je 3', vsi.filter(q => q.namen === 'lead').length === 3,
   vsi.filter(q => q.namen === 'lead').length);
t('st_sej dodan', vsi.every(q => typeof q.st_sej === 'number'));
t('procesni ima st_sej 2', vsi.find(q => q.namen === 'proces')?.st_sej === 2,
   vsi.find(q => q.namen === 'proces')?.st_sej);
t('lead ima st_sej 0', vsi.filter(q => q.namen === 'lead').every(q => q.st_sej === 0));

console.log(`\n${'─'.repeat(46)}\nOK: ${ok}   FAIL: ${fail}`);
if (padli.length) console.log('Padli testi:\n  - ' + padli.join('\n  - '));
console.log('');
process.exit(fail ? 1 : 0);
