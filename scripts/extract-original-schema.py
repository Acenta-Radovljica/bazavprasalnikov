"""
Izvleci originalni Formspree vprasalnik (28 vprasanj) iz
moj-ai-nacrt/index.html in zapisi v scripts/seed-questions.json
v formatu, ki ga sprejme PATCH /api/questionnaires/:id.
"""
import re
import json
from pathlib import Path

SRC = r'C:/Users/maks1/OneDrive/Desktop/acenta/projects/moj-ai-nacrt/index.html'
DST = r'C:/Users/maks1/OneDrive/Desktop/acenta/projects/bazavprasalnikov/scripts/seed-questions.json'

html = Path(SRC).read_text(encoding='utf-8')

# Strategija: izvlecemo vse <label for="..."> + sledece input/textarea/select
# in zgradimo zaporedje vprasanj. Cluster po name= z stevilskim prefiksom.

# Najdi vse <label> (lahko vsebujejo HTML kot <span class="required">*</span>)
labels = {}
for m in re.finditer(r'<label[^>]*for="([^"]+)"[^>]*>(.*?)</label>', html, re.DOTALL):
    fid = m.group(1)
    txt = re.sub(r'<[^>]+>', '', m.group(2))
    txt = re.sub(r'\s+', ' ', txt).strip()
    txt = txt.rstrip(':').strip()
    txt = txt.replace(' *', '').strip()
    labels[fid] = txt

# Najdi vse elemente input/textarea/select z name=
fields = {}  # name -> {tip, options[], required}
order = []

for m in re.finditer(r'<(input|textarea|select)\s+([^>]*?)(/?>)(.*?)(?:</\1>)?', html, re.DOTALL):
    tag = m.group(1)
    attrs = m.group(2)
    inner = m.group(4) if tag == 'select' else ''

    name_m = re.search(r'name="([^"]+)"', attrs)
    if not name_m: continue
    name = name_m.group(1)
    if name in ('viewport',): continue

    id_m = re.search(r'\bid="([^"]+)"', attrs)
    html_id = id_m.group(1) if id_m else None

    req = 'required' in attrs

    if tag == 'textarea':
        tip = 'textarea'
        opts = []
    elif tag == 'select':
        tip = 'select'
        opts = re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)</option>', inner)
        opts = [v for v, t in opts if v]
    elif tag == 'input':
        type_m = re.search(r'type="([^"]+)"', attrs)
        tp = type_m.group(1) if type_m else 'text'
        if tp == 'radio':
            tip = 'radio'
        elif tp == 'checkbox':
            tip = 'checkbox'
        elif tp == 'email':
            tip = 'email'
        elif tp == 'hidden':
            continue
        else:
            tip = 'text'
        val_m = re.search(r'value="([^"]+)"', attrs)
        opts = [val_m.group(1)] if val_m and tip in ('radio', 'checkbox') else []

    if name in fields:
        if tip in ('radio', 'checkbox'):
            fields[name]['options'].extend(opts)
            if req: fields[name]['required'] = True
    else:
        fields[name] = {
            'tip': tip,
            'options': opts,
            'required': req,
            'html_id': html_id,
        }
        order.append(name)

# Dodaj label-e — preverimo tako po name kot po html_id
for name, info in fields.items():
    lab = labels.get(name) or labels.get(info.get('html_id'))
    # Fallback: poskusimo brez stevilskega prefiksa (npr. "1_ime_priimek" → "ime_priimek")
    if not lab:
        no_pref = re.sub(r'^\d+_', '', name)
        # poisci v labels po kljucu, ki konca z no_pref
        for lk, lv in labels.items():
            if lk.endswith(no_pref) or no_pref.startswith(lk):
                lab = lv; break
    info['label'] = lab or name.replace('_', ' ').title()

# Zgradimo seznam v podanem vrstnem redu (1..28 + email)
desired_order = [
    '1_ime_priimek', '2_podjetje', '3_oddelek', '4_funkcija', '5_leta_dela',
    '6_opravila_ponavljajoca', '7_naloge_najvec_casa', '8_naloge_avtomatizirati',
    '9_podvajanje', '10_neucinkoviti_procesi', '11_cas_email', '12_emaili_ponavljajoci',
    '13_dokumenti', '13_dokumenti_drugo',
    '14_rocni_dokumenti', '15_admin_izguba', '16_mkt_aktivnosti',
    '17_vsebine', '17_vsebine_drugo',
    '18_vprasanja_strank', '19_zamude_stranke',
    '20_uporaba_ai', '21_ai_orodja', '21_ai_orodja_drugo',
    '22_ai_naloge',
    '23_ovire', '23_ovire_drugo',
    '24_ai_ucinek', '25_eno_opravilo',
    '26_izguba_casa', '26_izguba_casa_drugo',
    '27_najvecji_ucinek', '28_odprtost',
    'email',
]

