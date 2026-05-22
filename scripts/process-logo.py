"""
Transformira logo PNG za uporabo na temnem ozadju:
- bele/skoraj-bele pixle → transparentne
- temno-sive/crne text pixle (R≈G≈B in temne) → bele
- svetlo-sive separatorje (R≈G≈B in svetle) → bele
- teal (acenta brand) → ohrani

Vhod:  assets/acenta-logo.png  (bel background, teal text + dark gray text)
Izhod: assets/acenta-logo-dark.png  (transparent background, primerno za temni header)
"""
from PIL import Image

SRC = 'assets/acenta-logo.png'
DST = 'assets/acenta-logo-dark.png'

img = Image.open(SRC).convert('RGBA')
w, h = img.size
px = img.load()

for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        # Bele/skoraj bele → transparent
        if r > 235 and g > 235 and b > 235:
            px[x, y] = (255, 255, 255, 0)
            continue
        # Sive (R≈G≈B) → na belo (text "Učinkovite rešitve" + separator)
        max_diff = max(abs(r - g), abs(g - b), abs(r - b))
        if max_diff < 15:
            # je grayscale — pretvori v belo z ohranjenim luminance kot alpha
            px[x, y] = (255, 255, 255, a)
            continue
        # Ostalo (teal) ostane

img.save(DST)
print(f'OK: {DST}')
