// TownHearts window-switcher behavior check — runs the index.html script under
// a minimal DOM shim with per-file fixtures and drives the tab interactions:
//   1. the initial HIGHLIGHTS tab (v1.2.14, selected on load) renders the
//      AGGREGATE pair evidence (public-3: counts only — the per-event detail
//      classes must render NOWHERE); since v1.3.3 the partial-collection
//      banner (v1.2.14) is owner-suppressed — on a partial fixture it must
//      stay EMPTY (SHOW_PARTIAL_STATUS = false);
//   2. the 30d tab (stale + partial fixture) shows the RED stale banner under
//      its own window-specific heading (the partial notice stays hidden);
//   3. switching to the 24h tab (complete + fresh, empty window fixture)
//      clears both banners (the fresh-data branches) and renders the honest
//      empty state (meta.note "no observations in this window yet");
//   4. switching to a MISSING window file retains no old banners, renders the
//      same honest empty state with the load error — never fake data;
//   5. switching back to LIFETIME restores the lifetime view (its own
//      heading; the partial notice stays suppressed) — and an untiered pair's
//      evidence reads "no tier yet", never a bare null;
//   6. no HTML-parsing APIs used anywhere; timestamps never depend on
//      wall-clock time (the clock is pinned).
//
// Usage: node test_assets/window_check.js <index.html>
// Exit 0 = behavior verified; 1 = violation.

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(process.argv[2], "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("no script block found"); process.exit(1); }

const violations = [];
const textLog = [];

function makeElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    className: "",
    disabled: false,
    value: "",
    firstChild: null,
    appendChild(child) { node.children.push(child); node.firstChild = node.children[0]; return child; },
    removeChild(child) {
      const i = node.children.indexOf(child);
      if (i >= 0) node.children.splice(i, 1);
      node.firstChild = node.children[0] || null;
      return child;
    },
    addEventListener(type, fn) { (node._listeners ||= {})[type] = fn; },
    fireEvent(type) { const fn = node._listeners && node._listeners[type]; if (fn) fn(); },
    setAttribute(key, val) { node.attrs = node.attrs || {}; node.attrs[key] = String(val); },
  };
  for (const api of ["innerHTML", "outerHTML"]) {
    Object.defineProperty(node, api, {
      set() { violations.push("assigned " + api + " on <" + tag + ">"); },
      get() { violations.push("read " + api); return ""; },
    });
  }
  node.insertAdjacentHTML = function () { violations.push("called insertAdjacentHTML"); };
  return node;
}

function elementText(node) {
  let out = "";
  for (const c of node.children || []) {
    out += (c && typeof c.text === "string") ? c.text : elementText(c);
  }
  return out;
}

const byId = new Map();
function elementFor(id) {
  if (!byId.has(id)) byId.set(id, makeElement("div#" + id));
  return byId.get(id);
}

const document = {
  createElement: (tag) => makeElement(tag),
  createTextNode: (s) => { textLog.push(String(s)); return { text: String(s) }; },
  getElementById: (id) => elementFor(id),
  querySelector: (sel) => {
    if (sel === "#grid tbody") return elementFor("__tbody__");
    return elementFor("__q__" + sel);
  },
};

