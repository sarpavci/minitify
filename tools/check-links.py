#!/usr/bin/env python3
"""Fails if a relative link in the Markdown points at something missing.

External URLs are left alone on purpose: a link checker that reaches the
network turns an unrelated outage into a red build.

    python3 tools/check-links.py
"""
import pathlib
import re
import sys

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)")
# src=, href= and srcset= in HTML too. The first version of build-site.py
# published a page whose styles.css and app.js were not copied with it;
# checking only Markdown let that through.
ATTR = re.compile(r'(?:src|href|srcset)="([^"]+)"')
SKIP = ("http://", "https://", "//", "#", "mailto:", "data:")


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    broken = []
    checked = 0

    files = sorted(root.rglob("*.md")) + sorted(root.rglob("*.html"))
    for doc in files:
        # Relative to the repo root, never the absolute path: a git worktree
        # lives under .claude/, which would otherwise skip every file.
        rel = doc.relative_to(root)
        if any(part in {".git", "node_modules", ".claude"} for part in rel.parts):
            continue
        text = doc.read_text(encoding="utf-8")
        # Markdown gets both: these files embed raw <picture> and <img> for
        # the light/dark mark, which the bracket syntax cannot express.
        patterns = (LINK, ATTR) if doc.suffix == ".md" else (ATTR,)
        for match in (m for p in patterns for m in p.finditer(text)):
            target = match.group(1).strip()
            if target.startswith(SKIP) or not target:
                continue
            path = target.split("#", 1)[0].split("?", 1)[0]
            if not path:
                continue
            checked += 1
            if not (doc.parent / path).resolve().exists():
                broken.append(f"{rel} -> {target}")

    for line in broken:
        print(f"broken link: {line}", file=sys.stderr)
    print(f"{checked} relative links checked, {len(broken)} broken")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
