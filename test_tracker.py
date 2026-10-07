"""TownHearts PUBLIC repo contract tests (pytest).

This repo is the clean PUBLIC tree produced by phase B of the hybrid
migration: the public-3 published sample, the human site, the standalone
scoring reference, the publication guards, docs, and the (DRAFT) licenses.
The production collector/db/raw layer is proprietary and lives OUTSIDE every
git repository — nothing here reads it.

Covers:
  - the public-3 contract: schema_version in data/graph.schema.json + every
    published file's meta, publisher_version pub-1.1, aggregate-only
    context, plain YYYY-MM-DD first/last seen dates, the epoch-3 campfire
    fields (epoch >= 3, data_coverage_started_at = the epoch_started_at
    alias, scoring_epoch_introduced_at, meta.reach Town Reach),
    purposeful-only edges (warmth > 0);
  - absence of private/event data anywhere in data/ — enforced by RUNNING
    the repo's own guards: scripts/validate_public_output.py (schema +
    semantics) and scripts/scan_public_output.py (allowlist + SQLite magic +
    forbidden keys + private paths);
  - the strict repo file allowlist (scripts/check_repo.py): the tree is
    exactly the publishable set — no db, no private paths, no strays;
  - the reference scorer: co-presence-3 anchors (n=2/n=3/n=27 + the epoch-3
    campfire rule), tier floors 2/6/14/30, the Socialites rule, the shared
    display formatter — and its LOCKSTEP with zone_rules.js (displayWarmth equivalence over the real
    published warmths via node, bar scale == the bond floor) and with the
    published data (every edge's tier == tier_of(warmth));
  - the site: evidence panel = AGGREGATE summaries only (copy shape pinned),
    no code path may read/render event arrays/previews/reasons/amounts/
    exact timestamps (source pins + node harnesses), the stale/freshness
    logic still keys off meta.sampled_at, the partial notice stays
    owner-suppressed, the showcase structure/tiers/animation are unchanged;
  - the node harness suite (render/zone/showcase/window/deep-link/find-form,
    exactly the commands CI runs);
  - the docs: muse.txt/API.md/README/PRIVACY/CHANGELOG/LICENSE for the
    public-3 contract (no SQL/db recipes; DRAFT license markers present).

Run: python3 -m pytest test_tracker.py -v
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys

import pytest

REPO = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(REPO, "scripts"))
sys.path.insert(0, os.path.join(REPO, "reference"))

import scan_public_output as SCAN  # noqa: E402
import validate_public_output as VAL  # noqa: E402
import scoring_reference as REF  # noqa: E402

DATA = os.path.join(REPO, "data")
FILES = ("graph.json", "graph_24h.json", "graph_7d.json", "graph_30d.json")
CONTEXT_KEYS = {"directed_count", "reciprocal_directed", "flow_count",
                "mb_flow_total"}
EDGE_KEYS = {
    "pair", "a", "b", "a_name", "b_name", "warmth", "tier", "co_loc_weight",
    "co_locations", "co_locations", "growth_7d", "growth_30d", "shared_days",
    "recent_shared_samples_30d", "largest_shared_group", "first_seen_date",
    "last_seen_date", "common_places", "context",
}


def _load(fname: str) -> dict:
    with open(os.path.join(DATA, fname), encoding="utf-8") as fh:
        return json.load(fh)


def _node(args: list[str]) -> subprocess.CompletedProcess:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not available")
    return subprocess.run([node, *args], capture_output=True, text=True,
                          timeout=180)


# ---------------------------------------------------------------- public-3 contract

def test_schema_file_is_public3():
    with open(os.path.join(DATA, "graph.schema.json"), encoding="utf-8") as fh:
        schema = json.load(fh)
    assert "public-3" in schema.get("title", "")
    props = schema["properties"]["meta"]["properties"]
    assert props["schema_version"]["const"] == "public-3"
    assert props["publisher_version"]["const"] == "pub-1.1"
    assert props["scoring_version"]["const"] == "co-presence-3"
    meta_req = schema["properties"]["meta"]["required"]
    for k in ("data_coverage_started_at", "scoring_epoch_introduced_at", "reach"):
        assert k in meta_req, k                       # the epoch-3 fields ship


def test_every_published_file_is_public3():
    for fname in FILES:
        doc = _load(fname)
        m = doc["meta"]
        assert m["schema_version"] == "public-3", fname
        assert m["publisher_version"] == "pub-1.1", fname
        assert "collector_version" not in m            # dropped by construction
        assert "places_present" not in doc             # dropped current-locations map
        assert "flows" not in doc and "directed" not in doc   # raw event arrays never published
        for e in doc["edges"]:
            assert set(e) <= EDGE_KEYS, (fname, sorted(set(e) - EDGE_KEYS))
            for banned in ("first_seen", "last_seen", "first_obs_ts",
                           "preview", "reason", "amount", "at", "ts"):
                assert banned not in e, (fname, banned)
            ctx = e.get("context") or {}
            assert set(ctx) == CONTEXT_KEYS, (fname, sorted(ctx))
            assert set(ctx) - CONTEXT_KEYS == set()
            for k in ("flows", "directed"):
                assert k not in ctx                    # event arrays never published


def test_dates_are_date_level():
    for fname in FILES:
        for e in _load(fname)["edges"]:
            for k in ("first_seen_date", "last_seen_date"):
                v = e[k]
                assert len(v) == 10 and v[4] == "-" and v[7] == "-", (fname, k, v)


def test_meta_sampled_at_is_exact_and_shared():
    """The stale/freshness banner still keys off meta.sampled_at (kept EXACT)
    — the four files describe one pass share it."""
    base = _load("graph.json")["meta"]["sampled_at"]
    assert base
    for fname in FILES:
        assert _load(fname)["meta"]["sampled_at"] == base, fname


def test_30d_roll_is_the_default_views_roll():
    base = _load("graph.json")["meta"]
    assert base["socialites_window"] == "30d"
    assert base["socialites"] == _load("graph_30d.json")["meta"]["socialites"]


# ------------------------------------------------ guards (validator + scan)

def test_validator_green_on_published_data():
    pytest.importorskip("jsonschema")
    problems = VAL.validate_dir(DATA)
    assert problems == [], problems


def test_scan_green_on_published_data():
    assert SCAN.scan_dir(DATA) == []


def test_repo_tree_allowlist_green():
    from check_repo import check_tree
    assert check_tree(REPO) == []


def test_repo_tree_has_no_db_or_private_artifacts():
    hits = []
    for dirpath, dirnames, filenames in os.walk(REPO):
        dirnames[:] = [d for d in dirnames if d not in (".git", "__pycache__")]
        for n in filenames:
            if n.endswith((".db", ".sqlite", ".sqlite3")) or \
                    "townhearts.db" in n or "opt_out" in n or \
                    "new_read" in n or "graph_private" in n or n == "schema.sql":
                hits.append(n)
    assert hits == [], hits


# --------------------------------------------------------- reference scorer

def test_reference_row_weight_anchors():
    assert REF.row_weight(2) == 2.0             # n=2: the co-presence-1 units
    assert REF.row_weight(3) == 1.0             # n=3: one per instant
    assert abs(REF.row_weight(27) - 2 / 26) < 1e-15   # n=27: the crowd dilutes
    for bad in (1, 0, -5, "x", 2.0):
        with pytest.raises(ValueError):
            REF.row_weight(bad)                 # (2.0: not an int — rejected)


def test_reference_tier_floors():
    assert REF.tier_of(0) is None
    assert REF.tier_of(1.0) is None
    assert REF.tier_of(2 / 26) is None
    assert REF.tier_of(2) == "acquaintance"
    assert REF.tier_of(6) == "friendly"
    assert REF.tier_of(14) == "companion"
    assert REF.tier_of(30) == "bond"
    with pytest.raises(ValueError):
        REF.tier_of(-4)


def test_reference_worked_example_n2_n3_n27():
    """The worked synthetic example from the reference module itself: a pair
    with 3 shared 2-muse rows plus one trio row plus a big-crowd row (a
    PLAZA — the campfire has its own epoch-3 rule) — warmth = 3×2 + 2×1 +
    2/26, tiered per the unchanged floors."""
    w = REF.warmth_from_group_sizes([2, 2, 2, 3, 27])
    assert w == 6 + 1 + 2 / 26            # 3 two-muse rows + one trio + the crowd
    assert REF.tier_of(w) == "friendly"
    # dilution, not erasure: a pair seen ONLY in 27-crowds grows slowly —
    # 100 such observations still only reach "friendly" (bond would need ~391)
    w100 = REF.warmth_from_group_sizes([27] * 100)
    assert abs(w100 - 200 / 26) < 1e-12
    assert REF.tier_of(w100) == "friendly"
    # epoch 3: the campfire is passive-ambient — ambience weighs 0, an
    # ADDRESSED campfire row weighs the full 2 regardless of the crowd
    assert REF.epoch3_row_weight("Campfire", 27, False) == 0.0
    assert REF.epoch3_row_weight("Campfire", 27, True) == 2.0
    assert REF.epoch3_row_weight("Plaza", 27, False) == 2 / 26    # non-passive: unchanged


def test_reference_place_classification():
    """The public mirror of the deterministic place classifier: verified
    aliases verbatim, case-insensitive exact matching, config-driven (
    version bumped, categories may grow); and the LOCKSTEP with the data:
    the published meta.scoring.place_classification must carry the same
    passive-ambient aliases verbatim."""
    assert REF.PLACE_CLASSIFICATION_VERSION >= 1
    assert REF.PASSIVE_PLACE_CATEGORY == "passive-ambient"
    assert list(REF.PASSIVE_PLACE_ALIASES) == ["campfire", "Campfire"]
    for p in ("campfire", "Campfire", "  CAMPFIRE "):
        assert REF.is_passive_place(p), p
    for p in ("Campfire Pit", "fireside", "Docks", "Plaza"):
        assert not REF.is_passive_place(p), p
    assert "passive-ambient" in REF.PASSIVE_PLACE_RULE
    assert "at most one sample" in REF.PASSIVE_PLACE_RULE
    for fname in FILES:
        pc = _load(fname)["meta"]["scoring"]["place_classification"]
        pa = [c for c in pc["categories"] if c["category"] == "passive-ambient"]
        assert len(pa) == 1, fname
        assert list(pa[0]["place_aliases"]) == list(REF.PASSIVE_PLACE_ALIASES), fname
        assert isinstance(pc["version"], int) and pc["version"] >= 1
        assert "place_rules" in pc["matching"] or "config" in pc["matching"].lower()


def test_epoch3_fields_published():
    """pub-1.1: epoch >= 3 with the bookkeeping fields in all four files —
    data_coverage_started_at == epoch_started_at (the legacy alias),
    scoring_epoch_introduced_at a valid UTC stamp."""
    ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$")
    started = None
    for fname in FILES:
        m = _load(fname)["meta"]
        assert isinstance(m["epoch"], int) and m["epoch"] >= 3, fname
        if started is None:
            started = m["data_coverage_started_at"]
        assert m["data_coverage_started_at"] == started, fname
        assert m["data_coverage_started_at"] == m["epoch_started_at"], fname
        assert ISO.match(m["scoring_epoch_introduced_at"]), fname


def test_reference_display_matches_zone_rules_case_table():
    cases = [(4.060606061, "4.06"), (4.5, "4.5"), (4.0, "4"), (2, "2"),
             (30, "30"), (6, "6"), (0, "0"), (0.076923077, "0.08"),
             (0.009, "<0.01"), (0.01, "0.01"), (100.1, "100.1"), (-3, "-3"),
             (float("nan"), "\u2014"), (float("inf"), "\u2014"),
             (None, "\u2014")]
    for value, want in cases:
        assert REF.display_warmth(value) == want, value


def test_reference_socialites_rule():
    ok, _ = REF.socialite_qualifies(6, 3, 3, 0.25)
    assert ok
    assert not REF.socialite_qualifies(5, 3, 3, 0.25)[0]     # 5 unique < 6
    assert not REF.socialite_qualifies(6, 2, 3, 0.25)[0]     # 2 days < 3
    assert not REF.socialite_qualifies(6, 3, 2, 0.25)[0]     # 2 places < 3
    assert not REF.socialite_qualifies(6, 3, 3, 0.5)[0]      # dominance 50% > 40%
    assert REF.socialite_qualifies(7, 3, 3, 4 / 11)[0]        # exactly 40%: in
    assert REF.socialite_qualifies(6, 1, 3, 0.25, require_days=False)[0]  # 24h: days omitted
    assert not REF.socialite_qualifies(6, 1, 3, 0.5, require_days=False)[0]


def test_reference_tier_matches_every_published_edge():
    """The DATA half of the lockstep: every published edge's tier follows
    warmth under the public floors (the site renders edge.tier directly)."""
    for fname in FILES:
        for e in _load(fname)["edges"]:
            assert e["tier"] == REF.tier_of(e["warmth"]), (fname, e["pair"])


def test_reference_warmth_display_matches_zone_rules_via_node():
    """The JS half of the lockstep: zone_rules.displayWarmth (what the site
    prints) must equal scoring_reference.display_warmth on a fixed probe set
    AND on every unique published warmth; zone_rules' power-up bar must
    saturate exactly at the bond floor (the 30 constant stays in lockstep)."""
    r = _node([os.path.join(REPO, "test_assets", "scoring_equiv_check.js"),
               os.path.join(DATA, "graph.json")])
    assert r.returncode == 0, r.stdout + r.stderr
    out = json.loads(r.stdout)
    assert out["bar_pct_scale"] == REF.TIER_MIN["bond"] == 30
    checked = 0
    for w, shown in out["cases"] + out["fixture_warmths"]:
        assert REF.display_warmth(w) == shown, w
        checked += 1
    # the probe table + the published warmths (epoch 3: purposeful-only
    # edges are fewer and warmer — fewer distinct warmth values, so the
    # floor reflects the leaner published set)
    assert checked >= 30


# ------------------------------------------------------- node harness suite

def test_zone_rules_harness():
    r = _node([os.path.join(REPO, "test_assets", "zone_check.js")])
    assert r.returncode == 0, f"zone check failed:\n{r.stdout}\n{r.stderr}"


def test_render_harness_xss_inert_public3():
    r = _node([os.path.join(REPO, "test_assets", "render_check.js"),
               os.path.join(REPO, "index.html"),
               os.path.join(REPO, "test_assets", "xss_fixture.json")])
    assert r.returncode == 0, f"render check failed:\n{r.stdout}\n{r.stderr}"


def test_showcase_harness():
    r = _node([os.path.join(REPO, "test_assets", "showcase_check.js"),
               os.path.join(REPO, "index.html")])
    assert r.returncode == 0, f"showcase check failed:\n{r.stdout}\n{r.stderr}"


def test_window_switcher_harness():
    r = _node([os.path.join(REPO, "test_assets", "window_check.js"),
               os.path.join(REPO, "index.html")])
    assert r.returncode == 0, f"window check failed:\n{r.stdout}\n{r.stderr}"


def test_deep_link_harness():
    r = _node([os.path.join(REPO, "test_assets", "deep_link_check.js"),
               os.path.join(REPO, "index.html"), os.path.join(REPO, "404.html")])
    assert r.returncode == 0, f"deep-link check failed:\n{r.stdout}\n{r.stderr}"


def test_find_form_repro_harness():
    """The v1.2.7 repro on the shipped sample: 'Snarlinggenie' resolves to
    muse_j03y2bfbin through the form AND the pair lookup AND deep links;
    duplicates answer with the honest count; unknown stays honest."""
    r = _node([os.path.join(REPO, "test_assets", "find_form_check.js"),
               os.path.join(REPO, "index.html")])
    assert r.returncode == 0, f"find-form check failed:\n{r.stdout}\n{r.stderr}"


def test_sample_roster_pins_for_the_harness():
    """The roster conditions find_form_check's derived pins rely on: exactly
    one case-insensitive 'snarlinggenie' (the spec-14500 repro muse), and at
    least one duplicate display name (ambiguous-name honesty)."""
    doc = _load("graph.json")
    hits = [mid for mid, n in doc["muses"].items()
            if isinstance(n, str) and n.lower() == "snarlinggenie"]
    assert hits == ["muse_j03y2bfbin"], hits
    seen: dict[str, int] = {}
    for n in doc["muses"].values():
        if isinstance(n, str) and n:
            seen[n.lower()] = seen.get(n.lower(), 0) + 1
    assert any(v >= 2 for v in seen.values()), "expected duplicate display names"


# --------------------------------------------------------------- site pins

def _html() -> str:
    return open(os.path.join(REPO, "index.html"), encoding="utf-8").read()


def test_evidence_panel_is_aggregate_only():
    html = _html()
    for needle in ('datum("Public directed interaction"',
                   '" directed line" + (dCount === 1 ? "" : "s") + " observed',
                   '"Public Musebuck activity"',
                   '" public flow" + (fCount === 1 ? "" : "s") + " observed',
                   "datum(\"Observation evidence\"",
                   "Most common public locations: ",
                   "Largest shared group: ",
                   '" (warmth " + dispW(e.warmth) + " → " + tierWord(e.tier) + ")"',
                   '"reciprocal" : "not reciprocal"'):
        assert needle in html, needle
    # zero-count aggregate lines omit themselves; per-event rendering is GONE
    assert "speech at " not in html
    assert "MB —" not in html
    assert '.preview' not in html and 'f.reason' not in html and 'd.preview' not in html
    assert "e.context.flows" not in html and "e.context.directed" not in html
    # text nodes only — the XSS-inert rendering contract
    for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML",
                   "document.write", "eval("):
        assert banned not in html, banned


def test_site_renders_dates_date_level():
    """public-3: every renderer takes the published DATES — no code path may
    read an exact first/last seen timestamp (they no longer exist)."""
    html = _html()
    assert html.count("dateText(") >= 7
    assert "first_obs_ts" not in html
    assert "e.first_obs_ts" not in html and "e.last_seen)" not in html \
        and "e.first_seen)" not in html and ".first_seen " not in html
    zr = open(os.path.join(REPO, "zone_rules.js"), encoding="utf-8").read()
    assert "first_obs_ts" not in zr
    # every e.first_seen / e.last_seen read in zone_rules is the DATE field
    assert zr.count("e.first_seen") == zr.count("e.first_seen_date")
    assert zr.count("e.last_seen") == zr.count("e.last_seen_date")
    assert "first_seen_date" in zr and "last_seen_date" in zr


def test_stale_and_freshness_logic_unchanged():
    html = _html()
    assert 'id="stale-banner"' in html
    assert "stale_after_hours" in html
    assert "isStale" in html and "meta.sampled_at" in html
    # the owner-suppressed partial notice mechanism is intact but hidden
    assert "SHOW_PARTIAL_STATUS = false" in html


def test_site_structure_and_identity_preserved():
    """Everything the hybrid plan froze: five-zone structure, HIGHLIGHTS
    showcase tab, socialite stage + animation, tier cards, the audit banner
    at the page bottom, the deep-link bridge, the formula card."""
    html = _html()
    order = [html.index(s) for s in ('id="zone-find"', 'id="zone-focus"',
        'id="zone-socialites"', 'id="zone-growing"', 'id="zone-sparks"',
        'id="zone-bonds"')]
    assert order == sorted(order)
    for needle in ('key: "highlights", label: "HIGHLIGHTS"',
                   "th-medallion", "th-spinner", "th-heart th-front",
                   "Audited in public.",
                   "Warmth = \u03a3 (2 \u00f7 (group size \u2212 1)) over shared observations",
                   "best case: 15 two-muse observations",
                   "still warming up", "zone_rules.js"):
        assert needle in html, needle
    # the db-era artifacts are gone from the site copy
    assert "townhearts.db" not in html
    assert "data/schema.sql" not in html
    assert "previews and reasons" not in html
    assert "previews" not in html and "reasons are" not in html


def test_site_socialites_stage_pins():
    """pub-1.2 (owner call, 2026-10-07: "jazz up the socialites section"):
    the Socialites section hosts the owner's 3D spinning-heart stage, driven
    dynamically by the real roll. Pinned: the section keeps its aria-label,
    the demo's structure/heading/copy/hint, the CSS-native spinner
    animation with the owner's !important declarations (owner calls 15:04 +
    15:42: replace the JS rAF rotation with a native infinite CSS animation,
    then DELETE the section's reduced-motion kill switch — it parked every
    stage animation on RM devices), the DYNAMIC roll flow (buildStage rebuilt on every
    window render), the real inter-roll edge web, and the empty-roll
    warming-up branch unchanged."""
    html = _html()
    # the section's contract: the aria-label is untouched, the structure = the demo's
    assert '<section id="zone-socialites" aria-label="The Socialites of the Town">' in html
    for needle in ('id="th-title">THE SOCIALITES</h2>',
                   'class="th-sparkle" aria-hidden="true">✦</span>',
                   '<div class="th-stage">',
                   '<svg class="th-lines" id="th-lines" aria-hidden="true"></svg>',
                   '<div class="th-center"><img src="logo.png" alt="TownHearts plush logo"></div>',
                   '<div class="th-list" id="soc-stage"></div>',
                   'class="afoot th-hint" id="soc-status" aria-live="polite"',
                   "Hover, focus, or tap a Socialite."):
        assert needle in html, needle
    # the copy line stays verbatim (the demo's th-copy == the section's copy)
    assert ("The Socialites of the Town — the town's highly connected regulars. "
            "They're naturally in the middle of everything, so they get their own "
            "stage while the tables below make room for everyone else's "
            "connections.") in html
    # the demo's motion machinery, scoped under the section id
    for k in ("th-arrive", "th-heart-spin", "th-heart-float", "th-draw",
              "th-flow", "th-twinkle", "th-logo-breathe"):
        assert "@keyframes " + k in html, k
    assert 'soc-empty .th-stage{display:none}' in html   # the honest empty window
    # the spin is CSS-native: the full spinner rule exists (keyframes run,
    # staggered by --i, hover/focus/active accelerates to .9s); the JS rAF
    # loop and its gates are gone entirely; off-viewport no longer gates the
    # spin since the CSS engine owns it; resize still re-arranges via RO
    assert ('#zone-socialites .th-spinner{position:absolute;inset:0;display:block;'
            'transform-style:preserve-3d;will-change:transform;'
            'animation:th-heart-spin 3.8s linear infinite !important;'
            'animation-delay:calc(var(--i,0)*-430ms) !important}') in html
    assert '#zone-socialites .th-person:is(:hover,:focus-visible,.active) .th-spinner{animation-duration:.9s !important}' in html
    assert "prefers-reduced-motion" not in html  # the kill switch stays deleted
    assert "socSpin" not in html and "socFrame" not in html
    assert "IntersectionObserver" not in html and "ResizeObserver" in html
    # the dynamic roll: buildStage rebuilds per window render, shuffle kept
    assert "function buildStage(" in html and "renderSocialites();" in html
    assert "Z.shuffle(roll)" in html
    # the web: canonical pairKey over the loaded graph's edges, one path/pair
    assert "[e.a, e.b].sort().join(\"|\")" in html
    assert "document.createElementNS" in html
    # the retired bubble/chip markup is gone and stays gone
    assert 'id="soc-chips"' not in html and "thdance" not in html
    # the empty-roll branch copy is unchanged (showcase + full windows)
    assert "The Socialites stage is still warming up." in html
    assert "no Socialites in this window" in html


def test_site_serves_the_published_sample_it_ships():
    """The window files the site fetches are exactly the published set."""
    html = _html()
    for f in FILES:
        assert f in html, f


# ----------------------------------------------------------------- docs

def test_reach_published_in_all_files():
    """pub-1.1: meta.reach (Town Reach) rides on all four files — counts-only
    breadth over ALL co-presence; every muse with an edge here has a reach
    entry that at least covers its published connections; reach muses are
    roster members; edge members come from reach (an unaddressed campfire
    pair may have reach with NO edge — the honest split)."""
    for fname in FILES:
        doc = _load(fname)
        reach = doc["meta"]["reach"]
        roster = doc["muses"]
        assert isinstance(reach, dict), fname
        partners: dict = {}
        for e in doc["edges"]:
            partners.setdefault(e["a"], set()).add(e["b"])
            partners.setdefault(e["b"], set()).add(e["a"])
        for mid in partners:
            assert mid in reach, (fname, mid)      # edges ⊆ reach
            assert reach[mid]["unique_muses"] >= len(partners[mid]), (fname, mid)
        for mid, r in reach.items():
            assert mid in roster, (fname, mid)
            assert set(r) == {"unique_muses", "active_days", "places"}
            assert all(isinstance(v, int) and not isinstance(v, bool)
                       and v >= 1 for v in r.values()), (fname, mid)
    # the lifetime file's reach is the biggest key set of the four (windows
    # are suffixes of the retained layer)
    life = _load("graph.json")["meta"]["reach"]
    edge_muses = partners
    for fname in FILES:
        assert set(_load(fname)["meta"]["reach"]) <= set(life), fname
    # the honest split exists in the REAL data: some muse has reach but no
    # purposeful edge in the lifetime file (ambient-only campfire pairs)
    assert any(mid not in edge_muses for mid in life)


def test_site_three_surfaces_and_principle():
    """pub-1.1 (owner-approved copy, verbatim): the scoring card carries the
    three-surface block and the principle line."""
    html = _html()
    for needle in ("Warm connections: repeated shared activity outside the campfire",
                   "Town reach: distinct muses encountered anywhere, including the campfire",
                   "Recognition: directed or reciprocal public interaction",
                   "Hearts are earned slowly. Ambient campfire traffic does not count."):
        assert needle in html, needle


def test_site_purposeful_null_copy():
    """pub-1.1: the pair lookup + the focused view state the epoch-3 rule
    when a lookup comes up empty / a muse is ambient-only."""
    html = _html()
    assert "no purposeful connection recorded" in html
    assert "ambient campfire traffic does not count toward warmth" in html
    assert "no purposeful connections yet" in html
    # the focused view reads meta.reach through the zone rules
    zr = open(os.path.join(REPO, "zone_rules.js"), encoding="utf-8").read()
    assert "function museReach(" in zr and "function reachLine(" in zr
    assert "Z.museReach(meta && meta.reach" in html


def test_muse_txt_documents_public3():
    muse = open(os.path.join(REPO, "muse.txt"), encoding="utf-8").read()
    assert "public-3" in muse
    assert "aggregate" in muse.lower()
    assert "scoring_reference" in muse
    assert "pub-1.1" in muse
    # epoch 3: the campfire rule + the place classification are documented
    assert "campfire" in muse.lower()
    assert "place_classification" in muse
    assert "passive-ambient" in muse
    # the db era is gone from the agent spec — the data is the JSON contract
    for banned in ("sqlite", "townhearts.db", "schema.sql", "pairs(", "edges_log"):
        assert banned not in muse.lower(), banned
    # removed fields may be NAMED as removed (that is the contract doc), but
    # no recipe for reaching them survives
    assert "places_present" in muse


def test_api_md_recipes_over_graph_json():
    api = open(os.path.join(REPO, "API.md"), encoding="utf-8").read()
    assert "public-3" in api
    assert "graph.json" in api and "jq" in api
    assert "meta.reach" in api            # the Town Reach recipe ships
    assert "pub-1.1" in api
    for banned in ("sqlite3 townhearts.db", "townhearts.db", "schema.sql",
                   "edges_log", "pair_obs", "first_obs_ts"):
        assert banned not in api, banned


def test_readme_license_spirit_and_draft_markers():
    """Licenses are owner-confirmed (2026-10-06): MIT site code, CC BY-NC 4.0
    data — the old DRAFT pin predates the confirmation and is retired."""
    readme = open(os.path.join(REPO, "README.md"), encoding="utf-8").read()
    assert "public-3" in readme
    assert "proprietary" in readme.lower()            # collector stays private
    for banned in ("townhearts.db", "schema.sql"):
        assert banned not in readme, banned


def test_privacy_md_public_data_only():
    priv = open(os.path.join(REPO, "PRIVACY.md"), encoding="utf-8").read()
    assert "GitHub issue" in priv or "issue" in priv.lower()   # the opt-out route
    assert "forward" in priv.lower()                  # forward-only semantics
    assert "pre-publication" in priv.lower() or "before publication" in priv.lower()


def test_changelog_fresh_top_entry():
    ch = open(os.path.join(REPO, "CHANGELOG.md"), encoding="utf-8").read()
    head = ch[:2000]
    assert "pub-1.1" in head and "public-3" in head
    assert "private archive" in head.lower() or "private repo" in head.lower()
    # fresh: no pre-migration version history in this repo
    assert "v1.3.4" not in head


def test_license_files_owner_confirmed():
    """Owner-confirmed 2026-10-06: site/client code MIT, published aggregated
    data CC BY-NC 4.0 — no draft markers anywhere."""
    lic = open(os.path.join(REPO, "LICENSE"), encoding="utf-8").read()
    data = open(os.path.join(REPO, "LICENSE-DATA"), encoding="utf-8").read()
    assert "MIT License" in lic and "dustytext-bot / Snar" in lic
    assert "CC BY-NC 4.0" in data
    assert "DRAFT" not in lic and "DRAFT" not in data


def test_ci_workflow_runs_all_jobs():
    ci = open(os.path.join(REPO, ".github", "workflows", "ci.yml"),
              encoding="utf-8").read()
    for needle in ("pytest", "test_tracker.py", "validate_public_output.py",
                   "scan_public_output.py", "check_repo.py",
                   "render_check.js", "zone_check.js", "showcase_check.js",
                   "window_check.js", "deep_link_check.js",
                   "find_form_check.js", "scoring_equiv_check.js"):
        assert needle in ci, needle


def test_remote_origin_configured():
    """Phase C is live: the public serving repo carries its origin remote
    (pages-build-deployment and the scheduled data commits push through it)."""
    r = subprocess.run(["git", "remote"], cwd=REPO, capture_output=True, text=True)
    assert r.returncode == 0
    assert "origin" in r.stdout.split()
    branch = subprocess.run(["git", "symbolic-ref", "--short", "HEAD"],
                            cwd=REPO, capture_output=True, text=True)
    assert branch.stdout.strip() == "development"