"""Build the single-file sketch pages: inline the brand images and the icon sprite.

Usage, from the repository root: python3 design/scripts/build.py design design/img
"""
import base64
import pathlib
import sys

proto, img = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
sprite = (proto / "icons.sprite.svg").read_text(encoding="utf-8")
imgs = {
    "TEXTURE": ("texture.jpg", "image/jpeg"),
    "LOGO_DARK": ("logo-dark.png", "image/png"),
    "SYMBOL": ("symbol.png", "image/png"),
    "BAND_N2I": ("band-n2i.jpg", "image/jpeg"),
    "BAND_I2N": ("band-i2n.jpg", "image/jpeg"),
    "SIM_RIBBON": ("sim-ribbon.jpg", "image/jpeg"),
    "PANEL_LIGHT": ("panel-light.png", "image/png"),
    "PANEL_BLUE": ("panel-blue.png", "image/png"),
    "BANNER_GLASS": ("banner-glass.jpg", "image/jpeg"),
    "BEN1": ("ben1.jpg", "image/jpeg"),
    "BEN2": ("ben2.jpg", "image/jpeg"),
    "BEN3": ("ben3.jpg", "image/jpeg"),
    "BEN4": ("ben4.jpg", "image/jpeg"),
    "WALL": ("wall.png", "image/png"),
    "BOOK": ("book.png", "image/png"),
    "COIN_BCH": ("coin-bch.png", "image/png"),
}
for src, outs in [("landing.src.html", ["Campfire landing sketch.html", "index.html"]), ("icons.src.html", ["Campfire icon system.html"])]:
    html = (proto / src).read_text(encoding="utf-8").replace("{{SPRITE}}", sprite)
    for key, (name, mime) in imgs.items():
        if "{{%s}}" % key in html:
            html = html.replace("{{%s}}" % key, f"data:{mime};base64," + base64.b64encode((img / name).read_bytes()).decode())
    assert "{{" not in html, src
    for o in outs:
        (proto / o).write_text(html, encoding="utf-8")
    print(src, "->", outs, round(len(html) / 1024), "KB")
