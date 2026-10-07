#!/usr/bin/env python3
"""Strict file allowlist for the TownHearts PUBLIC repo tree.

This repo is exactly what phase C publishes to github.com/dustytext-bot/
townhearts (site + docs + the published data + the reference scorer +
validators + tests). The publication safeguards require a strict FILE
allowlist — not a denylist — so anything new (a db artifact, a private
runtime path, scratch output) must fail CI until it is deliberately
allowlisted here.

Checked:
  - every directory against its explicit relative-path allowlist
    (fail-closed: unknown file OR unknown directory = violation);
  - no SQLite/database artifacts anywhere (names AND magic bytes);
  - no private runtime names (townhearts.db, opt_out.txt, new_read.json,
    graph_private*, schema.sql) anywhere in the tree;
  - no private filesystem PATH strings in any published text file ("/var/lib/
    townhearts" etc.) — the private runtime layout must not leak in docs
    either. The two GUARD scripts are exempt: their scan patterns must
    contain the needles to work at all.
  - generated artifacts (__pycache__/ *.pyc) are ignored here and kept out
    of git by .gitignore.

Run: python3 scripts/check_repo.py [--root DIR]
Exit 0 = tree clean; 1 = violations. Importable: check_tree(root).
"""

from __future__ import annotations

import argparse
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DIR_ALLOWLIST: dict[str, tuple[str, ...]] = {
    "": ("404.html", "API.md", "AUDIT.md", "CHANGELOG.md", "LICENSE",
         "LICENSE-DATA", "PRIVACY.md", "README.md", "index.html",
         "logo.jpg", "logo.png", "muse.txt", "test_tracker.py",
         "zone_rules.js", ".gitignore"),
    ".github": ("workflows/ci.yml",),
    "data": ("graph.json", "graph_24h.json", "graph_7d.json", "graph_30d.json",
             "graph.schema.json"),
    "reference": ("scoring_reference.py",),
    "scripts": ("check_repo.py", "scan_public_output.py",
                "validate_public_output.py"),
    "test_assets": ("deep_link_check.js", "find_form_check.js",
                    "render_check.js", "scoring_equiv_check.js",
                    "showcase_check.js", "window_check.js", "zone_check.js",
                    "xss_fixture.json"),
}

GENERATED = {"__pycache__", ".pytest_cache"}   # working-tree artifacts, never git
TEXT_EXTS = (".md", ".py", ".js", ".html", ".yml", ".txt", ".json")

# names/patterns that must NEVER exist anywhere in the tree
FORBIDDEN_NAME_PARTS = ("townhearts.db", "schema.sql", "opt_out",
                        "new_read", "graph_private", ".sqlite", ".db")

# private runtime layout strings that must not appear in ANY text file the
# public repo publishes (docs/site/data/tests). The two GUARD scripts are
# exempt: their scan patterns must contain the needles to work at all
# (scan_public_output.py checks the data FOR the string "/var/lib/townhearts").
GUARD_EXEMPT = ("scripts/scan_public_output.py", "scripts/check_repo.py")
FORBIDDEN_TEXT = ("/var/lib/townhearts", "/home/pi/townhearts",
                  "/.config/townhearts", "/.townhearts-backup.key")


def check_tree(root: str = REPO) -> list[str]:
    problems: list[str] = []
    for top in DIR_ALLOWLIST:
        p = os.path.join(root, top) if top else root
        if not os.path.isdir(p):
            problems.append(f"allowlisted directory missing: {top!r}")
            continue
        problems.extend(_walk_dir(root, top))
    return problems