const NOW = "2026-10-06T12:00:00Z";
const OLD = "2026-10-04T00:00:00Z";   // 60h before the pinned now → stale (> 7h)
// a deterministic clock: banner assertions must never depend on wall-clock time
const RealDate = Date;
const PINNED_NOW = RealDate.parse(NOW) + 60000;
const PinnedDate = function (...args) {
  return args.length ? new RealDate(...args) : new RealDate(PINNED_NOW);
};
PinnedDate.prototype = RealDate.prototype;
PinnedDate.parse = RealDate.parse.bind(RealDate);
PinnedDate.now = () => PINNED_NOW;
PinnedDate.UTC = RealDate.UTC.bind(RealDate);
const lifetime = {
  meta: {
    sampled_at: NOW, generated_at: NOW, epoch: 1, epoch_started_at: "2026-09-01T00:00:00Z",
    // the REAL dataset's own status — kept partial here on purpose: it
    // proves the v1.3.3 owner call (the notice stays hidden, not data-driven)
    collection_status: "partial:legacy-name-ambiguity", cadence_hours: 3, stale_after_hours: 7,
    source_window: "2026-09-01T00:00:00Z .. 2026-10-06T12:00:00Z (2 co-location read(s) retained)",
    scoring: { formula: "warmth = SUM 2/(n-1) over shared observations", inputs: ["co-location rows"],
               context_not_scoring: ["flows", "directed"] },
    scoring_version: "co-presence-2", schema_version: "public-3", publisher_version: "pub-1.0",
  },
  muses: { muse_alpha: "Al <script>pha", muse_beta: "Beta", muse_gamma: "Gamma", muse_delta: "Delta" },
  edges: [{
    pair: "muse_alpha|muse_beta", a: "muse_alpha", b: "muse_beta",
    a_name: "Al <script>pha", b_name: "Beta", warmth: 2, co_locations: 1,
    co_loc_weight: 2, shared_days: 1, first_seen_date: "2026-10-06", last_seen_date: "2026-10-06",
    growth_7d: 0, growth_30d: 0, recent_shared_samples_30d: 1,
    common_places: { Docks: 1 }, largest_shared_group: 2, tier: "acquaintance",
    // public-3: the context carries COUNTS ONLY — the old per-event arrays
    // (previews / reasons / amounts / exact timestamps) do not exist here
    context: { directed_count: 1, reciprocal_directed: true, flow_count: 1, mb_flow_total: 5 },
  }, {
    // an untiered pair — the renderer must display the honest "no tier yet",
    // never a bare null (the chip already did; the evidence line did not)
    pair: "muse_delta|muse_gamma", a: "muse_gamma", b: "muse_delta",
    a_name: "Gamma", b_name: "Delta", warmth: 4, co_locations: 2,
    co_loc_weight: 4, shared_days: 1, first_seen_date: "2026-10-06", last_seen_date: "2026-10-06",
    growth_7d: 0, growth_30d: 0, recent_shared_samples_30d: 2,
    common_places: { Docks: 2 }, largest_shared_group: 2, tier: null,
    context: { directed_count: 0, reciprocal_directed: false, flow_count: 0, mb_flow_total: 0 },
  }],
  index: {}, index_names: {},
};
lifetime.index["muse_alpha|muse_beta"] = lifetime.edges[0];
lifetime.index_names["Al <script>pha|Beta"] = lifetime.edges[0];
lifetime.index["muse_delta|muse_gamma"] = lifetime.edges[1];   // ASCII-sorted ids
lifetime.index_names["Delta|Gamma"] = lifetime.edges[1];

const empty24 = JSON.parse(JSON.stringify({
  meta: {
    ...lifetime.meta,
    // a complete + FRESH empty window: the (already suppressed) partial
    // banner and any stale banner must be EMPTY on it (each honest state)
    collection_status: "complete",
    source_window: "past 24 hours incl. all samples within 2026-10-05T12:00:00Z .. " + NOW,
    note: "no observations in this window yet",
  },
  edges: [], index: {}, index_names: {},
}));

// the 30d file: same partial status as lifetime, but sampled_at 60h old — the
// stale-banner case (the partial notice stays owner-suppressed: v1.3.3)
const stale30 = JSON.parse(JSON.stringify({
  meta: {
    ...lifetime.meta,
    sampled_at: OLD,
    generated_at: OLD,
    source_window: "past 30 days incl. all samples within 2026-09-06T12:00:00Z .. " + OLD,
  },
  muses: lifetime.muses,
  edges: lifetime.edges,
  index: lifetime.index, index_names: lifetime.index_names,
}));

const fixtures = { "data/graph.json": lifetime, "data/graph_30d.json": stale30, "data/graph_24h.json": empty24 };
// no "data/graph_7d.json" → the 7d tab exercises the missing-file empty state

const sandbox = {
  document,
  Date: PinnedDate,
  console,
  THZones: require(path.join(__dirname, "..", "zone_rules.js")),  // the site loads it first
  fetch: (url) => (url in fixtures)
    ? Promise.resolve({ ok: true, json: () => Promise.resolve(fixtures[url]) })
    : Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
};
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const allText = () => textLog.join("\n");
function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }

