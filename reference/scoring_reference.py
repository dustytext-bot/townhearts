#!/usr/bin/env python3
"""TownHearts scoring reference (public-3) — the standalone public copy of
the scoring constants and rules.

The production scorer runs in the private collector; the published data
never re-derives it here. This module exists so the PUBLIC repo can
independently express — and CI can enforce — the exact arithmetic the
published aggregates follow:

  - warmth = SUM over the pair's shared co-location rows of 2/(n-1)
    (crowd-diluted co-presence-2 core; n = the distinct muses standing at
    that spot at that read) — EXCEPT the epoch-3 passive-place rule:
    co-presence at a passive-ambient place (the campfire — see
    PASSIVE_PLACE_ALIASES) weighs 0 unless the pair directly addressed
    each other within that shared moment, in which case the row switches
    to n=2 semantics and weighs the FULL 2 (the crowd does not dilute an
    addressed conversation);
  - the tier floors (2 / 6 / 14 / 30 — unchanged since co-presence-1),
  - the epoch-4 upper-tier persistence gate: tiers are POST-PROCESSED —
    acquaintance/friendly stay score-based; companion additionally needs
    >= 7 qualifying sessions across >= 7 active days, bond >= 15 sessions
    across >= 21 days; a qualifying observation is one that contributes
    positive warmth; consecutive qualifying observations 6 hours or less
    apart are ONE session (two expected three-hour intervals; a gap
    GREATER than 6 hours starts another; exactly 6h is one) — warmth
    values never change, only tier eligibility (tier_of_evidence here),
  - the Socialites qualification rule (breadth only, musebuck amounts never
    an input),
  - the shared warmth display formatter (mirrors zone_rules.displayWarmth).

This file must stay in LOCKSTEP with zone_rules.js (the display formatter
and the warmth→bar scale it embeds, via focusCardView's barPct = w/30) and
with the published data itself (every public edge's tier must equal
tier_of_evidence(warmth, qualifying_sessions, active_days) here — see
test_tracker.py). It carries NO collector code,
NO private layout, and reads nothing at import time.

Self-test: python3 reference/scoring_reference.py   (runs the anchors below)
"""

from __future__ import annotations

import math
from datetime import timedelta

# ------------------------------------------------------------------ contract
SCHEMA_VERSION = "public-3"
PUBLISHER_VERSION = "pub-1.3"
SCORING_VERSION = "co-presence-4"

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

# ------------------------------------------------- epoch 4: the tier gate
# The warm ladder above is UNCHANGED; upper tiers are post-processed over
# the same scores (the collector scores with THE SAME arithmetic — see
# TIER_GATE there). A pair takes the HIGHEST tier whose EVERY requirement
# it satisfies: the warmth floor and, for companion/bond, the persistence
# gate. Warmth values never change — only tier eligibility.
TIER_GATE = {
    "companion": {"qualifying_sessions": 7, "active_days": 7},
    "bond": {"qualifying_sessions": 15, "active_days": 21},
}
SESSION_MERGE_GAP_HOURS = 6

TIER_GATE_RULE = ("Acquaintance and Friendly reflect visible familiarity. "
                  "Companion and Bond require that activity to recur across "
                  "separate sessions and days, so one long visit cannot "
                  "create a high-tier relationship.")
QUALIFYING_RULE = ("a qualifying observation is one that contributes positive "
                   "warmth under the current scoring rules; consecutive "
                   "qualifying observations 6 hours or less apart are ONE "
                   "session (two expected three-hour intervals); a gap "
                   "greater than 6 hours starts a new session only when the "
                   "retained read stream vouches the boundary (a retained "
                   "read sits inside the gap) — outage gaps nothing watched "
                   "merge instead and flag the counts as lower bounds; "
                   "multiple collector reads during one continuous visit are "
                   "one session, and multiple speeches in one session add "
                   "none")
PARTIAL_RULE = ("session/day counts come from the complete retained town-read "
                "stream; a session boundary is vouched only when a retained "
                "read falls inside the gap that starts it, so an outage era "
                "can never inflate or invent a session — its junctions merge "
                "and the count is then a lower bound; pairs whose qualifying "
                "evidence is not fully carried by retained reads (legacy "
                "attribution) or spans a retained-read gap greater than the "
                "6-hour session horizon carry evidence_partial TRUE forever")


