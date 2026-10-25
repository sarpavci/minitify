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
SKIP = ("http://", "https://", "#", "mailto:")


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    broken = []
    checked = 0

    for md in sorted(root.rglob("*.md")):
        # Relative to the repo root, never the absolute path: a git worktree
        # lives under .claude/, which would otherwise skip every file.
        rel = md.relative_to(root)
        if any(part in {".git", "node_modules", ".claude"} for part in rel.parts):
            continue
        for match in LINK.finditer(md.read_text(encoding="utf-8")):
            target = match.group(1)
            if target.startswith(SKIP):
                continue
            path = target.split("#", 1)[0]
            if not path:
                continue
            checked += 1
            if not (md.parent / path).resolve().exists():
                broken.append(f"{md.relative_to(root)} -> {target}")

    for line in broken:
        print(f"broken link: {line}", file=sys.stderr)
    print(f"{checked} relative links checked, {len(broken)} broken")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
