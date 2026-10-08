/**
 * Synthetic fixture generator for the TownHearts worker tests.
 *
 * Produces a fake-but-SCHEMA-CORRECT graph.json (the published public-3
 * contract in data/graph.schema.json): top-level {meta, muses, edges,
 * index, index_names}; every index/index_names entry carries the full
 * required edge field set; no fields absent from the sanitized data.
 *
 * Deterministic and seeded — the committed fixture is byte-stable.
 *
 * Usage:
 *   import { makeGraph } from './make_fixture.js';
 *   node test/fixtures/make_fixture.js            # writes graph_fixture.json
 */

// mulberry32 — tiny seeded PRNG so the fixture is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Canonical pair key, exactly the published contract: sorted, pipe-joined. */
export function pairKey(a, b) {
  return [a, b].sort().join('|');
}

/**
 * Build the synthetic graph.
 * @param {object} opts - overrides; `sampledAt` (ISO string) lets tests make
 *   fresh/stale variants without touching the committed fixture.
 */
export function makeGraph(opts = {}) {
  const seed = opts.seed === undefined ? 20261008 : opts.seed;
  const rand = mulberry32(seed);

  const muses = {
    muse_alpha: 'Alpha',
    muse_beta: 'Beta',
    muse_gamma: 'Gamma',
    muse_delta: 'Delta',
  };

  const namesById = {
    muse_alpha: 'Alpha',
    muse_beta: 'Beta',
    muse_gamma: 'Gamma',
    muse_delta: 'Delta',
  };

  // Edge plans: [idA, idB, warmth, tier, sessions, days, coLocations]
  const plans = [
    ['muse_alpha', 'muse_beta', 12, 'friendly', 4, 3, 9],
    ['muse_alpha', 'muse_gamma', 30, 'bond', 15, 21, 18],
    ['muse_beta', 'muse_gamma', 1.5, null, 1, 1, 2],
  ];

  const edges = plans.map(([a, b, warmth, tier, sessions, days, coLocations]) => ({
    pair: pairKey(a, b),
    a,
    b,
    a_name: namesById[a],
    b_name: namesById[b],
    warmth,
    tier,
    qualifying_sessions: sessions,
    active_days: days,
    evidence_partial: false,
    co_loc_weight: warmth,
    co_locations: coLocations,
    growth_7d: Math.round(rand() * warmth * 100) / 100,
    growth_30d: warmth,
    shared_days: days,
    recent_shared_samples_30d: coLocations,
    largest_shared_group: 3,
    first_seen_date: '2026-09-28',
    last_seen_date: '2026-09-30',
    common_places: { marketplace: coLocations },
    context: {
      directed_count: Math.floor(rand() * 20),
      reciprocal_directed: warmth >= 12,
      flow_count: 0,
      mb_flow_total: 0,
    },
  }));

  const index = {};
  const indexNames = {};
  for (const edge of edges) {
    index[edge.pair] = edge;
    indexNames[pairKey(edge.a_name, edge.b_name)] = edge;
  }

  const sampledAt = opts.sampledAt || '2026-10-01T00:00:00Z';

  const meta = {
    name: 'Townhearts (synthetic test fixture)',
    description:
      'Synthetic schema-correct graph used ONLY by the worker tests; not real TownHearts data.',
    schema_version: 'public-3',
    publisher_version: 'pub-1.3',
    scoring_version: 'co-presence-4',
    generated_at: sampledAt,
    sampled_at: sampledAt,
    collection_status: 'complete',
    source_window: '2026-09-28T00:00:00Z .. 2026-09-30T00:00:00Z (synthetic reads)',
    epoch: 4,
    epoch_started_at: '2026-09-28T00:00:00Z',
    data_coverage_started_at: '2026-09-28T00:00:00Z',
    scoring_epoch_introduced_at: '2026-09-28T00:00:00Z',
    cadence_hours: 3,
    stale_after_hours: 7,
    tiers: { acquaintance: 2, friendly: 6, companion: 14, bond: 30 },
    tier_observations: { acquaintance: 1, friendly: 3, companion: 7, bond: 15 },
    tier_gate: {
      rule: 'synthetic rule text',
      session_rule: 'synthetic session rule text',
      partial_rule: 'synthetic partial rule text',
      qualifying_sessions: { companion: 7, bond: 15 },
      active_days: { companion: 7, bond: 21 },
    },
    scoring: {
      formula: 'synthetic formula text',
      inputs: ['co_location_rows', 'group_size', 'passive_place_addressing'],
      context_not_scoring: ['flows'],
      crowd_dilution: 'synthetic crowd dilution text',
      place_classification: {
        version: 1,
        categories: [{ category: 'passive-ambient', place_aliases: ['campfire'] }],
        matching: 'synthetic matching text',
        addressed_rule: 'synthetic addressed rule text',
      },
    },
    method: 'synthetic method text',
    attribution: 'synthetic attribution text',
    name_collisions: [],
    reach: Object.fromEntries(
      Object.keys(muses).map((id, i) => [
        id,
        { unique_muses: 3, active_days: 3, places: 2 + (i % 2) },
      ]),
    ),
    socialites: [
      {
        muse_id: 'muse_alpha',
        name: 'Alpha',
        window: '30d',
        unique_muses: 6,
        active_days: 5,
        places: 4,
        scored_at: sampledAt,
        note: 'synthetic socialite row',
      },
    ],
    socialites_window: '30d',
  };

  return { meta, muses, edges, index, index_names: indexNames };
}

// CLI: regenerate the committed fixture (deterministic output).
if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'graph_fixture.json');
  fs.writeFileSync(out, JSON.stringify(makeGraph(), null, 2) + '\n');
  console.log(`wrote ${out}`);
}
