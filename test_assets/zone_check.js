// TownHearts zone rules check — imports the site's zone logic (zone_rules.js)
// directly in node (no browser) and asserts the v1.2 zone rules:
//   - growingNow: growth-only rows, growth_7d ranking with growth_30d tiebreak
//     (then pairKey); socialite-a-socialite pairs excluded entirely; at most
//     ONE row per socialite within the first 10 rows — every further
//     socialite row continues after the divider (the `rest` block, in its
//     ranked position); featured holds at most 10 rows.
//   - newSparks: first_seen_date within 30 days of the anchor (date-level
//     evidence in public-3; a date parses to UTC midnight), newest first,
//     first 12 featured + rest after the divider.
//   - allBonds: full table by warmth (tiebreak pairKey), unfiltered.
//   - topBonds (v1.2.5): the default-page showcase — the allBonds order
//     sliced to a cap (default 10), stable pairKey-asc tiebreak, non-mutating.
//   - musePairs: one muse's pairs, strongest first.
//   - focusCardView (v1.2.2): the focused view's pair card as a pure,
//     browser-free view-model consumed by the homepage card renderer.
//   - socialiteIds + shuffle (per-load randomization, order-only).
//
// Usage: node test_assets/zone_check.js
// Exit 0 = all rules hold; 1 = violation.

"use strict";
const path = require("path");
const Z = require(path.join(__dirname, "..", "zone_rules.js"));

let failures = 0;
function ok(cond, msg) {
  if (!cond) { console.error("FAIL: " + msg); failures += 1; }
}

function edge(pair, a, b, g7, g30, warmth, firstSeenDate) {
  return { pair, a, b, growth_7d: g7, growth_30d: g30,
           warmth: warmth == null ? (g7 || g30) : warmth,
           first_seen_date: firstSeenDate == null ? "2026-09-01" : firstSeenDate,
           context: { directed_count: 0, reciprocal_directed: false, flow_count: 0, mb_flow_total: 0 } };
}

// ---- zone 2: CONNECTIONS GROWING NOW -------------------------------------
{
  const rows = [
    edge("muse_s1|muse_s2", "muse_s1", "muse_s2", 50, 50),   // Soc×Soc — excluded entirely
    // full growth_7d == 20 tie: ordered by growth_30d desc, then pairKey
    edge("muse_a|muse_b", "muse_a", "muse_b", 20, 40),
    edge("muse_s1|muse_c", "muse_s1", "muse_c", 20, 30),     // s1's one featured row
    edge("muse_s2|muse_d", "muse_s2", "muse_d", 20, 25),     // s2's one featured row
    edge("muse_p|muse_q", "muse_p", "muse_q", 20, 20),
    edge("muse_i|muse_j", "muse_i", "muse_j", 20, 18),
    edge("muse_k|muse_l", "muse_k", "muse_l", 20, 18),       // full tie → pairKey order
    edge("muse_s1|muse_e", "muse_s1", "muse_e", 10, 100),    // s1 already featured → deferred
    edge("muse_s2|muse_f", "muse_s2", "muse_f", 0, 90),      // s2 already featured → deferred
    edge("muse_m|muse_n", "muse_m", "muse_n", 0, 0),         // no growth — excluded
  ];
  const r = Z.growingNow(rows, ["muse_s1", "muse_s2"]);
  ok(r.featured.length === 6, "featured holds the qualifying non-deferred rows (6), got " + r.featured.length);
  ok(!r.featured.some((e) => e.pair === "muse_s1|muse_s2"), "Soc×Soc pair must be excluded entirely");
  ok(!r.rest.some((e) => e.pair === "muse_s1|muse_s2"), "Soc×Soc pair must not re-enter via the divider block");
  ok(r.featured[0].pair === "muse_a|muse_b", "highest growth_30d within the growth_7d tie ranks first");
  const g20 = r.featured.map((e) => e.pair);
  ok(JSON.stringify(g20) === JSON.stringify([
    "muse_a|muse_b", "muse_s1|muse_c", "muse_s2|muse_d", "muse_p|muse_q", "muse_i|muse_j", "muse_k|muse_l",
  ]), "growth_7d tie must rank by growth_30d then pairKey: " + JSON.stringify(g20));
  const s1Featured = r.featured.filter((e) => e.a === "muse_s1" || e.b === "muse_s1");
  const s2Featured = r.featured.filter((e) => e.a === "muse_s2" || e.b === "muse_s2");
  ok(s1Featured.length === 1 && s2Featured.length === 1,
     "at most ONE row per socialite within the first 10");
  ok(r.rest.map((e) => e.pair)[0] === "muse_s1|muse_e", "deferred s1 row continues after the divider (ranked position)");
  ok(r.rest.some((e) => e.pair === "muse_s2|muse_f"), "deferred s2 row continues after the divider");
  ok(!r.featured.some((e) => e.pair === "muse_m|muse_n") && !r.rest.some((e) => e.pair === "muse_m|muse_n"),
     "growth == 0 pairs are not 'growing now'");
  ok(Z.growingNow([], []).featured.length === 0 && Z.growingNow([], []).rest.length === 0,
     "empty edges → empty growing zone");
}

