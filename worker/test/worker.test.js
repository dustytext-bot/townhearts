/**
 * TownHearts worker tests — Phase 1 (local, synthetic fixtures only).
 *
 * Covers every locally testable case in the brief's Required tests list:
 * status meta echoes the fixture, graph passthrough preserves schema/values,
 * conditional requests (ETag / If-Modified-Since → 304), pair lookup equals
 * the published index entry, reversed params, unknown pair 404, missing /
 * invalid params 400, honest origin failure (502) + explicitly stale-marked
 * cached copy within the grace window, analytics failure never blocking a
 * read, optional identity headers never changing responses, no prohibited
 * fields in any response or analytics blob, cache tolerance (per-isolate
 * TTL vs the 7h staleness contract — see the documented notes below).
 *
 * The edge-cloud cache TTL of the deployed Worker is not locally testable;
 * the caching contract is documented in src/index.js: per-isolate TTL
 * (default 120s, configurable via CACHE_TTL_SECONDS) is far below the
 * published 7h staleness window, so a newer published sampled_at becomes
 * visible within at most ~2 minutes of the next /v1/* request. On the
 * deployed Worker the same TTL is additionally enforced at the edge by
 * the response Cache-Control headers (public, max-age=120 for graph,
 * max-age=60 for status/pair).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { makeGraph, pairKey } from './fixtures/make_fixture.js';
import {
  makeAnalytics,
  makeEnv,
  resetHarness,
  workerRequest,
  runWorker,
  bodyJson,
} from './harness.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(here, 'fixtures', 'graph_fixture.json');
const SCHEMA_PATH = path.join(here, '..', '..', 'data', 'graph.schema.json');

/** Structural schema-correctness check against the published contract. */
function assertSchemaShape(graph) {
  assert.deepEqual(
    Object.keys(graph).sort(),
    ['edges', 'index', 'index_names', 'meta', 'muses'],
    'top-level keys must match the published schema',
  );
  const requiredEdge = [
    'pair', 'a', 'b', 'a_name', 'b_name', 'warmth', 'tier',
    'qualifying_sessions', 'active_days', 'evidence_partial',
    'co_loc_weight', 'co_locations', 'growth_7d', 'growth_30d',
    'shared_days', 'recent_shared_samples_30d', 'largest_shared_group',
    'first_seen_date', 'last_seen_date', 'common_places', 'context',
  ];
  for (const edge of graph.edges) {
    for (const field of requiredEdge) assert.ok(field in edge, `edge missing ${field}`);
  }
  assert.equal(Object.keys(graph.index).length, graph.edges.length);
  assert.equal(Object.keys(graph.index_names).length, graph.edges.length);
  for (const [key, edge] of Object.entries(graph.index)) {
    assert.equal(key, edge.pair, 'index keys must be the canonical pair keys');
  }
  for (const key of Object.keys(graph.index_names)) {
    assert.match(key, /^[^|]+\|[^|]+$/, 'index_names keys must be NameA|NameB');
  }
}

/** Keys that must never appear in any response body (privacy contract). */
const PROHIBITED_KEYS = [
  'ip', 'ip_address', 'user_agent', 'user-agent', 'cookie', 'authorization',
  'speech', 'whisper', 'transcript', 'preview', 'raw_headers', 'query_string',
];

function assertNoProhibitedFields(body, label) {
  const found = [];
  const walk = (value, trail) => {
    if (value === null || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      const key = k.toLowerCase();
      if (PROHIBITED_KEYS.some((p) => key === p)) found.push(`${trail}.${k}`);
      walk(v, `${trail}.${k}`);
    }
  };
  walk(body, label);
  assert.deepEqual(found, [], `${label} must not expose prohibited fields`);
}

const FORBIDDEN_HEADER_NAMES = [
  'authorization', 'cookie', 'referer', 'user-agent', 'x-forwarded-for',
  'cf-connecting-ip', 'cf-ipcountry', 'x-real-ip',
];

const FORBIDDEN_BLOB_VALUES = [
  'speech', 'whisper', 'transcript', 'preview', 'query', '?', '|',
];

test.beforeEach(() => resetHarness());

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

