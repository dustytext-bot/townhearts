/**
 * TownHearts agent-data Worker — Phase 1 (local build; NOT deployed).
 *
 * A thin, read-only, keyless adapter over the already-published sanitized
 * graph (data/graph.json on GitHub Pages). It never scores, never touches
 * the private database, and exposes exactly:
 *
 *   GET /v1/status — snapshot metadata + deterministic staleness state
 *                    (computed ONLY from sampled_at + stale_after_hours).
 *   GET /v1/graph  — passthrough of the published graph (meaning and values
 *                    preserved; ETag from sampled_at; If-None-Match /
 *                    If-Modified-Since → 304; honest 502 or explicitly
 *                    stale-marked cached copy within a 24h grace window).
 *   GET /v1/pair?a=<id>&b=<id> — one pair read from the PUBLISHED index
 *                    (canonical key = the two ids sorted, pipe-joined).
 *                    If the id-key lookup misses, an exact case-sensitive
 *                    lookup of the same sorted key in the published
 *                    index_names is tried (convenience only: names can
 *                    change and collide; ids are canonical).
 *
 * Privacy contract (enforced by tests):
 *   - No pair params, IP addresses, or raw headers are logged anywhere.
 *   - X-TownHearts-Client / X-TownHearts-Muse-ID are OPTIONAL: recorded
 *     (muse id as a blob) when present, never required, never echoed,
 *     never affect any response body.
 *   - Analytics Engine writes are wrapped so failure never blocks a read.
 *   - No KV binding. Read-only against one canonical origin URL.
 *
 * Caching contract (documented; edge-cache TTL itself is not testable
 * locally): the Worker keeps a per-isolate cache of the last successful
 * origin fetch with a conservative TTL (CACHE_TTL_SECONDS, default 120s)
 * that is far below the published 7h staleness window, so a newer
 * published sampled_at becomes visible within at most ~2 minutes of its
 * next /v1/* request. After a cache-TTL expiry the origin is re-fetched;
 * on repeated origin failure a cached copy may be served only within the
 * 24h grace window and only with an explicit top-level {stale: true,
 * reason} marker (or an honest 502 when no copy exists / grace expired).
 */

const SERVICE = 'TownHearts';
const API_VERSION = 'v1';
/** Canonical static fallback URL — always the published GitHub Pages copy. */
const FALLBACK_STATIC_URL =
  'https://dustytext-bot.github.io/townhearts/data/graph.json';
/** Default origin if ORIGIN_DATA_URL is not configured. */
const DEFAULT_ORIGIN = FALLBACK_STATIC_URL;
/** Grace window for serving a cached copy when the origin fails (hours). */
const GRACE_WINDOW_HOURS = 24;
/** Default per-isolate cache TTL for the origin fetch (seconds). */
const DEFAULT_CACHE_TTL_SECONDS = 120;
/** Query-parameter sanity cap (muse ids / names are far shorter). */
const MAX_PARAM_LENGTH = 128;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'X-TownHearts-Client, X-TownHearts-Muse-ID',
  'Access-Control-Max-Age': '86400',
};

/**
 * Per-isolate cache of the last successful origin fetch. Single variable
 * (not a Map) — the Worker reads exactly one canonical document.
 * Shape: {graph, etag, sampledAt, fetchedAt, lastGoodAt} where fetchedAt
 * drives the TTL and lastGoodAt drives the grace window.
 */
let cache = null;

/** Test-only hook: drop the per-isolate cache between tests. */
export function __resetIsolateCache() {
  cache = null;
}

function cacheTtlMs(env) {
  const raw = env && env.CACHE_TTL_SECONDS;
  const n = raw === undefined || raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_CACHE_TTL_SECONDS * 1000;
  return Math.floor(n) * 1000;
}

async function etagFor(sampledAt) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(sampledAt)),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `"${hex.slice(0, 16)}"`;
}

/**
 * Fetch (or reuse) the published graph. Never throws. Returns
 * {ok:true, graph, etag, sampledAt, cacheHit, stale?, reason?} or
 * {ok:false, error:'origin_unavailable', detail}.
 */