// ---- zone 2 cap: featured holds at most 10 rows --------------------------
{
  const capTest = [
    edge("muse_s1|muse_S", "muse_s1", "muse_S", 99, 99),
    edge("muse_s1|muse_T", "muse_s1", "muse_T", 98, 98),   // s1 repeat → deferred
    edge("muse_s2|muse_U", "muse_s2", "muse_U", 97, 97),
    edge("muse_s2|muse_V", "muse_s2", "muse_V", 96, 96),   // s2 repeat → deferred
  ];
  for (let i = 0; i <= 11; i++) {
    capTest.push(edge("muse_q" + i + "|muse_r" + i, "muse_q" + i, "muse_r" + i, 80 - i, 80 - i));
  }
  const r = Z.growingNow(capTest, ["muse_s1", "muse_s2"]);
  ok(r.featured.length === 10, "featured holds at most 10 rows, got " + r.featured.length);
  ok(r.featured[0].pair === "muse_s1|muse_S", "first-ranked socialite row is featured");
  ok(r.featured[1].pair === "muse_s2|muse_U", "the next socialite's FIRST row still features");
  ok(r.rest[0].pair === "muse_s1|muse_T" && r.rest[1].pair === "muse_s2|muse_V",
     "deferred socialite rows continue right after the divider, keeping ranked order");
  ok(r.rest[2].pair === "muse_q8|muse_r8", "overflow non-socialite rows follow after the divider");
  const s1InFeat = r.featured.filter((e) => e.a === "muse_s1").length;
  ok(s1InFeat === 1, "one-per-socialite cap inside the 10");
}

// ---- zone 3: NEW SPARKS ---------------------------------------------------
// public-3: first seen is a plain DATE (date-level evidence) — the window
// test moves to date granularity: a date parses to its UTC midnight, so the
// inclusive/exclusive boundary runs on dates against the exact anchor.
{
  const anchor = "2026-10-05T22:01:00Z";   // anchor − 30d = 2026-09-05T22:01Z
  const rows = [
    edge("muse_a|muse_b", "muse_a", "muse_b", 0, 0, 2, "2026-10-05"),
    edge("muse_k|muse_l", "muse_k", "muse_l", 0, 0, 2, "2026-10-05"),
    edge("muse_m|muse_n", "muse_m", "muse_n", 0, 0, 2, "2026-10-05"),
    edge("muse_c|muse_d", "muse_c", "muse_d", 0, 0, 2, "2026-09-25"),   // 10d old
    edge("muse_e|muse_f", "muse_e", "muse_f", 0, 0, 2, "2026-09-06"),   // inside the boundary date → in
    edge("muse_g|muse_h", "muse_g", "muse_h", 0, 0, 2, "2026-09-05"),   // midnight before the 30d boundary → out
    edge("muse_i|muse_j", "muse_i", "muse_j", 0, 0, 2, "2026-08-01"),   // 40d+ → out
  ];
  const r = Z.newSparks(rows, anchor, { days: 30, cap: 12 });
  const got = r.featured.map((e) => e.pair);
  ok(JSON.stringify(got) === JSON.stringify([
    "muse_a|muse_b", "muse_k|muse_l", "muse_m|muse_n", "muse_c|muse_d", "muse_e|muse_f",
  ]), "newest first, ties by pairKey, exact-30d boundary included, older excluded: " + JSON.stringify(got));
  ok(r.rest.length === 0, "no rest when under the cap");
  // cap 12 with 14 fresh pairs → 12 featured + 2 rest
  const many = [];
  for (let i = 0; i < 14; i++) {
    many.push(edge("muse_x" + i + "|muse_y" + i, "muse_x" + i, "muse_y" + i, 0, 0, 2,
      "2026-10-05"));
  }
  const r12 = Z.newSparks(many, anchor, { days: 30, cap: 12 });
  ok(r12.featured.length === 12 && r12.rest.length === 2,
     "12-row cap + divider rest, got " + r12.featured.length + "/" + r12.rest.length);
  ok(Z.newSparks([], anchor).featured.length === 0, "empty edges → empty New Sparks");
  const bad = Z.newSparks(rows, "not-a-date");
  ok(bad.featured.length === 0 && bad.rest.length === 0, "unreadable anchor → honest empty state, not an error");
}