# Rocno definirani label-i za polja, kjer HTML <label for=...> ne ujema name=
manual_labels = {
    '1_ime_priimek': 'Ime in priimek',
    '2_podjetje': 'Podjetje',
    '3_oddelek': 'Oddelek / področje dela',
    '4_funkcija': 'Vaša funkcija',
    '5_leta_dela': 'Koliko let že delate v podjetju?',
    '6_opravila_ponavljajoca': 'Katera opravila pri vašem delu se najpogosteje ponavljajo?',
    '7_naloge_najvec_casa': 'Katere naloge vam tedensko vzamejo največ časa?',
    '8_naloge_avtomatizirati': 'Katere naloge bi najraje avtomatizirali ali poenostavili?',
    '9_podvajanje': 'Pri katerih opravilih največkrat podvajate delo ali ročno prepisujete podatke?',
    '10_neucinkoviti_procesi': 'Kateri procesi v vašem oddelku so po vašem mnenju najbolj neučinkoviti?',
    '11_cas_email': 'Koliko časa dnevno porabite za email komunikacijo?',
    '12_emaili_ponavljajoci': 'Katere vrste emailov ali odgovorov se pogosto ponavljajo?',
    '13_dokumenti': 'Katere dokumente najpogosteje pripravljate?',
    '13_dokumenti_drugo': 'Drugo (dokumenti) — opišite',
    '14_rocni_dokumenti': 'Katere dokumente ali procese trenutno pripravljate ročno, čeprav bi jih bilo mogoče avtomatizirati?',
    '15_admin_izguba': 'Kje pri administrativnem delu izgubite največ časa?',
    '16_mkt_aktivnosti': 'Katere marketinške ali prodajne aktivnosti vam vzamejo največ časa?',
    '17_vsebine': 'Katere vrste vsebin redno pripravljate?',
    '17_vsebine_drugo': 'Drugo (vsebine) — opišite',
    '18_vprasanja_strank': 'Katere informacije ali vprašanja stranke najpogosteje ponavljajo?',
    '19_zamude_stranke': 'Ali obstajajo procesi pri delu s strankami, kjer prihaja do zamud ali nepotrebnega čakanja?',
    '20_uporaba_ai': 'Ali trenutno uporabljate kakšno AI orodje?',
    '21_ai_orodja': 'Katera AI orodja že uporabljate?',
    '21_ai_orodja_drugo': 'Drugo (AI orodja) — opišite',
    '22_ai_naloge': 'Za katere naloge trenutno uporabljate umetno inteligenco?',
    '23_ovire': 'Kaj so po vašem mnenju glavne ovire za uvedbo AI v vašem podjetju?',
    '23_ovire_drugo': 'Drugo (ovire) — opišite',
    '24_ai_ucinek': 'Na katerih področjih bi po vašem mnenju umetna inteligenca lahko imela največji učinek?',
    '25_eno_opravilo': 'Če bi lahko avtomatizirali samo eno opravilo v naslednjih 3 mesecih — kaj bi to bilo?',
    '26_izguba_casa': 'Pri katerih dejavnostih najbolj izgubljate čas?',
    '26_izguba_casa_drugo': 'Drugo (izguba časa) — opišite',
    '27_najvecji_ucinek': 'Kateri proces bi po vašem mnenju prinesel največji učinek, če bi ga optimizirali z AI?',
    '28_odprtost': 'Kako odprti ste za uvedbo AI v vašem delu?',
    'email': 'E-mail (za prejem osebnega AI načrta)',
}

# Polja, ki naj NE bodo obvezna (vsi "_drugo" fallback textareas + 28_odprtost itd. so opcijska)
optional_fields = {
    '13_dokumenti_drugo', '17_vsebine_drugo',
    '21_ai_orodja_drugo', '23_ovire_drugo', '26_izguba_casa_drugo',
}

# Polja, kjer naj options izvlecemo iz HTML (so radio/checkbox)
final_questions = []
for name in desired_order:
    if name not in fields:
        # _drugo fields niso v fields, ker je tam preverjeno name= z imenom (so type=text)
        # ampak grep je pokazal, da OBSTAJA name="13_dokumenti_drugo" — preveri se enkrat
        continue
    info = fields[name]
    q = {
        'id': name,
        'label': manual_labels.get(name, info['label']),
        'tip': info['tip'],
        'obvezno': name not in optional_fields and info['required'],
    }
    if info['tip'] in ('select', 'radio', 'checkbox') and info['options']:
        # dedup ohrani vrstni red
        seen = set(); uniq = []
        for o in info['options']:
            if o not in seen:
                seen.add(o); uniq.append(o)
        q['options'] = uniq
    final_questions.append(q)

# Drugo-polja niso radio/checkbox ampak text — preveri tip
for q in final_questions:
    if q['id'].endswith('_drugo'):
        q['tip'] = 'text'

# Diagnostika
print(f'Skupaj polj zaznanih: {len(fields)}')
print(f'V output: {len(final_questions)}')
for q in final_questions:
    opts = f"  opts={len(q.get('options', []))}" if q.get('options') else ''
    print(f"  {q['id']}: tip={q['tip']} obvezno={q['obvezno']}{opts}")

# Output JSON
out = {'questions': final_questions}
Path(DST).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'\nOK: {DST}')
