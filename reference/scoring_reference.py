#!/usr/bin/env python3
"""TownHearts scoring reference (public-3) — the standalone public copy of
the scoring constants and rules.

The production scorer (co-presence-2) runs in the private collector; the
published data never re-derives it here. This module exists so the PUBLIC
repo can independently express — and CI can enforce — the exact arithmetic
the published aggregates follow:

  - warmth = SUM over the pair's shared co-location rows of 2/(n-1)
    (crowd-diluted co-presence-2; n = the distinct muses standing at that
    spot at that read),
  - the tier floors (2 / 6 / 14 / 30 — unchanged since co-presence-1),
  - the Socialites qualification rule (breadth only, musebuck amounts never
    an input),
  - the shared warmth display formatter (mirrors zone_rules.displayWarmth).

This file must stay in LOCKSTEP with zone_rules.js (the display formatter
and the warmth→bar scale it embeds, via focusCardView's barPct = w/30) and
with the published data itself (every public edge's tier must equal
tier_of(warmth) here — see test_tracker.py). It carries NO collector code,
NO private layout, and reads nothing at import time.

Self-test: python3 reference/scoring_reference.py   (runs the anchors below)
"""

from __future__ import annotations

import math

# ------------------------------------------------------------------ contract
SCHEMA_VERSION = "public-3"
PUBLISHER_VERSION = "pub-1.0"
SCORING_VERSION = "co-presence-2"

# ------------------------------------------------------------- tier floors
# Inclusive warmth floors, ranked strongest-first for tier_of's scan.
# UNCHANGED on the co-presence-2 scale: a 2-muse spot weighs 2 per instant
# (the old co-presence-1 units), so the best-case observation counts are
# 1 / 3 / 7 / 15 — small-spot bonding reaches every tier exactly as fast
# as before, and crowds self-downweight (n=27 weighs 2/26 ≈ 0.077).
TIER_MIN: dict[str, float] = {
    "acquaintance": 2.0,
    "friendly": 6.0,
    "companion": 14.0,
    "bond": 30.0,
}
TIER_ORDER = (("bond", TIER_MIN["bond"]),
              ("companion", TIER_MIN["companion"]),
              ("friendly", TIER_MIN["friendly"]),
              ("acquaintance", TIER_MIN["acquaintance"]))

# -------------------------------------------------------- socialites rule
# A per-window ROLE, never a tier and never a score: breadth-only
# qualification from the window's own co-presence record.
SOCIALITES_MAX = 6
SOCIALITES_MIN_UNIQUE_MUSES = 6
SOCIALITES_MIN_ACTIVE_DAYS = 3        # 7d/30d only — omitted on 24h
SOCIALITES_MIN_PLACES = 3
SOCIALITES_DOMINANCE_MAX = 0.40       # largest single-muse co-obs share <= 40%


# ------------------------------------------------------------------ warmth

def row_weight(n: int) -> float:
    """One co-location row inside a group of n distinct muses: 2/(n-1).

    The anchors: n=2 → 2 (full credit, the co-presence-1 units), n=3 → 1,
    n=27 → 2/26 ≈ 0.077 (the crowd dilutes itself). n must be >= 2 (n=1
    would divide by zero — a muse alone is not a co-location).
    """
    if not isinstance(n, int) or isinstance(n, bool) or n < 2:
        raise ValueError(f"group size must be an int >= 2, got {n!r}")
    return 2.0 / (n - 1)


def warmth_from_group_sizes(sizes) -> float:
    """co-presence-2: warmth = Σ 2/(n-1) over the pair's shared rows."""
    total = 0.0
    for n in sizes:
        total += row_weight(n)
    return total


def tier_of(warmth) -> str | None:
    """The inclusive-floor tier of a warmth value, or None (sub-floor pairs
    honestly carry 'no tier yet' in the UI / null in the data). Flows and
    directed speech are NEVER inputs — warmth comes from co-location only."""
    if not isinstance(warmth, (int, float)) or isinstance(warmth, bool):
        raise TypeError(f"warmth must be a number, got {warmth!r}")
    if warmth < 0:
        raise ValueError(f"negative warmth is not a score: {warmth!r}")
    for name, floor in TIER_ORDER:
        if warmth >= floor:
            return name
    return None