// ---- zone 4 + zone 5 + the v1.2.5 showcase trim ---------------------------
{
  const rows = [
    edge("muse_a|muse_b", "muse_a", "muse_b", 0, 0, 6),
    edge("muse_c|muse_d", "muse_c", "muse_d", 0, 0, 30),
    edge("muse_a|muse_d", "muse_a", "muse_d", 0, 0, 6),
  ];
  const bonds = Z.allBonds(rows);
  ok(bonds.length === 3 && bonds[0].pair === "muse_c|muse_d", "allBonds: full table by warmth (tiebreak pairKey)");
  ok(bonds[1].pair === "muse_a|muse_b" && bonds[2].pair === "muse_a|muse_d", "allBonds tiebreak pairKey");
  const museA = Z.musePairs(rows, "muse_a");
  ok(museA.length === 2 && museA[0].pair === "muse_a|muse_b", "musePairs: a's pairs, strongest first");
  ok(Z.musePairs(rows, "muse_zz").length === 0, "musePairs: unknown muse → empty, honest");

  // v1.2.5 topBonds: the default-page showcase — the highest relationships
  const spread = [];
  for (let i = 0; i < 14; i++) {
    // warmth 30-3 descending (ties at 15 and 9 → pairKey order decides)
    const w = i < 5 ? 15 : (i < 10 ? 9 : 3);
    spread.push(edge("muse_k" + i + "|muse_r" + (13 - i), "muse_k" + i, "muse_r" + (13 - i), 0, 0, w));
  }
  const before = JSON.stringify(spread.map((e) => e.pair));
  const top = Z.topBonds(spread);
  ok(top.length === 10, "topBonds defaults to the top 10, got " + top.length);
  ok(top.every((e, i) => i === 0 || num2(e.warmth) <= num2(top[i - 1].warmth)),
     "topBonds: warmth desc");
  ok(top.filter((e) => e.warmth === 9).every((e, i, a) => i === 0 || e.pair > a[i - 1].pair),
     "topBonds: stable pairKey-asc tiebreak within equal warmth");
  ok(top.every((e) => e.warmth >= 9) && top.every((e) => e.warmth !== 3),
     "topBonds: the trim keeps only the strongest band (warmth 15s and 9s)");
  ok(JSON.stringify(spread.map((e) => e.pair)) === before, "topBonds must not mutate the input");
  ok(Z.topBonds(spread, { cap: 3 }).length === 3, "topBonds honors the cap");
  ok(Z.topBonds(spread, { cap: 0 }).length === 0, "topBonds with cap 0 → empty, honest");
  ok(Z.topBonds([]).length === 0, "topBonds: empty edges → empty, honest");
  ok(Z.topBonds(spread, { cap: -1 }).length === 10, "topBonds ignores a nonsensical cap and keeps the default");
  const few = [edge("muse_p|muse_q", "muse_p", "muse_q", 0, 0, 4)];
  ok(Z.topBonds(few).length === 1, "topBonds: fewer than the cap → everything, in order");
}

