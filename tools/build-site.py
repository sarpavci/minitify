#!/usr/bin/env python3
"""Copies the design pages out of the design workspace into site/.

Two things change on the way in:

* The album artwork. The design workspace uses the real Random Access
  Memories cover, which is copyrighted and must not be committed to a
  public repository. It is also a lie about the product: minitify ships
  no artwork at all and fetches every cover from Spotify at runtime. The
  substitute below is generated from the project's own palette.
* Nothing else. The pages are copied verbatim, so the site cannot drift
  away from what the design workspace actually contains.

    python3 tools/build-site.py [--source DIR]
"""
import argparse
import pathlib
import re
import shutil
import sys

DEFAULT_SOURCE = pathlib.Path.home() / "Workstation/Designs/minitify-overlay-mini-player-8e90"

# source name -> published name
PAGES = {
    "index.html": "ui.html",
    "logo.html": "logo.html",
    "motion.html": "motion.html",
    "film.html": "film.html",
}

# index.html is the only page that is not self-contained; it loads these.
SIDECARS = ("styles.css", "app.js")

PLACEHOLDER_COVER = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" \
width="640" height="640" role="img" aria-label="Placeholder album artwork">
  <title>Placeholder artwork</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2a24"/>
      <stop offset="0.55" stop-color="#101619"/>
      <stop offset="1" stop-color="#070b0d"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.32" cy="0.28" r="0.75">
      <stop offset="0" stop-color="#3fb673" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#3fb673" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="640" fill="url(#bg)"/>
  <rect width="640" height="640" fill="url(#glow)"/>
  <circle cx="205" cy="180" r="128" fill="none" stroke="#9ff0ba" stroke-opacity="0.16" \
stroke-width="1.5"/>
  <circle cx="205" cy="180" r="196" fill="none" stroke="#9ff0ba" stroke-opacity="0.09" \
stroke-width="1.5"/>
  <g fill="#87e6a6" fill-opacity="0.9">
    <rect x="392" y="398" width="34" height="152" rx="16"/>
    <rect x="446" y="398" width="34" height="68" rx="16"/>
    <rect x="500" y="398" width="34" height="92" rx="16"/>
    <rect x="554" y="398" width="34" height="68" rx="16"/>
  </g>
</svg>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=pathlib.Path, default=DEFAULT_SOURCE)
    args = ap.parse_args()

    if not args.source.is_dir():
        print(f"design workspace not found: {args.source}", file=sys.stderr)
        return 1

    root = pathlib.Path(__file__).resolve().parent.parent
    site = root / "site"
    assets = site / "assets"
    (assets / "stock").mkdir(parents=True, exist_ok=True)

    # Assets, minus the copyrighted cover.
    for src in sorted((args.source / "assets").rglob("*")):
        if src.is_dir() or src.name == "album.jpg":
            continue
        dst = assets / src.relative_to(args.source / "assets")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    (assets / "album.svg").write_text(PLACEHOLDER_COVER)

    # The landing page and its favicon want the animated mark.
    shutil.copy2(root / ".github" / "assets" / "mark-dark.svg", assets / "mark.svg")

    for src_name, out_name in PAGES.items():
        src = args.source / src_name
        if not src.exists():
            print(f"missing page, skipped: {src_name}", file=sys.stderr)
            continue
        html = src.read_text(encoding="utf-8")
        # Every reference, however it is spelled: src="assets/album.jpg",
        # url('assets/album.jpg'), and the bare path inside JS templates.
        html = html.replace("assets/album.jpg", "assets/album.svg")
        # The sibling pages are published under different names.
        for other_src, other_out in PAGES.items():
            if other_src != other_out:
                html = re.sub(rf'(href=")({re.escape(other_src)})(")',
                              rf"\g<1>{other_out}\g<3>", html)
        (site / out_name).write_text(html, encoding="utf-8")
        print(f"{src_name:<14} -> site/{out_name}  {len(html):>7} bytes")

    for name in SIDECARS:
        src = args.source / name
        if not src.exists():
            print(f"missing sidecar: {name}", file=sys.stderr)
            return 1
        text = src.read_text(encoding="utf-8").replace("assets/album.jpg", "assets/album.svg")
        (site / name).write_text(text, encoding="utf-8")
        print(f"{name:<14} -> site/{name}  {len(text):>7} bytes")

    leftover = [p for p in site.rglob("*.html")
                if p.name not in set(PAGES.values()) | {"index.html"}]
    for p in leftover:
        print(f"note: site/{p.relative_to(site)} is not produced by this script",
              file=sys.stderr)

    if (assets / "album.jpg").exists():
        print("album.jpg reached site/ — refusing", file=sys.stderr)
        return 1
    print(f"assets: {sum(1 for _ in assets.rglob('*') if _.is_file())} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