def display_warmth(value) -> str:
    """The ONE shared warmth display formatter — mirrors zone_rules.js
    displayWarmth exactly (the site shows a human number; full precision
    stays in the files): integers plain, other values rounded to 2 decimals
    with trailing zeros trimmed, values below 0.01 as "<0.01", non-finite
    or absent as an em-dash."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return "\u2014"
    f = float(value)
    if not math.isfinite(f):
        return "\u2014"
    if 0 < f < 0.01:
        return "<0.01"
    if f.is_integer():
        return str(int(f))
    return f"{f:.2f}".rstrip("0").rstrip(".")


# --------------------------------------------------------------- socialites

def socialite_qualifies(unique_muses: int, active_days: int, places: int,
                        largest_share: float,
                        require_days: bool = True) -> tuple[bool, dict]:
    """The Socialites qualification rule (public statement of the roll):
    >= 6 distinct muses co-observed, >= 3 distinct public places, >= 3
    distinct active days (omitted on the 24h window, whose span covers at
    most two calendar dates), and no single-muse dominance — the largest
    share of one muse's co-observations <= 40%. Musebuck amounts are NEVER
    an input and no LLM judgments are involved. The roll never changes
    warmth, co_locations, or any tier."""
    details = {"unique_muses": unique_muses, "active_days": active_days,
               "places": places, "largest_share": largest_share}
    ok = (unique_muses >= SOCIALITES_MIN_UNIQUE_MUSES
          and places >= SOCIALITES_MIN_PLACES
          and largest_share <= SOCIALITES_DOMINANCE_MAX
          and (not require_days or active_days >= SOCIALITES_MIN_ACTIVE_DAYS))
    return ok, details


# ----------------------------------------------------------- worked example
# The three anchors, worked end-to-end (the case the tests pin):
#
#   n=2  — Nimbus and Juniper alone at the Docks, 3 different reads:
#          3 rows × 2/(2-1) = warmth 6 → friendly.
#   n=3  — the pair plus one more muse in the square: 2 rows × 2/(3-1)
#          = warmth 2 → acquaintance (with the 3 shared rows above: 8 —
#          still friendly, the trio rows just dilute).
#   n=27 — a campfire crowd of 27: ONE row weighs 2/26 ≈ 0.0769 — a pair
#          seen ONLY in such crowds stays below the lowest tier floor
#          (no tier yet) no matter how often the crowd gathers.
#
#   15 shared 2-muse observations = warmth 30 → bond, same as always.


def _self_test() -> None:
    # row-weight anchors
    assert row_weight(2) == 2.0
    assert row_weight(3) == 1.0
    assert abs(row_weight(27) - 2 / 26) < 1e-15
    # warmth sums
    assert warmth_from_group_sizes([2, 2, 2]) == 6.0
    assert warmth_from_group_sizes([3, 3]) == 2.0
    assert abs(warmth_from_group_sizes([27]) - 0.076923077) < 1e-6
    assert warmth_from_group_sizes([2] * 15) == 30.0
    assert warmth_from_group_sizes([]) == 0.0
    # tier floors (unchanged)
    assert tier_of(0) is None
    assert tier_of(1.0) is None
    assert tier_of(2 / 26) is None
    assert tier_of(2) == "acquaintance"
    assert tier_of(4) == "acquaintance"
    assert tier_of(6) == "friendly"
    assert tier_of(12) == "friendly"
    assert tier_of(14) == "companion"
    assert tier_of(28) == "companion"
    assert tier_of(30) == "bond"
    assert tier_of(32) == "bond"
    for bad in (-4,):
        try:
            tier_of(bad)
        except ValueError:
            pass
        else:
            raise AssertionError("negative warmth must raise")
    # display formatter (the zone_rules.js case table)
    cases = [
        (4.060606061, "4.06"), (4.5, "4.5"), (4.0, "4"),
        (2, "2"), (30, "30"), (6, "6"), (0, "0"),
        (0.076923077, "0.08"), (0.009, "<0.01"), (0.01, "0.01"),
        (100.1, "100.1"), (-3, "-3"),
        (float("nan"), "\u2014"), (float("inf"), "\u2014"),
        (-float("inf"), "\u2014"), (None, "\u2014"),
    ]
    for value, want in cases:
        assert display_warmth(value) == want, (value, display_warmth(value))
    # socialites rule
    ok, _ = socialite_qualifies(6, 3, 3, 0.25)
    assert ok
    for args in ((5, 3, 3, 0.25), (6, 2, 3, 0.25), (6, 3, 2, 0.25), (6, 3, 3, 0.5)):
        assert not socialite_qualifies(*args)[0], args
    assert socialite_qualifies(6, 1, 3, 0.25, require_days=False)[0]      # 24h: days omitted
    assert not socialite_qualifies(6, 1, 3, 0.5, require_days=False)[0]   # dominance still applies
    assert socialite_qualifies(7, 3, 3, 4 / 11)[0]                        # exactly 40%: in
    assert not socialite_qualifies(6, 3, 3, 5 / 11)[0]                    # above 40%: out
    print("scoring_reference self-test OK: co-presence-2 anchors, tier floors "
          "2/6/14/30, display formatter, socialites rule")


if __name__ == "__main__":
    _self_test()