#!/usr/bin/env python3
"""Public-output validator ( TownHearts public-3 ).

Schema + semantic validation for the four sanitized public graph files —
the second guard of the publication pipeline (after the private build's
own consistency check, before/within publication):

    python3 scripts/validate_public_output.py [--dir DIR] [--schema PATH]

Validates graph.json + graph_24h/7d/30d.json (default dir:
$TOWNHEARTS_PUBLIC_DIR, else /home/openpi/townhearts-public/data) against

  - the public-3 JSON Schema (default: data/graph.schema.json), and
  - the semantic rules JSON Schema cannot express: the four files describe
    the SAME pass (generated_at / sampled_at / collection_status / epoch /
    epoch_started_at / scoring_version), each window names its own span
    (meta.socialites_window), graph.json stays the 30d-based default view
    (and shares the 7d30d roll — the Socialites rules are unchanged),
    every edge's tier follows warmth under the unchanged co-presence-2
    floors, first/last_seen_date are plain YYYY-MM-DD, the aggregate
    context carries only counts/booleans/sums, and index / index_names
    resolve to the published edges (Find-a-Muse stays whole).

Fail-closed: a validator that cannot run (missing files, jsonschema
absent) is a violation, never a silent pass. Exit 0 = green; 1 =
violations; 2 = cannot run. Importable: validate_dir(dir, schema) ->
list[str] of violations (empty == green).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "reference"))

# Phase B of the hybrid migration: this PUBLIC repo carries no collector —
# the tier/contract constants are re-pointed to the standalone public copy
# (reference/scoring_reference.py), which must stay in lockstep with the
# published data and zone_rules.js (test_tracker.py enforces that).
from scoring_reference import tier_of  # noqa: E402

PUBLIC_DIR_FALLBACK = "/home/openpi/townhearts-public/data"
DEFAULT_SCHEMA = os.path.join(REPO, "data", "graph.schema.json")

PUB_FILES = ("graph.json", "graph_24h.json", "graph_7d.json", "graph_30d.json")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def load_json(path: str):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def semantic_checks(pub: dict[str, dict]) -> list[str]:
    """Cross-file and per-edge semantic rules for a public-3 emit set."""
    problems: list[str] = []
    base = pub.get("graph.json")
    if base is None:
        return ["graph.json missing — no base document to check against"]
    base_meta = base.get("meta", {})
    for fname, doc in pub.items():
        m = doc.get("meta", {})
        for k in ("generated_at", "sampled_at", "collection_status",
                  "epoch", "epoch_started_at", "scoring_version"):
            if m.get(k) != base_meta.get(k):
                problems.append(f"{fname}: meta.{k} differs from graph.json")
        if fname != "graph.json":
            label = fname[len("graph_"):-len(".json")]
            if m.get("socialites_window") != label:
                problems.append(
                    f"{fname}: meta.socialites_window must be {label!r}, "
                    f"got {m.get('socialites_window')!r}")
            if label == "30d" and m.get("socialites") != base_meta.get("socialites"):
                problems.append(
                    "graph_30d.json: socialites roll differs from graph.json "
                    "(the default view must stay 30d-based)")
        # per-edge aggregates + index integrity
        by_pair: dict[str, dict] = {}
        for e in doc.get("edges", []):
            k = e.get("pair")
            if not isinstance(k, str) or k in by_pair:
                problems.append(f"{fname}: duplicate/invalid pair key: {k!r}")
                continue
            by_pair[k] = e
            if e.get("co_loc_weight") != e.get("warmth"):
                problems.append(f"{fname}: {k}: co_loc_weight != warmth")
            if not (isinstance(e.get("warmth"), (int, float))
                    and not isinstance(e.get("warmth"), bool)
                    and e.get("warmth", 0) > 0):
                problems.append(f"{fname}: {k}: warmth must be a number > 0")
            if e.get("tier") != tier_of(e.get("warmth", -1)):
                problems.append(f"{fname}: {k}: tier does not follow warmth")
            for dk in ("first_seen_date", "last_seen_date"):
                if not DATE_RE.match(str(e.get(dk, ""))):
                    problems.append(f"{fname}: {k}: {dk} must be YYYY-MM-DD")
            ctx = e.get("context", {})
            for dk in ("directed_count", "flow_count", "mb_flow_total"):
                v = ctx.get(dk)
                if not isinstance(v, (int, float)) or isinstance(v, bool) or v < 0:
                    problems.append(f"{fname}: {k}: context.{dk} must be a number >= 0")
            if not isinstance(ctx.get("reciprocal_directed"), bool):
                problems.append(f"{fname}: {k}: context.reciprocal_directed must be bool")
        index = doc.get("index", {})
        index_names = doc.get("index_names", {})
        if set(index) != set(by_pair):
            problems.append(f"{fname}: index keys != the published edge pairs")
        for key, v in index.items():
            if by_pair.get(key) != v:
                problems.append(f"{fname}: index[{key!r}] does not equal its edge")
        for key, v in index_names.items():
            at = f"{fname}: index_names[{key!r}]"
            parts = str(key).split("|")
            if len(parts) != 2 or any(part == "" for part in parts) or \
                    any("|" in part for part in parts):
                problems.append(f"{at}: malformed key")
                continue
            if not isinstance(v, dict) or by_pair.get(v.get("pair")) != v:
                problems.append(f"{at}: does not resolve to a published edge")
    return problems


def validate_dir(pub_dir: str, schema_path: str | None = None) -> list[str]:
    """Schema-validate + semantically validate the published graph set in
    pub_dir. Returns violations (empty == green); missing/unreadable
    artifacts are violations — fail-closed."""
    problems: list[str] = []
    schema_path = schema_path or DEFAULT_SCHEMA
    schema = None
    try:
        import jsonschema  # noqa: F401
    except ImportError:
        problems.append("jsonschema not installed — refusing to validate blind "
                        "(pip install jsonschema)")
    else:
        try:
            schema = load_json(schema_path)
        except Exception as exc:
            problems.append(f"public schema unreadable ({schema_path}): {exc}")
    if schema is not None:
        for fname in PUB_FILES:
            p = os.path.join(pub_dir, fname)
            if not os.path.isfile(p):
                problems.append(f"published file missing: {fname}")
                continue
            try:
                doc = load_json(p)
            except Exception as exc:
                problems.append(f"{fname}: unreadable JSON: {exc}")
                continue
            try:
                jsonschema.validate(doc, schema)  # noqa: F821
            except Exception as exc:  # jsonschema.ValidationError
                problems.append(f"{fname}: fails the public-3 schema: "
                                f"{str(exc)[:200]}")
    pub: dict[str, dict] = {}
    for fname in PUB_FILES:
        p = os.path.join(pub_dir, fname)
        if os.path.isfile(p):
            try:
                pub[fname] = load_json(p)
            except Exception:
                pass  # schema/parse problems already recorded above
    problems.extend(semantic_checks(pub))
    return problems


def main() -> int:
    ap = argparse.ArgumentParser(description="validate the public-3 emit set")
    ap.add_argument("--dir", default=None,
                    help=f"default: $TOWNHEARTS_PUBLIC_DIR, else "
                         f"{PUBLIC_DIR_FALLBACK!r}")
    ap.add_argument("--schema", default=None,
                    help=f"public-3 schema (default: {DEFAULT_SCHEMA!r})")
    args = ap.parse_args()
    pub_dir = args.dir or os.environ.get("TOWNHEARTS_PUBLIC_DIR") or PUBLIC_DIR_FALLBACK
    problems = validate_dir(pub_dir, args.schema)
    if problems:
        print(f"PUBLIC OUTPUT INVALID ({len(problems)} violation(s)) in {pub_dir}:")
        for p in problems:
            print("  -", p)
        return 1
    print(f"public-3 ok: {pub_dir} (schema + semantics green)")
    return 0


if __name__ == "__main__":
    sys.exit(main())