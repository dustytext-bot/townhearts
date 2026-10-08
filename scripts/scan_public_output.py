#!/usr/bin/env python3
"""Privacy scan + published-file allowlist guard ( TownHearts public-3 ).

The fail-closed guard for anything that leaves the private boundary:

    python3 scripts/scan_public_output.py [--dir DIR]

Checks EVERY file in the published data directory (default
$TOWNHEARTS_PUBLIC_DIR, else the repo's own data/ directory):

  - allowlist: the directory may contain exactly the published set —
    graph.json, graph_24h.json, graph_7d.json, graph_30d.json and, when the
    public schema ships beside the data, graph.schema.json. ANY other file
    (hidden, scratch, backup, db copy) is a violation; subdirectories too.
  - required: the four graph files exist.
  - no SQLite magic bytes ("SQLite format 3" + NUL) anywhere in any file —
    a database is never a published artifact.
  - the JSON files carry no forbidden keys, checked recursively:
    flows / directed / preview / reason / amount / samples / pair_obs /
    edges_log / at / ts / first_seen / last_seen / first_obs_ts /
    places_present (exact key matches; first_seen_date / last_seen_date and
    the other allowed *_date keys pass).
  - no private filesystem paths in any file's bytes (the private runtime
    root, the runtime home dir, the private db name).

Exit 0 = clean; 1 = violations; 2 = cannot run.
Importable: scan_dir(path) -> list[str] of violations (empty == clean).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

PUBLIC_DIR_FALLBACK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

ALLOWLIST = ("graph.json", "graph_24h.json", "graph_7d.json", "graph_30d.json",
             "graph.schema.json")
REQUIRED = ("graph.json", "graph_24h.json", "graph_7d.json", "graph_30d.json")

SQLITE_MAGIC = b"SQLite format 3\x00"

# Exact-match forbidden JSON keys (recursive). Event-ledger arrays, per-event
# fields (previews / reasons / amounts / exact event timestamps), raw layers,
# and the removed current-locations map must never appear under any name.
FORBIDDEN_KEYS = (
    "flows", "directed", "preview", "reason", "amount", "samples",
    "pair_obs", "edges_log", "at", "ts", "first_seen", "last_seen",
    "first_obs_ts", "places_present",
)

# Byte-level forbidden strings (private filesystem layout must never leak).
FORBIDDEN_SUBSTRINGS = ("/var/lib/townhearts", "/home/openpi", "townhearts.db")


def _walk_keys(obj, path: str = "$"):
    """Yield (key, json-path) for every dict key, recursively through
    dicts and lists."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(k, str) and k in FORBIDDEN_KEYS:
                yield k, f"{path}.{k}"
            yield from _walk_keys(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk_keys(v, f"{path}[{i}]")


def scan_dir(pub_dir: str) -> list[str]:
    """Scan a directory against the public-3 guards. Returns the violation
    list (empty == clean); never raises (unexpected shapes are violations)."""
    problems: list[str] = []
    if not os.path.isdir(pub_dir):
        return [f"published dir missing/not a directory: {pub_dir!r}"]
    entries = sorted(os.listdir(pub_dir))
    for name in entries:
        if name not in ALLOWLIST:
            problems.append(f"file outside the published allowlist: {name!r}")
    for name in REQUIRED:
        if not os.path.isfile(os.path.join(pub_dir, name)):
            problems.append(f"required published file missing: {name}")
    for name in entries:
        p = os.path.join(pub_dir, name)
        if not os.path.isfile(p):
            problems.append(f"unexpected directory inside the published set: {name!r}")
            continue
        try:
            with open(p, "rb") as fh:
                data = fh.read()
        except OSError as exc:
            problems.append(f"{name}: unreadable: {exc}")
            continue
        if SQLITE_MAGIC in data:
            problems.append(
                f"{name}: contains SQLite magic bytes — a database is never "
                "a published artifact")
        for needle in FORBIDDEN_SUBSTRINGS:
            if needle.encode("utf-8") in data:
                problems.append(
                    f"{name}: contains the private path string {needle!r}")
        if name.endswith(".json"):
            try:
                doc = json.loads(data.decode("utf-8"))
            except Exception as exc:
                problems.append(f"{name}: unparseable JSON: {exc}")
                continue
            for key, at in _walk_keys(doc):
                problems.append(f"{name}: forbidden key {at} ({key!r})")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(
        description="privacy scan + published-file allowlist guard (public-3)")
    ap.add_argument("--dir", default=None,
                    help=f"default: $TOWNHEARTS_PUBLIC_DIR, else "
                         f"{PUBLIC_DIR_FALLBACK!r}")
    args = ap.parse_args()
    pub_dir = args.dir or os.environ.get("TOWNHEARTS_PUBLIC_DIR") or PUBLIC_DIR_FALLBACK
    problems = scan_dir(pub_dir)
    if problems:
        print(f"PUBLIC OUTPUT VIOLATIONS ({len(problems)}) in {pub_dir}:")
        for p in problems:
            print("  -", p)
        return 1
    print(f"privacy scan ok: {pub_dir} (allowlist + magic + forbidden keys clean)")
    return 0


if __name__ == "__main__":
    sys.exit(main())