test('/v1/status echoes the fixture meta fields', async () => {
  const graph = makeGraph();
  const res = await runWorker(
    workerRequest('/v1/status'),
    makeEnv({ originBody: graph }),
  );
  assert.equal(res.status, 200);
  const body = await bodyJson(res);
  assert.equal(body.service, 'TownHearts');
  assert.equal(body.api_version, 'v1');
  assert.equal(body.source, 'cloudflare-worker');
  assert.equal(body.meta.schema, graph.meta.schema_version);
  assert.equal(body.meta.publisher, graph.meta.publisher_version);
  assert.equal(body.meta.scoring, graph.meta.scoring_version);
  assert.equal(body.meta.epoch, graph.meta.epoch);
  assert.equal(body.meta.sampled_at, graph.meta.sampled_at);
  assert.equal(body.meta.collection_status, graph.meta.collection_status);
  assert.equal(body.meta.cadence_hours, graph.meta.cadence_hours);
  assert.equal(body.meta.stale_after_hours, graph.meta.stale_after_hours);
  assert.equal(body.fallback.static_graph_url,
    'https://dustytext-bot.github.io/townhearts/data/graph.json');
  assertNoProhibitedFields(body, 'status');
});

test('/v1/status staleness is fresh for a recent sampled_at', async () => {
  const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h old
  const graph = makeGraph({ sampledAt: fresh });
  const res = await runWorker(
    workerRequest('/v1/status'),
    makeEnv({ originBody: graph }),
  );
  const body = await bodyJson(res);
  assert.equal(body.staleness.state, 'fresh');
  assert.equal(body.staleness.is_stale, false);
  assert.equal(typeof body.staleness.age_hours, 'number');
});

test('/v1/status staleness is stale beyond stale_after_hours', async () => {
  const old = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(); // 9h old
  const graph = makeGraph({ sampledAt: old });
  const res = await runWorker(
    workerRequest('/v1/status'),
    makeEnv({ originBody: graph }),
  );
  const body = await bodyJson(res);
  assert.equal(body.staleness.state, 'stale');
  assert.equal(body.staleness.is_stale, true);
});

// ---------------------------------------------------------------------------
// Graph passthrough
// ---------------------------------------------------------------------------

test('/v1/graph preserves the published schema and values', async () => {
  const graph = makeGraph();
  const res = await runWorker(
    workerRequest('/v1/graph'),
    makeEnv({ originBody: graph }),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /application\/json/);
  const body = await bodyJson(res);
  assert.deepEqual(body, graph); // byte-for-byte meaning preserved
  assertSchemaShape(body);
  assertNoProhibitedFields(body, 'graph');
  assert.equal('stale' in body, false, 'fresh passthrough must not be stale-marked');
});

test('committed fixture is byte-stable and schema-correct', () => {
  const committed = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  assertSchemaShape(committed);
  // Deterministic regeneration must reproduce the committed bytes.
  const regenerated = JSON.stringify(makeGraph(), null, 2) + '\n';
  assert.equal(
    regenerated,
    readFileSync(FIXTURE_PATH, 'utf8'),
    'fixture generator output must be deterministic',
  );
  assert.equal('stale' in committed, false);
});

test('/v1/graph ETag is a hash of sampled_at and If-None-Match returns 304', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph, cacheTtlSeconds: 0 });
  const first = await runWorker(workerRequest('/v1/graph'), env);
  assert.equal(first.status, 200);
  const etag = first.headers.get('ETag');
  assert.match(etag, /^"[0-9a-f]{16}"$/);
  // Same sampled_at must produce the same ETag.
  const second = await runWorker(
    workerRequest('/v1/graph', { headers: { 'If-None-Match': etag } }),
    env,
  );
  assert.equal(second.status, 304);
  assert.equal(await second.text(), '');
  // A different sampled_at must produce a different ETag.
  const newer = makeGraph({ sampledAt: '2026-10-02T00:00:00Z' });
  const envNew = makeEnv({ originBody: newer, cacheTtlSeconds: 0 });
  const third = await runWorker(workerRequest('/v1/graph'), envNew);
  assert.notEqual(third.headers.get('ETag'), etag);
});

test('/v1/graph honors If-Modified-Since with a 304', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph, cacheTtlSeconds: 0 });
  const res = await runWorker(
    workerRequest('/v1/graph', {
      headers: { 'If-Modified-Since': new Date().toUTCString() },
    }),
    env,
  );
  assert.equal(res.status, 304);
  // A date strictly BEFORE sampled_at must re-fetch (200).
  const res2 = await runWorker(
    workerRequest('/v1/graph', {
      headers: { 'If-Modified-Since': 'Mon, 01 Jan 2001 00:00:00 GMT' },
    }),
    env,
  );
  assert.equal(res2.status, 200);
});

// ---------------------------------------------------------------------------
// Pair lookup
// ---------------------------------------------------------------------------

