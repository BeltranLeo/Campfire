"""Make the public copy of the sketch: same page, without the internal Spanish design notes, in English.

Usage: python3 design/scripts/build_public.py "design/Campfire landing sketch.html" public/landing-sketch/index.html
"""
import pathlib
import re
import sys

src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
html = src.read_text(encoding="utf-8")
html, n = re.subn(r'<div class="nt"><div class="nt-in">.*?</div></div>\n?', "", html, flags=re.S)
html = re.sub(r'<button class="notes-toggle".*?</button>\n?', "", html, flags=re.S)
html = html.replace('<body class="notes">', "<body>")

# The repository is in English: brand token names and the design-doc reference become English too.
names = {"marfil": "ivory", "perla": "pearl", "blanco": "white", "gris-frio": "cool-grey", "noche": "night",
         "niebla": "mist", "pizarra": "slate", "brasa": "ember", "ambar": "amber", "azul": "blue", "verde": "green",
         "violeta": "violet", "alerta": "alert", "degrade": "brand-gradient", "menta": "mint"}
pattern = r"--(" + "|".join(sorted(names, key=len, reverse=True)) + r")\b"
html = re.sub(pattern, lambda m: "--" + names[m.group(1)], html)
html = html.replace('("Campfire - Sistema de diseño", v1.1)', "(Campfire brand design system, v1.1)")

assert "Notas" not in html and 'nt-in"' not in html and "ñ" not in html
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding="utf-8")
print(out, n, "note blocks removed,", round(len(html) / 1024), "KB")
