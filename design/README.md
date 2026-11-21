# Landing page design sketch

Working files for the proposed Campfire landing page. They are not part of the app.

- `Campfire landing sketch.html`: the sketch, one self-contained file. Open it in a browser. The "Notas de diseño" switch shows the internal design notes.
- `Campfire icon system.html`: the proposed icon sheet, waiting for approval.
- `landing.src.html`, `icons.src.html`, `icons.sprite.svg`: the sources.
- `img/`: web-size copies of the brand images and renders.
- `scripts/`: build scripts.

Rebuild after editing a source, from the repository root:

```bash
python3 design/scripts/build.py design design/img
python3 design/scripts/build_public.py "design/Campfire landing sketch.html" public/landing-sketch/index.html
```

The second command refreshes the public copy (without the notes) served at `/landing-sketch/`.
