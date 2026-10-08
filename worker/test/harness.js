/**
 * Mock-env harness for the TownHearts worker tests.
 *
 * Stubs global fetch (synthetic origin) and provides a fake Analytics
 * Engine binding that records every writeDataPoint call. No network, no
 * Cloudflare runtime required — the Worker runs directly under node --test.
 */

import worker, { __resetIsolateCache } from '../src/index.js';

/** Fake AE binding: records calls so tests can inspect what was written. */
export function makeAnalytics({ throwing = false } = {}) {
  const calls = [];
  return {
    calls,
    writeDataPoint(dataPoint) {
      if (throwing) throw new Error('synthetic analytics failure');
      // Record a deep copy (AE snapshots the values).
      calls.push(JSON.parse(JSON.stringify(dataPoint)));
    },
  };
}

/** Build a mock Worker env. `originBody` is the object the origin serves. */
export function makeEnv({
  originBody,
  originError = null,
  analytics = makeAnalytics(),
  cacheTtlSeconds,
} = {}) {
  const env = {
    TOWNHEARTS_METRICS: analytics,
  };
  if (originBody !== undefined || originError) {
    env.ORIGIN_DATA_URL = 'https://synthetic.test/townhearts/data/graph.json';
    globalThis.fetch = async () => {
      if (originError) throw originError;
      return new Response(JSON.stringify(originBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }
  if (cacheTtlSeconds !== undefined) {
    env.CACHE_TTL_SECONDS = String(cacheTtlSeconds);
  }
  return env;
}

/** Restore real fetch + drop the isolate cache (call in each test's setup). */
export function resetHarness() {
  __resetIsolateCache();
  delete globalThis.fetch;
}

/** Build a Worker Request against a fake workers.dev host. */
export function workerRequest(path, { headers = {}, method = 'GET' } = {}) {
  return new Request(`https://townhearts-agent-api.example.workers.dev${path}`, {
    method,
    headers,
  });
}

/** Run the Worker fetch handler. */
export function runWorker(request, env) {
  return worker.fetch(request, env);
}

export async function bodyJson(response) {
  return JSON.parse(await response.text());
}