test('/v1/pair returns exactly the published index entry', async () => {
  const graph = makeGraph();
  const [idA, idB] = ['muse_alpha', 'muse_beta'];
  const res = await runWorker(
    workerRequest(`/v1/pair?a=${idA}&b=${idB}`),
    makeEnv({ originBody: graph }),
  );
  assert.equal(res.status, 200);
  const body = await bodyJson(res);
  assert.deepEqual(body, graph.index[pairKey(idA, idB)]);
  assertNoProhibitedFields(body, 'pair');
});

test('/v1/pair reversed parameters yield the same canonical pair', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph });
  const fwd = await bodyJson(
    await runWorker(
      workerRequest('/v1/pair?a=muse_alpha&b=muse_beta'), env));
  const rev = await bodyJson(
    await runWorker(
      workerRequest('/v1/pair?a=muse_beta&b=muse_alpha'), env));
  assert.deepEqual(rev, fwd);
});

test('/v1/pair unknown pair returns the documented 404', async () => {
  const graph = makeGraph();
  const res = await runWorker(
    workerRequest('/v1/pair?a=muse_alpha&b=muse_delta'),
    makeEnv({ originBody: graph }),
  );
  assert.equal(res.status, 404);
  const body = await bodyJson(res);
  assert.equal(body.error, 'pair_not_found');
  assert.equal(body.pair, 'muse_alpha|muse_delta');
  assert.equal(typeof body.note, 'string');
});

test('/v1/pair sub-floor ambient-only pairs answer the honest not-found', async () => {
  // A pair absent from the index (no published edge) must 404 — never a
  // fabricated or recalculated entry.
  const graph = makeGraph();
  const res = await runWorker(
    workerRequest('/v1/pair?a=muse_gamma&b=muse_delta'),
    makeEnv({ originBody: graph }),
  );
  assert.equal(res.status, 404);
  assert.equal((await bodyJson(res)).error, 'pair_not_found');
});

test('/v1/pair missing and invalid params return a clear 400', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph });
  const cases = [
    '/v1/pair',
    '/v1/pair?a=muse_alpha',
    '/v1/pair?b=muse_beta',
    '/v1/pair?a=&b=muse_beta',
    '/v1/pair?a=muse_alpha&b=%20',
    `/v1/pair?a=${'x'.repeat(129)}&b=muse_beta`,
  ];
  for (const path of cases) {
    const res = await runWorker(workerRequest(path), env);
    assert.equal(res.status, 400, `expected 400 for ${path}`);
    const body = await bodyJson(res);
    assert.equal(body.error, 'invalid_params', path);
  }
});

test('/v1/pair exact case-sensitive name lookup via index_names', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph });
  const res = await runWorker(
    workerRequest('/v1/pair?a=Alpha&b=Beta'),
    env,
  );
  assert.equal(res.status, 200);
  const body = await bodyJson(res);
  assert.deepEqual(body.pair, graph.index_names['Alpha|Beta']);
  // Reversed display names resolve to the same entry.
  const rev = await bodyJson(
    await runWorker(workerRequest('/v1/pair?a=Beta&b=Alpha'), env));
  assert.deepEqual(rev.pair, body.pair);
});

test('/v1/pair name lookup is exact and case-sensitive (documented)', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph });
  for (const path of [
    '/v1/pair?a=alpha&b=Beta', // case variation → not found
    '/v1/pair?a=Alph&b=Beta', // prefix → not found
  ]) {
    const res = await runWorker(workerRequest(path), env);
    assert.equal(res.status, 404, path);
    assert.equal((await bodyJson(res)).error, 'pair_not_found', path);
  }
});

// ---------------------------------------------------------------------------
// Origin failure / honesty
// ---------------------------------------------------------------------------

test('/v1/graph origin failure returns honest 502 when no cache exists', async () => {
  const env = makeEnv({ originError: new Error('synthetic origin down') });
  const res = await runWorker(workerRequest('/v1/graph'), env);
  assert.equal(res.status, 502);
  const body = await bodyJson(res);
  assert.equal(body.error, 'origin_unavailable');
  assert.equal('stale' in body, false, 'never serve stale data as current');
});

test('/v1/graph origin failure serves cached copy ONLY with explicit stale marker', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph, cacheTtlSeconds: 0 });
  // First call populates the cache (origin healthy).
  const first = await runWorker(workerRequest('/v1/graph'), env);
  assert.equal(first.status, 200);

  // Now the origin dies — with the TTL expired the refetch fails, and the
  // cached copy may be served ONLY within the grace window, marked stale.
  const envDown = makeEnv({ originError: new Error('synthetic origin down'), cacheTtlSeconds: 0 });
  const res = await runWorker(workerRequest('/v1/graph'), envDown);
  assert.equal(res.status, 200);
  const body = await bodyJson(res);
  assert.equal(body.stale, true);
  assert.equal(typeof body.reason, 'string');
  assert.deepEqual({ ...body, stale: undefined, reason: undefined },
    { ...graph, stale: undefined, reason: undefined });
});