async function loadGraph(env) {
  const url = (env && env.ORIGIN_DATA_URL) || DEFAULT_ORIGIN;
  const now = Date.now();
  if (cache && now - cache.fetchedAt < cacheTtlMs(env)) {
    return { ok: true, ...cache, cacheHit: true };
  }
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': `townhearts-agent-worker/${API_VERSION} (+${FALLBACK_STATIC_URL.replace(/data\/graph\.json$/, '')})`,
      },
    });
    if (!res.ok) throw new Error(`origin returned HTTP ${res.status}`);
    const graph = await res.json();
    if (
      !graph ||
      typeof graph !== 'object' ||
      !graph.meta ||
      typeof graph.meta.sampled_at !== 'string' ||
      !graph.index
    ) {
      throw new Error('origin payload failed the basic graph shape check');
    }
    const etag = await etagFor(graph.meta.sampled_at);
    cache = {
      graph,
      etag,
      sampledAt: graph.meta.sampled_at,
      fetchedAt: now,
      lastGoodAt: now,
    };
    return { ok: true, ...cache, cacheHit: false };
  } catch (err) {
    const graceMs = GRACE_WINDOW_HOURS * 3600 * 1000;
    if (cache && now - cache.lastGoodAt <= graceMs) {
      return {
        ok: true,
        ...cache,
        cacheHit: true,
        stale: true,
        reason:
          `origin fetch failed (${err && err.message ? err.message : 'unknown error'}); ` +
          `serving the cached copy within the ${GRACE_WINDOW_HOURS}h grace window`,
      };
    }
    return {
      ok: false,
      error: 'origin_unavailable',
      detail: err && err.message ? err.message : 'unknown error',
    };
  }
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

/** Staleness derived ONLY from the published sampled_at + stale_after_hours. */
function stalenessOf(meta) {
  const sampled = Date.parse(meta.sampled_at);
  const staleAfter =
    typeof meta.stale_after_hours === 'number' && meta.stale_after_hours > 0
      ? meta.stale_after_hours
      : 7;
  if (!Number.isFinite(sampled)) {
    return {
      is_stale: true,
      age_hours: null,
      state: 'stale',
      note: 'sampled_at is missing or unparseable',
    };
  }
  const ageHours = Math.round(((Date.now() - sampled) / 3600000) * 100) / 100;
  const isStale = ageHours > staleAfter;
  return { is_stale: isStale, age_hours: ageHours, state: isStale ? 'stale' : 'fresh' };
}

function options204() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handleStatus(request, env, stats) {
  const g = await loadGraph(env);
  if (!g.ok) return jsonResponse({ error: g.error, detail: g.detail }, 502);
  stats.cacheHit = g.cacheHit;
  const m = g.graph.meta;
  const body = {
    service: SERVICE,
    api_version: API_VERSION,
    source: 'cloudflare-worker',
    meta: {
      schema: m.schema_version,
      publisher: m.publisher_version,
      scoring: m.scoring_version,
      epoch: m.epoch,
      sampled_at: m.sampled_at,
      collection_status: m.collection_status,
      cadence_hours: m.cadence_hours,
      stale_after_hours: m.stale_after_hours,
    },
    staleness: stalenessOf(m),
    fallback: { static_graph_url: FALLBACK_STATIC_URL },
  };
  if (g.stale) body.notice = g.reason;
  return jsonResponse(body, 200, { 'Cache-Control': 'public, max-age=60' });
}

async function handleGraph(request, env, stats) {
  const g = await loadGraph(env);
  if (!g.ok) return jsonResponse({ error: g.error, detail: g.detail }, 502);
  stats.cacheHit = g.cacheHit;

  // Conditional requests: ETag = hash of sampled_at; Last-Modified = sampled_at.
  const lastModified = new Date(g.sampledAt).toUTCString();
  const baseHeaders = {
    ETag: g.etag,
    'Last-Modified': lastModified,
    'Cache-Control': 'public, max-age=120',
  };

  const ifNoneMatch = request.headers.get('If-None-Match');
  const ifModifiedSince = request.headers.get('If-Modified-Since');
  const sampled = new Date(g.sampledAt);
  let imsDate = NaN;
  if (ifModifiedSince) imsDate = Date.parse(ifModifiedSince);
  if (
    (ifNoneMatch && ifNoneMatch === g.etag) ||
    (Number.isFinite(imsDate) && sampled.getTime() <= imsDate)
  ) {
    return new Response(null, { status: 304, headers: { ...CORS_HEADERS, ...baseHeaders } });
  }

  // Meaning-preserving passthrough: the published object, re-serialized
  // without alteration. On origin failure the cached copy is served ONLY
  // with an explicit top-level stale marker.
  let body = g.graph;
  if (g.stale) {
    body = { ...g.graph, stale: true, reason: g.reason };
  }
  return jsonResponse(body, 200, baseHeaders);
}

function pairParams(url) {
  const a = url.searchParams.get('a');
  const b = url.searchParams.get('b');
  if (a === null || b === null) {
    return {
      error: jsonResponse(
        {
          error: 'invalid_params',
          detail: "both 'a' and 'b' are required, e.g. /v1/pair?a=<muse_id_a>&b=<muse_id_b>",
        },
        400,
      ),
    };
  }
  const ta = a.trim();
  const tb = b.trim();
  if (
    ta.length === 0 ||
    tb.length === 0 ||
    ta.length > MAX_PARAM_LENGTH ||
    tb.length > MAX_PARAM_LENGTH
  ) {
    return {
      error: jsonResponse(
        {
          error: 'invalid_params',
          detail: `'a' and 'b' must be non-empty and at most ${MAX_PARAM_LENGTH} characters`,
        },
        400,
      ),
    };
  }
  return { a: ta, b: tb };
}

