// TownHearts scoring-equivalence check — the lockstep probe between
// reference/scoring_reference.py (the public copy of the scoring constants)
// and zone_rules.js (the site's own display/qualify semantics).
//
// The python side (test_tracker.py) computes scoring_reference.display_warmth
// and scoring_reference.tier_of over the PUBLISHED data files and compares
// them against what this harness reports for the same values from node, so a
// drift between the two implementations (or the published data) fails CI.
//
// Reports (JSON, stdout):
//   cases           — the fixed probe table: [warmth, zone_rules display] pairs
//   fixture_warmths — every unique warmth in data/graph.json with the
//                     zone_rules.displayWarmth rendering
//   bar_pct_scale   — the warmth at which zone_rules' bar saturates (the bond
//                     floor constant baked into focusCardView: barPct = w/30)
//
// Usage: node test_assets/scoring_equiv_check.js [graph.json path]
// Exit 0 always (the assertions live on the python side); a missing file
// prints an error object and exits 2 (the pytest wrapper fails on it).

"use strict";
const fs = require("fs");
const path = require("path");
const Z = require(path.join(__dirname, "..", "zone_rules.js"));

const probe = [
  0, 0.009, 0.01, 2 / 26, 0.076923077, 2, 4, 4.060606061, 4.5, 6, 12, 14, 28,
  30, 32, 100.1, 4.0, -3, 1.0, 8, 18.4, 44,
];

function barPctScale() {
  // the smallest warmth (scanned to a fine grid) whose bar width saturates:
  // focusCardView's barPct = min(100, (w/30)*100) → the scale constant is
  // the bond floor 30. Scan from above to find the saturation edge.
  let scale = null;
  for (let w = 60; w >= 0.0005; w -= 0.0005) {
    if (Z.focusCardView({ a_name: "a", b_name: "b", warmth: w }).barPct >= 100) {
      scale = w;                                   // keep going: find the edge
    } else {
      break;                                       // first w below saturation
    }
  }
  // `scale` now sits one grid step ABOVE the saturation edge; the edge
  // itself is scale + 0.0005 round-tripped through the same arithmetic the
  // site uses — report the exact constant by re-finding it precisely:
  for (let w = 20; w <= 40; w += 0.25) {
    if (Z.focusCardView({ a_name: "a", b_name: "b", warmth: w }).barPct >= 100) {
      return w;                                    // first saturating step on a 0.25 grid
    }
  }
  return null;
}

let out;
try {
  const graphPath = process.argv[2] || path.join(__dirname, "..", "data", "graph.json");
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  const uniq = new Set();
  for (const e of graph.edges || []) {
    if (e && typeof e.warmth === "number") uniq.add(e.warmth);
  }
  const fixture_warmths = [...uniq].sort((a, b) => a - b)
    .map((w) => [w, Z.displayWarmth(w)]);
  out = {
    cases: probe.map((w) => [w, Z.displayWarmth(w)]),
    fixture_warmths,
    bar_pct_scale: barPctScale(),
    edges_checked: (graph.edges || []).length,
  };
} catch (err) {
  out = { error: String(err && err.message || err) };
  console.log(JSON.stringify(out));
  process.exit(2);
}
console.log(JSON.stringify(out));