test('/v1/pair origin failure is honest (502 or explicitly stale cached copy)', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph, cacheTtlSeconds: 0 });
  await runWorker(workerRequest('/v1/pair?a=muse_alpha&b=muse_beta'), env);

  const envDown = makeEnv({ originError: new Error('synthetic origin down'), cacheTtlSeconds: 0 });
  const res = await runWorker(
    workerRequest('/v1/pair?a=muse_alpha&b=muse_beta'), envDown);
  assert.equal(res.status, 200);
  const body = await bodyJson(res);
  assert.equal(body.stale, true, 'stale-served pair must be explicitly marked');
  assert.deepEqual(body.pair, graph.index['muse_alpha|muse_beta']);

  // No cache at all → honest 502.
  resetHarness();
  const envCold = makeEnv({ originError: new Error('synthetic origin down') });
  const res2 = await runWorker(
    workerRequest('/v1/pair?a=muse_alpha&b=muse_beta'), envCold);
  assert.equal(res2.status, 502);
  assert.equal((await bodyJson(res2)).error, 'origin_unavailable');
});

test('/v1/status origin failure without cache is an honest 502', async () => {
  const env = makeEnv({ originError: new Error('synthetic origin down') });
  const res = await runWorker(workerRequest('/v1/status'), env);
  assert.equal(res.status, 502);
  assert.equal((await bodyJson(res)).error, 'origin_unavailable');
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

test('analytics records endpoint/status/cache/version, never pair params or headers', async () => {
  const graph = makeGraph();
  const analytics = makeAnalytics();
  const env = makeEnv({ originBody: graph, analytics });
  await runWorker(
    workerRequest('/v1/pair?a=muse_alpha&b=muse_beta'), env);
  await runWorker(workerRequest('/v1/graph'), env);
  await runWorker(workerRequest('/v1/status'), env);

  assert.equal(analytics.calls.length, 3);
  const endpoints = analytics.calls.map((c) => c.blobs[0]).sort();
  assert.deepEqual(endpoints, ['graph', 'pair', 'status']);
  for (const call of analytics.calls) {
    assert.equal(call.blobs.length, 6);
    assert.match(call.blobs[1], /^[2456]xx$/);
    assert.match(call.blobs[2], /^(hit|miss)$/);
    assert.equal(call.blobs[3], 'v1');
    assert.equal(call.blobs[4], '', 'no client header → empty blob');
    assert.equal(call.blobs[5], '', 'no muse header → empty blob');
    assert.equal(call.index, 'anon');
    assert.equal(call.doubles.length, 1);
    assert.equal(typeof call.doubles[0], 'number');
    // Prohibited content: no pair key, no URL/query fragments, no headers.
    const serialized = JSON.stringify(call);
    for (const forbidden of [
      'muse_alpha', 'muse_beta', 'a=', 'b=', '|',
      'X-TownHearts', 'headers', 'ip', 'user-agent',
    ]) {
      assert.equal(serialized.includes(forbidden), false,
        `analytics blob must not contain ${forbidden}`);
    }
  }
});

test('optional identity headers are recorded but never change responses', async () => {
  const graph = makeGraph();
  const analytics = makeAnalytics();
  const env = makeEnv({ originBody: graph, analytics });
  const plain = await runWorker(
    workerRequest('/v1/pair?a=muse_alpha&b=muse_beta'), env);
  const identified = await runWorker(
    workerRequest('/v1/pair?a=muse_alpha&b=muse_beta', {
      headers: {
        'X-TownHearts-Client': 'openclaw',
        'X-TownHearts-Muse-ID': 'muse_alpha',
      },
    }),
    env,
  );
  assert.equal(plain.status, identified.status);
  assert.equal(await plain.text(), await identified.text(),
    'identity headers must not change the response body');
  const call = analytics.calls.at(-1);
  assert.equal(call.blobs[4], 'openclaw');
  assert.equal(call.blobs[5], 'muse_alpha');
  assert.equal(call.index, 'openclaw');
});

test('optional identity headers work on /v1/status and /v1/graph too', async () => {
  const graph = makeGraph();
  const analytics = makeAnalytics();
  const env = makeEnv({ originBody: graph, analytics });
  for (const path of ['/v1/status', '/v1/graph']) {
    const res = await runWorker(workerRequest(path, {
      headers: { 'X-TownHearts-Client': 'testclient', 'X-TownHearts-Muse-ID': 'muse_beta' },
    }), env);
    assert.equal(res.status, 200);
  }
  assert.equal(analytics.calls.length, 2);
  assert.equal(analytics.calls[0].index, 'testclient');
});

test('analytics failure never blocks a data response', async () => {
  const graph = makeGraph();
  const env = makeEnv({
    originBody: graph,
    analytics: makeAnalytics({ throwing: true }),
  });
  for (const path of ['/v1/status', '/v1/graph', '/v1/pair?a=muse_alpha&b=muse_beta']) {
    const res = await runWorker(workerRequest(path), env);
    assert.equal(res.status, 200, `${path} must survive analytics failure`);
  }
});

test('missing analytics binding is not an error (feature-degraded)', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph });
  delete env.TOWNHEARTS_METRICS;
  const res = await runWorker(workerRequest('/v1/status'), env);
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// Caching tolerance
// ---------------------------------------------------------------------------

test('within the cache TTL a newer published sampled_at is not yet served (documented)', async () => {
  const old = makeGraph(); // sampled_at 2026-10-01
  const newer = makeGraph({ sampledAt: '2026-10-02T00:00:00Z' });
  const env = makeEnv({ originBody: old, cacheTtlSeconds: 3600 });
  const first = await runWorker(workerRequest('/v1/status'), env);
  assert.equal((await bodyJson(first)).meta.sampled_at, old.meta.sampled_at);

  // The origin publishes a new snapshot moments later.
  const envNew = makeEnv({ originBody: newer, cacheTtlSeconds: 3600 });
  const second = await runWorker(workerRequest('/v1/status'), envNew);
  assert.equal((await bodyJson(second)).meta.sampled_at, old.meta.sampled_at,
    'within TTL the cached copy is served (production TTL is 120s, far below the 7h staleness window)');
});

test('after the cache TTL a newer published sampled_at is served immediately', async () => {
  const old = makeGraph();
  const newer = makeGraph({ sampledAt: '2026-10-02T00:00:00Z' });
  const env = makeEnv({ originBody: old, cacheTtlSeconds: 0 }); // TTL 0 → refetch
  await runWorker(workerRequest('/v1/graph'), env);
  const envNew = makeEnv({ originBody: newer, cacheTtlSeconds: 0 });
  const res = await runWorker(workerRequest('/v1/graph'), envNew);
  const body = await bodyJson(res);
  assert.equal(body.meta.sampled_at, newer.meta.sampled_at);
  assert.equal(body.meta.cadence_hours, newer.meta.cadence_hours);
});

// ---------------------------------------------------------------------------
// CORS, routing, methods
// ---------------------------------------------------------------------------

test('CORS headers on every response; OPTIONS answers 204', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph });
  const preflight = await runWorker(
    workerRequest('/v1/pair?a=muse_alpha&b=muse_beta', { method: 'OPTIONS' }), env);
  assert.equal(preflight.status, 204);
  assert.equal(await preflight.text(), '');
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');

  for (const path of ['/v1/status', '/v1/graph', '/v1/pair?a=muse_alpha&b=muse_beta']) {
    const res = await runWorker(workerRequest(path), env);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*', path);
    assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS', path);
  }
  const notFound = await runWorker(workerRequest('/v1/unknown'), env);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.headers.get('Access-Control-Allow-Origin'), '*');
});

test('non-GET methods on known endpoints return 405 with Allow', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph });
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
    const res = await runWorker(
      workerRequest('/v1/graph', { method }), env);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('Allow'), 'GET, OPTIONS');
  }
});

// ---------------------------------------------------------------------------
// Response-header hygiene
// ---------------------------------------------------------------------------

test('no prohibited request headers are ever echoed into responses', async () => {
  const graph = makeGraph();
  const env = makeEnv({ originBody: graph });
  const res = await runWorker(workerRequest('/v1/graph', {
    headers: {
      Cookie: 'session=secret',
      Authorization: 'Bearer secret',
      'X-TownHearts-Client': 'openclaw',
      'X-TownHearts-Muse-ID': 'muse_alpha',
    },
  }), env);
  const body = await bodyJson(res);
  assertNoProhibitedFields(body, 'graph-with-secret-headers');
  const headersText = JSON.stringify([...res.headers.entries()]);
  for (const name of FORBIDDEN_HEADER_NAMES) {
    assert.equal(headersText.toLowerCase().includes(name), false,
      `response headers must not echo ${name}`);
  }
});