def _walk_dir(root: str, top: str) -> list[str]:
    """Walk one allowlisted top-level directory against its RELATIVE-path
    allowlist (e.g. '.github' allows exactly 'workflows/ci.yml'). The root
    allowlist (top == "") is FLAT: files only; its subdirectories either
    carry their own allowlist entries (walked separately) or are violations,
    and '.git' is always skipped."""
    problems: list[str] = []
    allowed = set(DIR_ALLOWLIST[top])
    base = os.path.join(root, top) if top else root
    seen: set[str] = set()

    if not top:
        for entry in sorted(os.listdir(base)):
            if entry == ".git" or entry in GENERATED:
                continue
            p = os.path.join(base, entry)
            if os.path.isdir(p):
                if entry not in DIR_ALLOWLIST:
                    problems.append(f"unexpected directory in the repo tree: {entry!r}")
                continue
            seen.add(entry)
            if entry.endswith(".pyc"):
                continue
            if entry not in allowed:
                problems.append(f"file outside the repo allowlist: {entry!r}")
            if any(part in entry for part in FORBIDDEN_NAME_PARTS):
                problems.append(f"forbidden artifact name in the repo tree: {entry!r}")
        for name in sorted(allowed):
            if name not in seen and not os.path.isfile(os.path.join(base, name)):
                problems.append(f"allowlisted file missing: {name!r}")
        return problems

    allowed_dirs = {os.path.dirname(r) for r in allowed} - {""}
    for dirpath, dirnames, filenames in os.walk(base):
        cur = os.path.relpath(dirpath, base)
        keep = []
        for d in sorted(dirnames):
            if d in GENERATED:
                continue
            rel = d if cur == "." else os.path.join(cur, d)
            if rel in allowed_dirs or any(r.startswith(rel + os.sep) for r in allowed):
                keep.append(d)           # an allowlisted path runs through here
            else:
                problems.append(f"unexpected directory inside {top!r}: {rel!r}")
        dirnames[:] = keep
        for name in sorted(filenames):
            if name.endswith(".pyc"):
                continue
            rel = name if cur == "." else os.path.join(cur, name)
            seen.add(rel)
            if rel not in allowed:
                problems.append(f"file outside the {top!r} allowlist: {rel!r}")
            if any(part in name for part in FORBIDDEN_NAME_PARTS):
                problems.append(f"forbidden artifact name in the repo tree: {rel!r}")
    for name in sorted(allowed):
        if name not in seen and not os.path.isfile(os.path.join(base, name)):
            problems.append(f"allowlisted file missing: {os.path.join(top, name)!r}")
    return problems


def _magic_and_text_scan(root: str) -> list[str]:
    """SQLite magic anywhere (a db is never a repo artifact) + the private
    runtime path strings in any text file (guard scripts exempt)."""
    problems: list[str] = []
    SQLITE_MAGIC = b"SQLite format 3\x00"
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in GENERATED and d != ".git"]
        for name in sorted(filenames):
            if name.endswith(".pyc"):
                continue
            p = os.path.join(dirpath, name)
            rel = os.path.relpath(p, root)
            if any(part in name for part in FORBIDDEN_NAME_PARTS):
                problems.append(f"forbidden artifact name in the repo tree: {rel!r}")
                continue
            try:
                with open(p, "rb") as fh:
                    blob = fh.read()
            except OSError as exc:
                problems.append(f"{rel}: unreadable: {exc}")
                continue
            if SQLITE_MAGIC in blob:
                problems.append(f"{rel}: contains SQLite magic bytes")
            if name.endswith(TEXT_EXTS) and rel not in GUARD_EXEMPT:
                try:
                    text = blob.decode("utf-8")
                except UnicodeDecodeError:
                    problems.append(f"{rel}: text file is not valid UTF-8")
                    continue
                for needle in FORBIDDEN_TEXT:
                    if needle in text:
                        problems.append(
                            f"{rel}: leaks the private runtime path {needle!r}")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description="strict file allowlist check "
                                             "(TownHearts public repo)")
    ap.add_argument("--root", default=REPO)
    args = ap.parse_args()
    problems = check_tree(args.root) + _magic_and_text_scan(args.root)
    if problems:
        print(f"REPO TREE VIOLATIONS ({len(problems)}):")
        for p in problems:
            print("  -", p)
        return 1
    print(f"repo allowlist ok: {args.root} "
          "(explicit file allowlists + no db artifacts + no private paths)")
    return 0


if __name__ == "__main__":
    sys.exit(main())