def tier_gate_public() -> dict:
    """The published epoch-4 gate (meta.tier_gate on every published file) —
    the exact mirror of the collector's block (the tests pin them equal)."""
    return {
        "rule": TIER_GATE_RULE,
        "session_rule": QUALIFYING_RULE,
        "partial_rule": PARTIAL_RULE,
        "qualifying_sessions": {t: TIER_GATE[t]["qualifying_sessions"]
                                for t in sorted(TIER_GATE)},
        "active_days": {t: TIER_GATE[t]["active_days"]
                        for t in sorted(TIER_GATE)},
    }

# --------------------------------------------------- place classification
# Epoch 3 (2026-10-06, owner-approved): the campfire is a PASSIVE-AMBIENT
# place. The classifier is deterministic config-driven code in the private
# collector (categories/aliases live in collector/place_rules.json — DATA,
# versioned, may grow over time); this is the public mirror of TODAY'S
# verified aliases + the exact rule, and CI pins it against the published
# meta.scoring.place_classification.
PLACE_CLASSIFICATION_VERSION = 1
PASSIVE_PLACE_CATEGORY = "passive-ambient"
PASSIVE_PLACE_ALIASES = ("campfire", "Campfire")   # verified aliases, VERBATIM

PASSIVE_PLACE_RULE = (
    "a passive-ambient (campfire) shared row contributes 0 warmth unless a "
    "directed interaction between the same pair — either orientation; "
    "one-way and reciprocal stay distinct in the context aggregates — fell "
    "in that row's co-presence window (the interval between the two "
    "consecutive retained town reads before-and-at the row's instant; the "
    "first retained read's window is open at its left edge); an addressed "
    "row switches to n=2 semantics and contributes the full 2/(2-1) = 2 "
    "no matter how big the crowd around it; one directed row qualifies at "
    "most one sample; multiple speeches in one window do not stack")


def is_passive_place(place: str, aliases=PASSIVE_PLACE_ALIASES) -> bool:
    """Deterministic, no-LLM classifier (public mirror of the collector's):
    a trimmed CASE-INSENSITIVE EXACT alias match — "campfire" and
    "Campfire" are verified aliases of one place; any other place (and any
    longer string) is not passive."""
    p = str(place or "").strip().casefold()
    return p in {a.strip().casefold() for a in aliases}


def epoch3_row_weight(place: str, n: int, addressed: bool) -> float:
    """One co-location row's warmth under co-presence-3 (epoch 3):

    - a non-passive place weighs 2/(n-1) exactly as before — the
      co-presence-2 core is unchanged;
    - a passive-ambient (campfire) row weighs 0 for ambience alone; when
      the pair DIRECTLY ADDRESSED each other inside that row's between-
      reads window, the row switches to n=2 semantics and weighs the FULL
      2 — the crowd around an addressed conversation does not dilute it."""
    if is_passive_place(place):
        return 2.0 if addressed else 0.0
    return row_weight(n)


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


def split_sessions(qual_dts,
                   read_instants=None) -> "tuple[int, bool]":
    """Session count + the count-quality flag from qualifying-observation
    datetimes, VOUCHED against the retained read stream (audit-2 fix,
    owner call 2026-10-07 21:56):

        consecutive qualifying observations <= 6 hours apart belong to ONE
        session (two expected three-hour intervals — exactly 6h apart is
        still one); a gap GREATER than 6 hours starts another ONLY when a
        retained read instant sits STRICTLY inside the gap — the system was
        reading during that interval and did not observe the pair
        co-present in a qualifying way (an honest, observed boundary).

    A >6h gap the stream CANNOT vouch (an outage era: no successful reads
    at all) NEVER splits — the sessions merge across it and the partial
    flag returns TRUE: the count is then a LOWER BOUND. It may understate
    persistence; it can never be inflated by the collector's own outage
    eras — a missing-read gap can never help unlock Companion or Bond.
    No ledger passed = nothing can be vouched = the conservative fold.
    Input order is normalized (sorted); duplicate instants collapse.
    (The public mirror of the collector's split_sessions.)"""
    gap = timedelta(hours=SESSION_MERGE_GAP_HOURS)
    if not qual_dts:
        return 0, False
    inst = set(read_instants) if read_instants is not None else set()
    ordered = sorted(qual_dts)
    sessions = 1
    partial = False
    for prev, cur in zip(ordered, ordered[1:]):
        if cur - prev <= gap:
            continue
        if any(prev < t < cur for t in inst):
            sessions += 1
        else:
            partial = True        # unvouched outage gap: merged, not split
    return sessions, partial