function findTab(label) {
  const host = byId.get("windows");
  if (!host) return null;
  for (const b of host.children) {
    if (elementText(b) === label) return b;
  }
  return null;
}

(async () => {
  await sleep(50);
  // 0. the default load is the HIGHLIGHTS tab (the partial notice suppressed)
  if (!allText().includes("LIFETIME")) fail("LIFETIME tab not rendered initially");
  if (!allText().includes("Al <script>pha")) fail("lifetime pair not rendered");
  const hlTab = findTab("HIGHLIGHTS");
  if (!hlTab) fail("HIGHLIGHTS tab not rendered");
  if (hlTab.className !== "on" || hlTab.attrs["aria-pressed"] !== "true")
    fail("HIGHLIGHTS must be selected on load (class + aria-pressed), got class=" +
      JSON.stringify(hlTab.className) + " attrs=" + JSON.stringify(hlTab.attrs));
  if (elementFor("collection-banner").children.length !== 0)
    fail("the collection notice is owner-suppressed (v1.3.3): it must stay empty even when status != complete — got: " +
      JSON.stringify(elementText(elementFor("collection-banner"))));
  if (elementFor("stale-banner").children.length !== 0)
    fail("a fresh dataset must not show the stale banner on the default view");
  if (!elementText(elementFor("bonds-title")).includes("Strongest observed connections"))
    fail("the HIGHLIGHTS heading must be the strongest-connections hat, got: " + JSON.stringify(elementText(elementFor("bonds-title"))));
  // v1.2.13: the meta/source_window line no longer displays anywhere
  if (allText().includes(lifetime.meta.source_window)) fail("source_window must stay off the page (v1.2.13)");
  // lookup drives evidence rendering: public-3 aggregates only — counts over
  // the observation record, never per-event detail. The old per-event payload
  // classes (speech previews / flow reasons / amounts / exact timestamps) are
  // asserted ABSENT; the hostile NAME still renders (inert, text nodes).
  const qa = document.getElementById("q-a"), qb = document.getElementById("q-b"), go = document.getElementById("q-go");
  if (!qa || !qb || !go || !go._listeners || !go._listeners.click) fail("lookup controls not wired");
  qa.value = lifetime.edges[0].a; qb.value = lifetime.edges[0].b;
  go.fireEvent("click");
  await sleep(20);
  const ev = elementText(elementFor("q-evidence"));
  for (const needle of ["Public directed interaction", "1 directed line observed \u00b7 reciprocal",
                        "Public Musebuck activity", "1 public flow observed",
                        "(warmth 2 \u2192 acquaintance)", "Observation evidence",
                        "Most common public locations", "Largest shared group"]) {
    if (!ev.includes(needle)) fail("aggregate evidence line missing: " + JSON.stringify(needle) + " — got: " + JSON.stringify(ev));
  }
  for (const banned of ["speech at ", "\u201C", "MB \u2014", "preview", "gift"] ) {
    if (ev.includes(banned)) fail("per-event detail must not render (public-3 aggregates only), found: " + JSON.stringify(banned));
  }
  // the untiered pair renders honest "no tier yet" evidence, never "→ null"
  qa.value = "muse_gamma"; qb.value = "muse_delta";
  go.fireEvent("click");
  await sleep(20);
  if (!elementText(elementFor("q-evidence")).includes("(warmth 4 → no tier yet)"))
    fail("untiered evidence must read 'no tier yet', got: " + JSON.stringify(elementText(elementFor("q-evidence"))));
  if (elementText(elementFor("q-evidence")).includes("→ null"))
    fail("a bare null must never appear in the pair evidence");
  // an aggregate line with a zero count must OMIT itself (no '0 directed…')
  const evUntiered = elementText(elementFor("q-evidence"));
  if (evUntiered.includes("Public directed interaction") || evUntiered.includes("Public Musebuck activity"))
    fail("zero-count aggregate lines must omit themselves, got: " + JSON.stringify(evUntiered));
  // 1b. the 30d tab (stale + partial): the stale banner shows under its own
  // heading (the partial notice stays owner-suppressed)
  const tab30 = findTab("30d");
  if (!tab30) fail("30d tab not rendered");
  tab30.fireEvent("click");
  await sleep(30);
  if (!elementText(elementFor("stale-banner")).includes("stale data"))
    fail("the stale banner must show for the stale 30d fixture");
  if (elementFor("collection-banner").children.length !== 0)
    fail("the partial 30d fixture must keep the owner-suppressed notice empty");
  if (elementText(elementFor("stale-banner")).includes("Partial dataset"))
    fail("the stale banner must never borrow the partial notice's copy");
  const tb30 = elementText(elementFor("bonds-title"));
  if (!tb30.includes("Relationships in the last 30 days"))
    fail("the 30d tab must show its own heading, got: " + JSON.stringify(tb30));
  // 2. empty window (24h) — complete + fresh: BOTH banners clear
  const tab24 = findTab("24h");
  if (!tab24) fail("24h tab not rendered");
  tab24.fireEvent("click");
  await sleep(30);
  if (!allText().includes("no observations in this window yet")) fail("empty-window state not rendered");
  if (allText().includes(empty24.meta.source_window)) fail("source_window must stay off the page (v1.2.13)");
  if (elementFor("stale-banner").children.length !== 0)
    fail("a fresh dataset must clear the stale banner (the fresh-data branch)");
  if (elementFor("collection-banner").children.length !== 0)
    fail("a complete dataset must clear the partial-collection banner");
  const tb24 = elementText(elementFor("bonds-title"));
  if (!tb24.includes("Relationships in the last 24 hours"))
    fail("the 24h tab must show its own heading, got: " + JSON.stringify(tb24));
  // live-DOM check: the pair cards/grid must actually be empty (the log holds
  // history, so lifetime strings may remain in allText())
  if (elementFor("cards").children.length !== 0) fail("stale pair cards left after switching to empty window");
  if (elementFor("__tbody__").children.length !== 0) fail("stale grid rows left after switching to empty window");
  // 3. missing window file (7d) — and no old warnings retained
  const tab7 = findTab("7d");
  if (!tab7) fail("7d tab not rendered");
  tab7.fireEvent("click");
  await sleep(30);
  if (!allText().includes("no observations in this window yet")) fail("missing-file state must render the empty-state text");
  if (!allText().includes("could not be loaded")) fail("missing window file must say the file could not be loaded (honesty)");
  if (elementFor("stale-banner").children.length !== 0 || elementFor("collection-banner").children.length !== 0)
    fail("a failed window load must not retain old banners");
  const tb7 = elementText(elementFor("bonds-title"));
  if (!tb7.includes("Relationships in the last 7 days"))
    fail("the 7d tab must show its own heading even on a failed load, got: " + JSON.stringify(tb7));
  // 4. back to lifetime — the honesty is per-file (the notice stays hidden)
  const tabLife = findTab("LIFETIME");
  if (!tabLife) fail("LIFETIME tab missing after switches");
  tabLife.fireEvent("click");
  await sleep(30);
  if (!allText().includes("Al <script>pha ✦")) fail("lifetime view not restored");
  if (elementFor("collection-banner").children.length !== 0)
    fail("the owner-suppressed partial notice must stay hidden on the (still partial) lifetime view");
  const tbLife = elementText(elementFor("bonds-title"));
  if (!tbLife.includes("All-time relationships"))
    fail("the LIFETIME tab must show its own heading, got: " + JSON.stringify(tbLife));
  // buildTabs rebuilds the buttons on every load — re-find before reading state
  const lifeNow = findTab("LIFETIME");
  if (!lifeNow || lifeNow.attrs["aria-pressed"] !== "true")
    fail("the activated LIFETIME tab must carry aria-pressed=true, got: " + JSON.stringify(lifeNow && lifeNow.attrs));
  // 5. no HTML-parsing APIs along the way
  if (violations.length) fail("HTML-injection APIs used: " + JSON.stringify(violations.slice(0, 5)));
  console.log("window check OK: tabs switch, empty/missing windows render the honest empty state, the stale banner shows and clears per view while the owner-suppressed partial notice (v1.3.3) stays hidden, headings name the active window, untiered evidence reads 'no tier yet', aggregate evidence lines render (no per-event detail), all text inert");
  process.exit(0);
})().catch((err) => { console.error("FAIL: " + (err && err.stack || err)); process.exit(1); });