async function handlePair(request, env, stats) {
  const url = new URL(request.url);
  const params = pairParams(url);
  if (params.error) return params.error;

  const g = await loadGraph(env);
  if (!g.ok) return jsonResponse({ error: g.error, detail: g.detail }, 502);
  stats.cacheHit = g.cacheHit;

  // Canonical key, exactly the published contract: the two ids sorted,
  // pipe-joined (the ids are ASCII muse_* ids, so JS sort matches the
  // publisher's codepoint sort; a mismatched key can only miss → 404).
  const key = [params.a, params.b].sort().join('|');
  let entry = g.graph.index[key];
  let via = 'index';
  if (!entry) {
    // Convenience fallback: exact, case-sensitive display-name pair via
    // the published index_names (names can change and collide — ids are
    // canonical; no case folding, no prefix matching).
    entry = g.graph.index_names ? g.graph.index_names[key] : undefined;
    via = 'index_names';
  }
  if (!entry) {
    return jsonResponse(
      {
        error: 'pair_not_found',
        pair: key,
        lookup: via,
        note:
          'no pair is recorded for this key. Lookup is exact: muse ids are canonical ' +
          "(recommended; e.g. /v1/pair?a=<muse_id_a>&b=<muse_id_b>); display names are an " +
          'exact case-sensitive convenience (names can change and collide). Pairs seen ' +
          'only in unaddressed passive-ambient places publish no edge and answer not-found.',
      },
      404,
      { 'Cache-Control': 'public, max-age=60' },
    );
  }
  // Respond with exactly the published index entry — the same object shape
  // as graph.index[key] (no wrapper, no added fields).
  const body = { ...entry };
  if (g.stale) {
    body.stale = true;
    body.reason = g.reason;
  }
  return jsonResponse(body, 200, { 'Cache-Control': 'public, max-age=60' });
}

/**
 * Analytics Engine write — minimal aggregate event only. Wrapped so an
 * analytics failure can never block or alter a data response. The index is
 * the OPTIONAL self-reported client header (or 'anon'); the OPTIONAL
 * self-reported Muse ID is recorded as a blob when present. Pair query
 * params, IP addresses, and raw headers are never recorded.
 */
function recordMetrics(env, request, endpoint, status, cacheHit, startedAt) {
  try {
    const ae = env && env.TOWNHEARTS_METRICS;
    if (!ae || typeof ae.writeDataPoint !== 'function') return;
    const statusClass = `${String(status).charAt(0)}xx`;
    const client = (request.headers.get('X-TownHearts-Client') || '').trim().slice(0, 64);
    const museId = (request.headers.get('X-TownHearts-Muse-ID') || '').trim().slice(0, 64);
    ae.writeDataPoint({
      blobs: [
        endpoint, // 'status' | 'graph' | 'pair'
        statusClass, // '2xx' | '4xx' | '5xx'
        cacheHit ? 'hit' : 'miss',
        API_VERSION,
        client, // '' when not self-reported
        museId, // '' when not self-reported
      ],
      doubles: [Math.max(0, Math.round(Date.now() - startedAt))], // respMs
      index: client || 'anon',
    });
  } catch (_err) {
    // Analytics must never break a read. Nothing is logged (no error text,
    // no headers, no URLs) — silence is the privacy-preserving behavior.
  }
}

function endpointFor(pathname) {
  if (pathname === '/v1/status') return 'status';
  if (pathname === '/v1/graph') return 'graph';
  if (pathname === '/v1/pair') return 'pair';
  return null;
}

export default {
  async fetch(request, env) {
    const startedAt = Date.now();
    let url;
    try {
      url = new URL(request.url);
    } catch (_err) {
      return jsonResponse({ error: 'bad_request' }, 400);
    }

    if (request.method === 'OPTIONS') return options204();

    const endpoint = endpointFor(url.pathname);
    if (!endpoint) {
      // Unknown paths are not one of the three measured categories; the
      // request is answered but not recorded.
      return jsonResponse({ error: 'not_found' }, 404);
    }
    if (request.method !== 'GET') {
      const res = jsonResponse({ error: 'method_not_allowed' }, 405, {
        Allow: 'GET, OPTIONS',
      });
      recordMetrics(env, request, endpoint, res.status, false, startedAt);
      return res;
    }

    const stats = { cacheHit: false };
    let res;
    try {
      if (endpoint === 'status') res = await handleStatus(request, env, stats);
      else if (endpoint === 'graph') res = await handleGraph(request, env, stats);
      else res = await handlePair(request, env, stats);
    } catch (_err) {
      // Unexpected handler error: honest JSON 500, CORS still applied.
      res = jsonResponse({ error: 'internal_error' }, 500);
    }
    recordMetrics(env, request, endpoint, res.status, stats.cacheHit, startedAt);
    return res;
  },
};