def tier_of(warmth) -> str | None:
    """The inclusive-floor tier of a warmth value, or None (sub-floor pairs
    honestly carry 'no tier yet' in the UI / null in the data). Flows and
    directed speech are NEVER inputs — warmth comes from co-location only.
    Epoch 4: this is the WARMTH LADDER alone; tier_of_evidence() adds the
    persistence gate for companion/bond."""
    if not isinstance(warmth, (int, float)) or isinstance(warmth, bool):
        raise TypeError(f"warmth must be a number, got {warmth!r}")
    if warmth < 0:
        raise ValueError(f"negative warmth is not a score: {warmth!r}")
    for name, floor in TIER_ORDER:
        if warmth >= floor:
            return name
    return None


def tier_of_evidence(warmth, qualifying_sessions, active_days) -> str | None:
    """Epoch-4 tier: the HIGHEST tier whose EVERY axis the pair qualifies
    for — the warmth floor (tier_of()'s ladder, unchanged) AND, for
    companion/bond, the persistence gate (TIER_GATE: qualifying sessions
    + active days). Warmth VALUES never change — only eligibility: a pair
    exceeding a floor but failing that tier's gate receives the highest
    lower tier it fully qualifies for (warmth 30 failing Bond's gate stays
    Companion when Companion's gate qualifies); nothing qualifies -> None.
    A missing (None) gate count never reaches an upper tier — it lowers the
    pair to the highest score-based tier the warmth alone carries, never
    an error; passing one count without the other is a mistake and raises.
    (The public mirror of the collector's tier_of_evidence — same rules.)"""
    for label, v in (("qualifying_sessions", qualifying_sessions),
                     ("active_days", active_days)):
        if v is not None and (isinstance(v, bool) or not isinstance(v, int)
                              or v < 0):
            raise ValueError(f"{label} must be a non-negative int or None")
    if tier_of(warmth) is None:
        return None
    for name, floor in TIER_ORDER:
        if warmth < floor:
            continue                   # below this floor: cannot take it
        gate = TIER_GATE.get(name)
        if gate and (qualifying_sessions is None or active_days is None
                     or qualifying_sessions < gate["qualifying_sessions"]
                     or active_days < gate["active_days"]):
            continue                   # warmth qualifies, persistence does not
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
#   n=3  — the pair plus one more muse in the plaza: 2 rows × 2/(3-1)
#          = warmth 2 → acquaintance (with the 3 shared rows above: 8 —
#          still friendly, the trio rows just dilute).
#   n=27 — a crowded PLAZA of 27: ONE row weighs 2/26 ≈ 0.0769 — a pair
#          seen ONLY in such crowds stays below the lowest tier floor
#          (no tier yet) no matter how often the crowd gathers.
#          (A campfire crowd is DIFFERENT since epoch 3: unaddressed
#          ambience weighs 0 there, and an ADDRESSED campfire conversation
#          weighs the full 2 — see epoch3_row_weight / PASSIVE_PLACE_RULE.)
#
#   15 shared 2-muse observations = warmth 30 — and since epoch 4 the
#   bond tier ALSO requires those observations to recur across separate
#   sessions and days (>= 15 sessions across >= 21 active days): scoring
#   alone no longer carries the upper tiers (tier_of_evidence).


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
    # tier floors (unchanged) — the warmth ladder alone
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
    # epoch 4: the persistence gate (tier_of_evidence — the Snar boundaries)
    assert tier_of_evidence(6, 1, 1) == "friendly"        # no day/session gate
    assert tier_of_evidence(14, 6, 7) == "friendly"       # sessions 6 < 7
    assert tier_of_evidence(14, 7, 6) == "friendly"       # days 6 < 7
    assert tier_of_evidence(14, 7, 7) == "companion"      # both axes qualify
    assert tier_of_evidence(30, 14, 21) == "companion"    # bond gate: sessions short
    assert tier_of_evidence(30, 15, 20) == "companion"    # bond gate: days short
    assert tier_of_evidence(30, 15, 21) == "bond"         # both axes qualify
    assert tier_of_evidence(32, 7, 7) == "companion"      # warmth above bond's floor,
    # ... but failing bond's gate keeps the highest fully-qualified tier
    assert tier_of_evidence(12, 1, 1) == "friendly"       # below companion's floor: no gate
    assert tier_of_evidence(1.0, 99, 99) is None
    assert tier_of_evidence(0, 99, 99) is None
    for bad in (-4, 1.0, 30):
        with_err = False
        try:
            tier_of_evidence(-4, 99, 99)
        except ValueError:
            with_err = True
    # negative warmth raises (tier_of validates the score itself)
    try:
        tier_of_evidence(-4, 99, 99)
    except ValueError:
        pass
    else:
        raise AssertionError("negative warmth must raise")
    # garbage gate counts raise
    for err_case in ((30, True, 21), (30, 21, -1), (30, 1.5, 21)):
        raised = False
        try:
            tier_of_evidence(err_case[0], err_case[1], err_case[2])
        except ValueError:
            raised = True
        assert raised, err_case
    # missing gate data simply never reaches an upper tier (never an error):
    assert tier_of_evidence(30, None, None) == "friendly"   # score-only shape
    assert tier_of_evidence(30, 15, None) == "friendly"     # one without the other
    assert tier_of_evidence(30, None, 21) == "friendly"
    # session merging (split_sessions, the 6h rule — vouched boundaries,
    # audit-2 fix: an outage gap never splits or inflates a count)
    from datetime import datetime, timezone
    t0 = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)
    assert split_sessions([t0, t0]) == (1, False)
    assert split_sessions([t0, t0 + timedelta(hours=6)]) == (1, False)  # exactly 6h: one
    assert split_sessions([t0, t0 + timedelta(hours=6, seconds=1)]) == (1, True)  # unvouched: merged
    assert split_sessions([t0, t0 + timedelta(hours=6, seconds=1)],
                          [t0 + timedelta(hours=3)]) == (2, False)      # vouched: two sessions
    assert split_sessions([t0, t0 + timedelta(hours=3), t0 + timedelta(hours=9)]) == (1, False)
    assert split_sessions([t0, t0 + timedelta(hours=3), t0 + timedelta(hours=10)]) == (1, True)
    assert split_sessions([]) == (0, False)
    # the published gate block
    gate = tier_gate_public()
    assert gate["qualifying_sessions"] == {"bond": 15, "companion": 7}
    assert gate["active_days"] == {"bond": 21, "companion": 7}
    assert "one long visit cannot create a high-tier relationship" in gate["rule"]
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
    # epoch-3 place classification + row weights (the campfire rule)
    assert is_passive_place("Campfire") and is_passive_place("campfire")
    assert is_passive_place("  CAMPFIRE ") and not is_passive_place("Campfire Pit")
    assert epoch3_row_weight("Campfire", 27, False) == 0.0   # ambience: no warmth
    assert epoch3_row_weight("campfire", 27, True) == 2.0    # addressed: n=2 full weight (case-insensitive)
    assert epoch3_row_weight("Campfire", 2, True) == 2.0
    assert epoch3_row_weight("Docks", 27, False) == 2 / 26   # non-passive: unchanged dilution
    assert epoch3_row_weight("Campfire Pit", 3, True) == 1.0 # not the campfire: normal n=3 weight
    print("scoring_reference self-test OK: co-presence-4 anchors (the epoch-3 "
          "campfire rule + the epoch-4 tier gate included), tier floors "
          "2/6/14/30, display formatter, socialites rule")


if __name__ == "__main__":
    _self_test()