function num2(v) { return (typeof v === "number" && isFinite(v)) ? v : 0; }

// ---- focused view: focusCardView (v1.2.2) — the homepage card view-model --
{
  const e = { pair: "muse_a|muse_b", a: "muse_a", a_name: "Anastasia", b: "muse_b", b_name: "Nimbus",
              warmth: 44, tier: "companion", growth_7d: 4, growth_30d: 9,
              first_seen_date: "2026-09-12", last_seen_date: "2026-10-05",
              context: { directed_count: 0, reciprocal_directed: false, flow_count: 0, mb_flow_total: 0 } };
  const v = Z.focusCardView(e);
  ok(v.tier === "companion" && v.label === "Anastasia ✦ Nimbus", "focusCardView: tier + names ✦ label");
  ok(v.warmth === 44 && v.barPct === 100, "focusCardView: warmth kept, bar width capped at 100");
  ok(v.growth7d === 4 && v.growth30d === 9, "focusCardView: reported growth rates carried through");
  ok(v.firstObs === "2026-09-12" && v.lastSeen === "2026-10-05", "focusCardView: first/last seen DATES (public-3 — dates only)");
  ok(e.warmth === 44 && e.tier === "companion", "focusCardView must not mutate the edge");
  ok(Z.focusCardView(null) === null, "focusCardView: missing edge → null");
  const bare = Z.focusCardView({ a_name: "A", b_name: "B" });
  ok(bare.tier === null && bare.warmth === 0 && bare.growth7d === 0 && bare.firstObs === null,
     "focusCardView: missing tier/growth/first normalize honestly");
}

// ---- shared display formatter: displayWarmth (v1.2.14) --------------------
{
  const dw = Z.displayWarmth;
  const cases = [
    [4.060606061, "4.06"],          // the audit's example: 2 decimals, zeros trimmed
    [4.5, "4.5"],
    [4.0, "4"],                     // integral → plain
    [2, "2"], [30, "30"], [6, "6"], [0, "0"],
    [0.076923077, "0.08"],          // the audit's example rounds to 2 decimals
    [0.009, "<0.01"],               // below the hundredth → the explicit floor
    [0.01, "0.01"],
    [100.1, "100.1"],
    [-3, "-3"],
    [NaN, "—"], [Infinity, "—"], [-Infinity, "—"], [undefined, "—"], [null, "—"],
  ];
  for (const [value, expected] of cases) {
    ok(dw(value) === expected,
       "displayWarmth(" + value + ") must render " + JSON.stringify(expected) +
       ", got " + JSON.stringify(dw(value)));
  }
}

// ---- zone 1: ids + per-load shuffle (order-only) --------------------------
{
  const roll = [
    { muse_id: "muse_s1", name: "S1" }, { muse_id: "muse_s2", name: "S2" }, { muse_id: "muse_s3", name: "S3" },
    { muse_id: "muse_s4", name: "S4" }, {}, null, { muse_id: "" },
  ];
  const ids = Z.socialiteIds(roll);
  ok(JSON.stringify(ids) === JSON.stringify(["muse_s1", "muse_s2", "muse_s3", "muse_s4"]),
     "socialiteIds extracts valid entries only");
  const base = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const s1 = Z.shuffle(base), s2 = Z.shuffle(base);
  ok(s1.length === base.length && JSON.stringify(s1.slice().sort((a, b) => a - b)) === JSON.stringify(base),
     "shuffle preserves the multiset and length");
  ok(JSON.stringify(s1) !== JSON.stringify(s2), "shuffle randomizes per load (two draws differ)");
}

if (failures) {
  console.error("zone rules check FAILED with " + failures + " violation(s)");
  process.exit(1);
}
console.log("zone rules check OK: growth ranking, Soc×Soc exclusion, one-per-cap, 10-row cap, New Sparks, allBonds, topBonds (v1.2.5 showcase trim), musePairs, focusCardView, displayWarmth (v1.2.14 shared formatter), socialiteIds, shuffle");
process.exit(0);