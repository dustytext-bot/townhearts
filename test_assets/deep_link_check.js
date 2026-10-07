// TownHearts muse deep-link check (v1.2.1) — browser-free node harness:
//   mode "bridge"  — 404.html: /townhearts/<Name> → ./?muse=<Name> parsing +
//                    location.replace mechanics (decode, trailing slash,
//                    multi-segment fallback, noscript fallback);
//   mode "resolve" — zone_rules.resolveMuse resolution cases (exact id /
//                    exact name / case-insensitive, ids canonical in any case,
//                    trimmed queries / unique prefix / ambiguous
//                    prefix → candidates / unknown → honest not-found / legacy
//                    index_names names) + focusSummary math (counts per tier,
//                    growth totals, strongest pair);
//   mode "focus"   — index.html focused view under a minimal DOM shim:
//                    focus rendering from ?muse=, honest not-found, did-you-
//                    mean chips, the clear button (param stripped, unfocused
//                    zones restored), the v1.2.2 homepage card structure for
//                    the focused pairs (same class names/ordering as the
//                    zone cards) and window-tab switches that retain the
//                    ?muse= focus (URL state stays shareable).
// Usage: node test_assets/deep_link_check.js <index.html> <404.html> [mode]
// Exit 0 = verified; 1 = violation. Used by pytest (skips if node missing).

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const mode = (process.argv[4] || "all").toLowerCase();
const indexHtml = fs.readFileSync(process.argv[2], "utf8");
const notFoundHtml = fs.readFileSync(process.argv[3], "utf8");

const siteMatch = indexHtml.match(/<script>([\s\S]*?)<\/script>/);
const bridgeMatch = notFoundHtml.match(/<script>([\s\S]*?)<\/script>/);
if (!siteMatch) { console.error("FAIL: no inline script in index.html"); process.exit(1); }
if (!bridgeMatch) { console.error("FAIL: no inline script in 404.html"); process.exit(1); }
const SITE_SCRIPT = siteMatch[1];
const BRIDGE_SCRIPT = bridgeMatch[1];

function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }

// ---------------- DOM shim (same shape as window_check.js) ----------------

function makeShim() {
  const violations = [], textLog = [], byId = new Map();

  function makeElement(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      style: {},
      className: "",
      disabled: false,
      value: "",
      href: undefined,
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
      setAttribute() {},
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
    if (node && typeof node.text === "string") return node.text;
    for (const c of node.children || []) out += (c && typeof c.text === "string") ? c.text : elementText(c);
    return out;
  }

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

  return { violations, textLog, byId, document, makeElement, elementFor, elementText,
           allText: () => textLog.join("\n") };
}

// ---------------- mode: bridge (404.html) --------------------------------

function runBridge(pathname, shim) {
  const calls = [];
  const location = {
    pathname, hash: "", search: "",
    href: "https://dustytext-bot.github.io" + pathname,
    replace(t) { calls.push(String(t)); },
  };
  const sandbox = {
    location,
    document: shim.document,
    console,
  };
  sandbox.window = sandbox;   // the page also exposes museFromPath via window
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE_SCRIPT, sandbox);
  return { calls, sandbox, location };
}

function checkBridge() {
  const cases = [
    ["/townhearts/Anastasia", "./?muse=Anastasia"],
    ["/townhearts/Cold%20Comfort", "./?muse=Cold%20Comfort"],
    ["/townhearts/Anastasia/", "./?muse=Anastasia"],
    ["/townhearts/", "./"],
    ["/townhearts/Anastasia/extra", "./"],
    ["/townhearts/data/missing.json", "./"],
    ["/other/Anastasia", "./"],
  ];
  for (const [pathname, expected] of cases) {
    const shim = makeShim();
    const run = runBridge(pathname, shim);
    if (run.calls.length !== 1) fail("404 bridge for " + pathname + " must redirect exactly once, got " + run.calls.length);
    if (run.calls[0] !== expected) fail("404 bridge for " + pathname + " redirected to " + run.calls[0] + ", expected " + expected);
    if (shim.violations.length) fail("404 bridge used HTML-injection APIs: " + JSON.stringify(shim.violations.slice(0, 3)));
  }
  // decode + fallback edges of the pure parser
  const shim = makeShim();
  const run = runBridge("/townhearts", shim);           // bare /townhearts: no marker segment → home
  if (run.calls[0] !== "./") fail("bare /townhearts must fall back to the plain home page");
  const probe = runBridge("/townhearts/Anastasia", makeShim());
  const parse = probe.sandbox.window.museFromPath;
  if (typeof parse !== "function") fail("404 bridge must expose museFromPath for the harness");
  if (parse("/townhearts/Cold%20Comfort") !== "Cold Comfort") fail("bridge must URL-decode the muse name");
  if (parse("/townhearts/Cold%zzComfort") !== "Cold%zzComfort") fail("malformed escapes must fall back to the raw segment, not crash");
  if (parse("/townhearts/%20Anastasia%20") !== "Anastasia") fail("bridge must trim decoded whitespace");
  if (parse("") !== "") fail("empty pathname must resolve to no muse");
  // static human fallback + mechanics
  if (!/<noscript[\s\S]*href="\.\/"[\s\S]*<\/noscript>/.test(notFoundHtml)) fail("404.html must carry a noscript fallback linking the home page");
  if (!notFoundHtml.includes("location.replace")) fail("404.html must document/use the location.replace mechanic");
  if (/\.assign\(/.test(notFoundHtml)) fail("404.html must not navigate via location.assign");
  console.log("bridge check OK: 7 redirect cases + parser edges verified, replace-only navigation");
}

// ---------------- mode: resolve (zone_rules.js) ---------------------------

function checkResolve() {
  const Z = require(path.join(__dirname, "..", "zone_rules.js"));

  const roster = {
    muse_anastasia: "Anastasia",
    muse_anastasia_ii: "Anastasia II",
    muse_nimbus: "Nimbus",
    muse_orion: "Orion",
  };
  const ixLegacy = {
    "Old Name|Nimbus": { a: "muse_old", a_name: "Old Name", b: "muse_nimbus", b_name: "Nimbus" },
  };
  const rosterLegacy = { muse_old: "Current Name", muse_nimbus: "Nimbus" };

  // 1. exact muse id wins over any name
  let r = Z.resolveMuse("muse_nimbus", roster, {});
  if (!r.ok || r.via !== "id" || r.id !== "muse_nimbus") fail("exact muse id must win: " + JSON.stringify(r));

  // 2. exact display name (case-sensitive) — beats the ambiguous prefix family
  r = Z.resolveMuse("Anastasia", roster, {});
  if (!r.ok || r.via !== "exact" || r.id !== "muse_anastasia") fail("exact display name must resolve: " + JSON.stringify(r));
  r = Z.resolveMuse("Anastasia II", roster, {});
  if (!r.ok || r.via !== "exact" || r.id !== "muse_anastasia_ii") fail("exact second display name must resolve: " + JSON.stringify(r));

  // 3. case-insensitive over the roster values
  r = Z.resolveMuse("ANASTASIA", roster, {});
  if (!r.ok || r.via !== "ci" || r.id !== "muse_anastasia") fail("case-insensitive name must resolve: " + JSON.stringify(r));
  r = Z.resolveMuse("aNaStAsIa iI", roster, {});
  if (!r.ok || r.via !== "ci" || r.id !== "muse_anastasia_ii") fail("case-insensitive spaced name must resolve: " + JSON.stringify(r));

  // 3b. legacy pairing-record name (index_names sides) after a rename
  r = Z.resolveMuse("old name", rosterLegacy, ixLegacy);
  if (!r.ok || r.via !== "index" || r.id !== "muse_old" || r.name !== "Current Name")
    fail("legacy index_names name must resolve to the canonical muse: " + JSON.stringify(r));
  r = Z.resolveMuse("OLD NA", rosterLegacy, ixLegacy);
  if (!r.ok || r.via !== "prefix" || r.id !== "muse_old")
    fail("legacy index_names prefix must resolve uniquely: " + JSON.stringify(r));

  // 3c. the id is canonical in any case (v1.2.7): one CI id hit answers
  r = Z.resolveMuse("MUSE_NIMBUS", roster, {});
  if (!r.ok || r.via !== "id" || r.id !== "muse_nimbus") fail("upper-cased muse id must resolve: " + JSON.stringify(r));
  r = Z.resolveMuse("Muse_Nimbus", roster, {});
  if (!r.ok || r.via !== "id" || r.id !== "muse_nimbus") fail("mixed-case muse id must resolve: " + JSON.stringify(r));

  // 3d. queries are trimmed before matching (v1.2.7) — padding never blocks
  r = Z.resolveMuse("  Anastasia  ", roster, {});
  if (!r.ok || r.via !== "exact" || r.id !== "muse_anastasia") fail("padded exact name must resolve trimmed: " + JSON.stringify(r));
  r = Z.resolveMuse("\tMUSE_NIMBUS\n", roster, {});
  if (!r.ok || r.via !== "id" || r.id !== "muse_nimbus") fail("padded id must resolve trimmed: " + JSON.stringify(r));
  r = Z.resolveMuse("  anastasia  ", roster, {});
  if (!r.ok || r.via !== "ci" || r.id !== "muse_anastasia") fail("padded + lower-cased name must resolve trimmed + CI: " + JSON.stringify(r));

  // 4. unique case-insensitive prefix
  r = Z.resolveMuse("nim", roster, {});
  if (!r.ok || r.via !== "prefix" || r.id !== "muse_nimbus") fail("unique prefix must resolve: " + JSON.stringify(r));

  // 5. ambiguous prefix → the candidate list, never a guess
  r = Z.resolveMuse("anas", roster, {});
  if (r.ok || r.reason !== "ambiguous" || !Array.isArray(r.candidates) || r.candidates.length !== 2)
    fail("ambiguous prefix must return the candidate list: " + JSON.stringify(r));
  const candNames = r.candidates.map((c) => c.name).sort();
  if (!(candNames[0] === "Anastasia" && candNames[1] === "Anastasia II"))
    fail("ambiguous prefix candidates must be the two matching muses: " + JSON.stringify(r.candidates));

  // 5b. ambiguous exact-name collision (two ids, one display name)
  const twins = { muse_x: "Nova", muse_y: "Nova" };
  r = Z.resolveMuse("Nova", twins, {});
  if (r.ok || r.reason !== "ambiguous" || r.candidates.length !== 2)
    fail("colliding exact names must be ambiguous: " + JSON.stringify(r));

  // 5c. ambiguous CI collision that is exact-unambiguous ("Nova" vs "nova")
  const novi = { muse_x: "Nova", muse_y: "nova" };
  r = Z.resolveMuse("Nova", novi, {});
  if (!r.ok || r.via !== "exact") fail("case-sensitive exact must win before CI ambiguity: " + JSON.stringify(r));
  r = Z.resolveMuse("NOVA", novi, {});
  if (r.ok || r.reason !== "ambiguous" || r.candidates.length !== 2)
    fail("CI ambiguity (case-only variants) must return candidates: " + JSON.stringify(r));

  // 6. unknown → the honest not-found path, no candidates, no matches invented
  r = Z.resolveMuse("Zorp", roster, {});
  if (r.ok || r.reason !== "unknown" || (r.candidates && r.candidates.length))
    fail("unknown name must fail honestly with no candidates: " + JSON.stringify(r));
  r = Z.resolveMuse("", roster, {});
  if (r.ok) fail("empty query must not resolve");
  r = Z.resolveMuse(null, roster, {});
  if (r.ok) fail("null query must not resolve");

  // 7. focusSummary math: counts per tier, growth totals, strongest pair
  const e = (pair, a, b, warmth, tier, growth_7d) =>
    ({ pair, a, b, warmth, tier, growth_7d });
  const edgeBond = e("muse_anastasia|muse_nimbus", "muse_anastasia", "muse_nimbus", 30, "bond", 4);
  const pairsList = [
    edgeBond,
    e("muse_anastasia|muse_orion", "muse_anastasia", "muse_orion", 14, "companion", 6),
    e("muse_anastasia_ii|muse_nimbus", "muse_anastasia_ii", "muse_nimbus", 6, "friendly", 0),
    e("muse_orion|muse_nimbus", "muse_orion", "muse_nimbus", 2, "acquaintance", 2),
    e("muse_x|muse_y", "muse_x", "muse_y", 4, null, 3),
  ];
  const s = Z.focusSummary(pairsList);
  if (s.connections !== 5) fail("focusSummary connections: " + JSON.stringify(s));
  if (s.bonds !== 1 || s.companions !== 1 || s.friendly !== 1 || s.acquaintance !== 1 || s.untiered !== 1)
    fail("focusSummary per-tier counts wrong: " + JSON.stringify(s));
  if (s.growth7d !== 15) fail("focusSummary growth total (4+6+0+2+3) wrong: " + JSON.stringify(s));
  if (s.top !== edgeBond) fail("focusSummary must name the warmth-30 pair");
  // strongest-pair tiebreak: equal warmth → smaller pairKey
  const tie = Z.focusSummary([e("b0|c0", "b0", "c0", 30, "bond", 0), e("a1|z1", "a1", "z1", 30, "bond", 0)]);
  if (!tie.top || tie.top.pair !== "a1|z1") fail("focusSummary tiebreak must pick the smaller pairKey");
  if (Z.focusSummary([]).connections !== 0 || Z.focusSummary([]).top !== null)
    fail("focusSummary of no pairs must be an honest zero");

  console.log("resolve check OK: id/exact/CI/CI-id/trim/legacy/unique-prefix resolve, ambiguity + unknown honest, summary math exact");
}

// ---------------- mode: focus (index.html behavior) -----------------------

const NOW = "2026-10-06T12:00:00Z";
const Z = require(path.join(__dirname, "..", "zone_rules.js"));

const edge = (pair, a, b, aName, bName, warmth, tier, growth_7d, growth_30d) => ({
  pair, a, b, a_name: aName, b_name: bName, warmth,
  co_locations: Math.max(1, warmth / 2),
  shared_days: 1, first_seen_date: "2026-10-06", last_seen_date: "2026-10-06",
  common_places: {}, largest_shared_group: 2, recent_shared_samples_30d: warmth / 2,
  growth_7d, growth_30d, tier,
  context: { directed_count: 0, reciprocal_directed: false, flow_count: 0, mb_flow_total: 0 },
});

const e0 = edge("muse_anastasia|muse_nimbus", "muse_anastasia", "muse_nimbus", "Anastasia", "Nimbus", 30, "bond", 4, 6);
const e1 = edge("muse_anastasia|muse_orion", "muse_anastasia", "muse_orion", "Anastasia", "Orion", 14, "companion", 6, 6);
const e2 = edge("muse_anastasia_ii|muse_nimbus", "muse_anastasia_ii", "muse_nimbus", "Anastasia II", "Nimbus", 6, "friendly", 0, 0);
const e3 = edge("muse_orion|muse_nimbus", "muse_orion", "muse_nimbus", "Orion", "Nimbus", 2, "acquaintance", 0, 0);

const lifetime = {
  meta: {
    sampled_at: NOW, generated_at: NOW, epoch: 1, epoch_started_at: "2026-09-01T00:00:00Z",
    collection_status: "complete", cadence_hours: 3, stale_after_hours: 7,
    source_window: "2026-09-01T00:00:00Z .. " + NOW,
    scoring: { formula: "warmth = SUM 2/(n-1) over shared observations", inputs: ["co-location rows"],
               context_not_scoring: ["flows", "directed"] },
    scoring_version: "co-presence-2", schema_version: "public-3", publisher_version: "pub-1.0",
  },
  muses: { muse_anastasia: "Anastasia", muse_anastasia_ii: "Anastasia II",
           muse_nimbus: "Nimbus", muse_orion: "Orion" },
  edges: [e0, e1, e2, e3],
  index: {}, index_names: {},
};
lifetime.index["muse_anastasia|muse_nimbus"] = e0;
lifetime.index["muse_anastasia|muse_orion"] = e1;
lifetime.index["muse_anastasia_ii|muse_nimbus"] = e2;
lifetime.index["muse_orion|muse_nimbus"] = e3;
lifetime.index_names["Anastasia|Nimbus"] = e0;
lifetime.index_names["Anastasia|Orion"] = e1;
lifetime.index_names["Anastasia II|Nimbus"] = e2;
lifetime.index_names["Orion|Nimbus"] = e3;

const empty24 = JSON.parse(JSON.stringify({
  meta: Object.assign({}, lifetime.meta, {
    source_window: "past 24 hours incl. all samples within " + NOW + " .. " + NOW,
    note: "no observations in this window yet",
  }),
  muses: Object.assign({}, lifetime.muses),   // window files carry the full roster
  edges: [], index: {}, index_names: {},
}));

const FIXTURES = { "data/graph.json": lifetime, "data/graph_24h.json": empty24 };

// v1.2.8 — a focused view WIDER than the old 12-card cut: 15 Nimbus pairs
// (the 3 canonical ones + 12 more) must all render in ONE flow, no
// "more…" divider splitting them mid-list.
const wideLifetime = JSON.parse(JSON.stringify({
  meta: lifetime.meta,
  muses: Object.assign({}, lifetime.muses),
  edges: [...lifetime.edges],
  index: Object.assign({}, lifetime.index),
  index_names: Object.assign({}, lifetime.index_names),
}));
for (let i = 1; i <= 12; i++) {
  const id = "muse_wide" + String(i).padStart(2, "0");
  const nm = "Wide " + String(i).padStart(2, "0");
  wideLifetime.muses[id] = nm;
  const we = edge("muse_nimbus|" + id, "muse_nimbus", id, "Nimbus", nm, 20 - i, "friendly", 1, 1);
  wideLifetime.edges.push(we);
  wideLifetime.index[nm.localeCompare("Nimbus") < 0 ? nm + "|Nimbus" : "Nimbus|" + nm] = we;
  wideLifetime.index_names["Nimbus|" + nm] = we;
}

function buildSiteSandbox(search, fixtures) {
  const shim = makeShim();
  const locCalls = [], histCalls = [];
  const loc = {
    search, pathname: "/townhearts/", hash: "",
    href: "https://dustytext-bot.github.io/townhearts/" + search,
    replace(t) { locCalls.push(String(t)); },
  };
  const hist = { replaceState(s, t, u) { histCalls.push(String(u)); } };
  const sandbox = {
    location: loc, history: hist,
    document: shim.document, Date, console,
    THZones: Z,
    fetch: (url) => {
      const fx = fixtures || FIXTURES;
      return (url in fx)
        ? Promise.resolve({ ok: true, json: () => Promise.resolve(fx[url]) })
        : Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SITE_SCRIPT, sandbox);
  return { shim, locCalls, histCalls, loc, sandbox };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function findTab(shim, label) {
  const host = shim.elementFor("windows");
  for (const b of host.children) {
    if (shim.elementText(b) === label) return b;
  }
  return null;
}

function chipAnchors(shim) {
  return shim.elementFor("focus-chips").children.filter((c) => c.className === "m-chip");
}

// v1.2.4 — the homepage card anatomy: a div.card holding ONE header line —
// the tier-chip duo inline with the pair as a single "A ✦ B" text element —
// and ONE meta warmth row. The focused pair cards must use these exact class
// names in this exact child ordering — a slice of the homepage, not a bespoke
// row. The ✦ lives inside the pair's one text node (the homepage table's
// inline convention), so no renderer can strand it as a standalone glyph
// line; no header/meta child may be blank either.
const CARD_CHAIN = ["duo", "meta"];
const chain = (n) => (n.children || []).map((c) => c.className);
const duoKids = (n) => (n.children[0] && n.children[0].children) || [];
const metaKids = (n) => (n.children[1] && n.children[1].children) || [];
const namesOf = (shim, n) => duoKids(n)
  .filter((k) => !/^tier-chip tier-/.test(k.className))
  .map((k) => shim.elementText(k).trim());
const isHomepageCard = (shim, n) => n.className === "card" &&
  JSON.stringify(chain(n)) === JSON.stringify(CARD_CHAIN) &&
  duoKids(n).length === 2 &&                                     // the chip + the ONE pair-text element
  duoKids(n).some((k) => /^tier-chip tier-/.test(k.className)) &&
  namesOf(shim, n).length === 1 &&
  namesOf(shim, n)[0].includes(" ✦ ") &&                         // ✦ inline in the pair text …
  !duoKids(n).some((k) => shim.elementText(k).trim() === "✦") && // … never a standalone glyph
  metaKids(n).length === 1;                                      // ONE warmth row — no segment breaks
const focusPairCards = (shim) => shim.elementFor("focus-cards").children
  .filter((n) => isHomepageCard(shim, n));

const sleepMs = 60;

async function checkFocus() {
  // A. prefix-unique focus (?muse=Nim → Nimbus) — the FOCUSED view with summary + pairs
  {
    const run = buildSiteSandbox("?muse=Nim");
    await sleep(sleepMs);
    const { shim } = run;
    const focus = shim.elementFor("zone-focus");
    if (focus.style.display !== "block") fail("focused view must be shown for ?muse=Nim");
    for (const id of ["zones-framing", "zone-socialites", "zone-growing", "zone-sparks", "zone-bonds"]) {
      if (shim.elementFor(id).style.display !== "none") fail(id + " must be hidden while focused");
    }
    if (shim.elementFor("zone-find").style.display === "none") fail("Find-a-Muse must stay available while focused");
    const title = shim.elementText(shim.elementFor("focus-title"));
    if (!(title.includes("Focused on ") && title.includes("Nimbus") && title.includes("(matched by prefix)") && title.includes("id muse_nimbus")))
      fail("focused header wrong: " + JSON.stringify(title));
    const summary = shim.elementText(shim.elementFor("focus-summary"));
    for (const needle of ["3 unique connections", "bonds 1", "companions 0",
                          "strongest Anastasia ✦ Nimbus (warmth 30)", "+4 warmth in 7 days"]) {
      if (!summary.includes(needle)) fail("focused summary missing: " + JSON.stringify(needle));
    }
    // v1.2.2: the focused pairs render through the STANDARD homepage card
    // component — the same class names and child ordering as the zone cards
    // (#cards growing, #sparks), not a bespoke row.
    const rowsText = shim.elementText(shim.elementFor("focus-cards"));
    for (const needle of ["warmth 30", "+4 (7d)", "❤️❤️❤️❤️", "first together"]) {
      if (!rowsText.includes(needle)) fail("focused pairs missing: " + JSON.stringify(needle));
    }
    const focused = focusPairCards(shim);
    if (focused.length !== 3) fail("focused view must render its 3 pairs as homepage cards, got " + focused.length);
    if (namesOf(shim, focused[0])[0] !== "Anastasia ✦ Nimbus")
      fail("first focused card must be the warmth-30 pair: " + JSON.stringify(namesOf(shim, focused[0])));
    if (namesOf(shim, focused[1])[0] !== "Anastasia II ✦ Nimbus" ||
        namesOf(shim, focused[2])[0] !== "Orion ✦ Nimbus")
      fail("focused cards must keep the warmth ranking: " + JSON.stringify(focused.map((n) => namesOf(shim, n))));
    // the ONE coherent header line: the tier chip then the pair, inline
    const bondHeader = duoKids(focused[0]).map((k) => shim.elementText(k).trim());
    // v1.2.10: the tier chip shows the heart ladder (bond = 4♥) — and since
    // v1.2.14 the tier word is visible beside the hearts (hearts alone are
    // never the only visible tier indicator), still kept on title/aria too
    const bondChip = duoKids(focused[0]).find((k) => /^tier-chip tier-/.test(k.className));
    if (bondChip && bondChip.title !== "bond")
      fail("the bond chip must keep its tier word on title/aria: " + JSON.stringify(bondChip.title));
    if (bondHeader.join("|") !== "❤️❤️❤️❤️ bond|Anastasia ✦ Nimbus")
      fail("card header must be chip (hearts + word) + pair on one duo line: " + JSON.stringify(bondHeader));
    // the ONE warmth row: the whole line in a single meta text node
    const bondMeta = metaKids(focused[0]).map((k) => shim.elementText(k));
    if (bondMeta.join("|") !== "🔥 warmth 30 · +4 (7d) · first together 2026-10-06")
      fail("card warmth row must be one meta line: " + JSON.stringify(bondMeta));
    const homeCards = [...shim.elementFor("cards").children, ...shim.elementFor("sparks").children]
      .filter((n) => isHomepageCard(shim, n));
    if (!homeCards.length) fail("homepage zone cards missing for the structure comparison");
    if (JSON.stringify(chain(focused[0])) !== JSON.stringify(chain(homeCards[0])))
      fail("focused card class chain must equal the homepage card class chain: " +
        JSON.stringify(chain(focused[0])) + " vs " + JSON.stringify(chain(homeCards[0])));
    // v1.2.8: the old focus path split pairs across two containers behind a
    // static "more…" divider; both parts are gone entirely. The site must
    // not touch them anymore, and no stray "more…" may appear anywhere.
    if (shim.byId.has("focus-divider") || shim.byId.has("focus-rows"))
      fail("focused view must not touch the removed focus-divider/focus-rows");
    if (shim.elementText(shim.elementFor("zone-focus")).includes("more…"))
      fail("no stray 'more…' inside the focused view");
    if (chipAnchors(shim).length !== 0) fail("resolved focus must not show did-you-mean chips");
    if (!(shim.elementFor("focus-clear")._listeners && shim.elementFor("focus-clear")._listeners.click))
      fail("clear button not wired");
    if (shim.violations.length) fail("HTML-injection APIs used while focused: " + JSON.stringify(shim.violations.slice(0, 3)));

    // E. the clear button: param stripped, history.replaceState only, zones restored
    shim.elementFor("focus-clear").fireEvent("click");
    await sleep(30);
    if (run.histCalls.length !== 1 || run.histCalls[0] !== "/townhearts/")
      fail("clear must strip the muse param via history.replaceState: " + JSON.stringify(run.histCalls));
    if (run.locCalls.length) fail("clear must not navigate");
    if (shim.elementFor("zone-focus").style.display !== "none") fail("focus section must hide after clearing");
    // v1.2.5: after clearing, the page returns to the DEFAULT state — since
    // this run never picked a tab, that is the curated HIGHLIGHTS showcase:
    // the growing/sparks/framing zones stay hidden, the bonds zone comes
    // back on its "Strongest observed connections" hat (top-10 standard
    // cards — with 4 edges, all of them), Find-a-Muse stays put on top, and
    // v1.2.14: the Socialites zone STAYS VISIBLE with the compact
    // warming-up message while the (empty) roll warms up. A tab click
    // brings the full page back (asserted in showcase_check.js).
    for (const id of ["zones-framing", "zone-growing", "zone-sparks"]) {
      if (shim.elementFor(id).style.display !== "none") fail(id + " stays hidden on the default-page showcase after clearing");
    }
    if (shim.elementFor("zone-socialites").style.display === "none") fail("the Socialites zone stays discoverable on the showcase (warming-up message)");
    if (!shim.elementText(shim.elementFor("soc-status")).includes("still warming up"))
      fail("an empty roll on the showcase shows the warming-up message, got: " +
        JSON.stringify(shim.elementText(shim.elementFor("soc-status"))));
    if (shim.elementFor("soc-stage").children.length) fail("no invented stage entries while the roll is empty");
    if (shim.elementFor("zone-bonds").style.display === "none") fail("the bonds zone must be restored after clearing");
    const showcaseCards = shim.elementFor("bonds-cards").children.filter((n) => isHomepageCard(shim, n));
    if (showcaseCards.length !== 4)
      fail("clearing must restore the showcase's highest-relationships cards, got " + showcaseCards.length);
    if (!shim.elementText(shim.elementFor("bonds-title")).includes("Strongest observed connections"))
      fail("the restored bonds zone must wear the showcase hat after clearing");
    if (shim.elementText(shim.elementFor("focus-title")).length) fail("focus header must clear");
    if (shim.elementFor("focus-cards").children.length)
      fail("focus rows must clear");
  }

  // B. exact-name focus — no prefix note
  {
    const run = buildSiteSandbox("?muse=Anastasia");
    await sleep(sleepMs);
    const title = run.shim.elementText(run.shim.elementFor("focus-title"));
    if (!(title.includes("Focused on Anastasia") && !title.includes("(matched by prefix)")))
      fail("exact-name focus must not claim a prefix match: " + JSON.stringify(title));
  }

  // C. unknown name → the honest not-found state, no chips, no other muse's data
  {
    const run = buildSiteSandbox("?muse=Zorp");
    await sleep(sleepMs);
    if (run.shim.elementFor("zone-focus").style.display !== "block") fail("not-found state still shows the focus section");
    const note = run.shim.elementText(run.shim.elementFor("focus-note"));
    if (!note.includes("no muse with that name in the current graph"))
      fail("unknown muse must be answered honestly: " + JSON.stringify(note));
    if (!note.includes("Zorp")) fail("the not-found state should echo the searched name");
    if (run.shim.elementText(run.shim.elementFor("focus-summary")).length) fail("not-found state must not fake a summary");
    if (focusPairCards(run.shim).length) fail("not-found state must not render any pair rows");
    if (chipAnchors(run.shim).length !== 0) fail("unknown name with no prefix matches must show no chips");
  }

  // D. ambiguous prefix → did-you-mean chips with encoded targets
  {
    const run = buildSiteSandbox("?muse=ana");
    await sleep(sleepMs);
    const note = run.shim.elementText(run.shim.elementFor("focus-note"));
    if (!note.includes("no muse with that name in the current graph")) fail("ambiguous prefix must say the focused name is not resolved");
    const chipsHost = run.shim.elementFor("focus-chips");
    if (!run.shim.elementText(chipsHost).includes("did you mean…")) fail("ambiguous prefix must offer did-you-mean chips");
    const chips = chipAnchors(run.shim);
    if (chips.length !== 2) fail("ambiguous prefix must render 2 candidate chips, got " + chips.length);
    const hrefs = chips.map((c) => c.href).sort();
    if (!(hrefs[0] === "./?muse=Anastasia" && hrefs[1] === "./?muse=Anastasia%20II"))
      fail("chip hrefs must be the encoded candidate names: " + JSON.stringify(hrefs));
    if (run.locCalls.length || run.histCalls.length) fail("rendering chips must not navigate or rewrite the URL");
  }

  // D2. case-insensitive exact focus ("ANASTASIA") — anastasia's own math:
  // 2 pairs (bond + companion), growth 4+6=10
  {
    const run = buildSiteSandbox("?muse=ANASTASIA");
    await sleep(sleepMs);
    const title = run.shim.elementText(run.shim.elementFor("focus-title"));
    if (!(title.includes("Focused on Anastasia") && title.includes("id muse_anastasia") && !title.includes("(matched by prefix)")))
      fail("case-insensitive focus must resolve to the canonical muse: " + JSON.stringify(title));
    const summary = run.shim.elementText(run.shim.elementFor("focus-summary"));
    for (const needle of ["2 unique connections", "bonds 1", "companions 1",
                          "strongest Anastasia ✦ Nimbus (warmth 30)", "+10 warmth in 7 days"]) {
      if (!summary.includes(needle)) fail("focused summary (anastasia) missing: " + JSON.stringify(needle));
    }
    if (chipAnchors(run.shim).length !== 0) fail("case-insensitive unique match must not show chips");
  }

  // D3. case-insensitive id focus + a padded, upper-cased query (v1.2.7):
  // ids are canonical in any case and the query is trimmed before matching
  {
    const run = buildSiteSandbox("?muse=" + encodeURIComponent("MUSE_ANASTASIA"));
    await sleep(sleepMs);
    const title = run.shim.elementText(run.shim.elementFor("focus-title"));
    if (!(title.includes("Focused on Anastasia") && title.includes("id muse_anastasia")))
      fail("upper-cased id focus must resolve to the canonical muse: " + JSON.stringify(title));
    if (chipAnchors(run.shim).length !== 0) fail("resolved id focus must not show chips");
  }
  {
    const run = buildSiteSandbox("?muse=" + encodeURIComponent("  ANASTASIA  "));
    await sleep(sleepMs);
    const title = run.shim.elementText(run.shim.elementFor("focus-title"));
    if (!(title.includes("Focused on Anastasia") && title.includes("id muse_anastasia")))
      fail("padded + all-caps ?muse= must resolve to the canonical muse: " + JSON.stringify(title));
    if (chipAnchors(run.shim).length !== 0) fail("resolved trimmed focus must not show chips");
  }

  // F. window-tab switch while focused: the ?muse= focus is retained (URL untouched)
  {
    const run = buildSiteSandbox("?muse=Nim");
    await sleep(sleepMs);
    if (!run.shim.elementText(run.shim.elementFor("focus-summary")).includes("3 unique connections"))
      fail("lifetime focus must render before the switch");
    const tab24 = findTab(run.shim, "24h");
    if (!tab24) fail("24h tab not rendered");
    tab24.fireEvent("click");
    await sleep(40);
    if (run.locCalls.length || run.histCalls.length) fail("tab switch must not navigate or rewrite the URL");
    if (run.loc.search !== "?muse=Nim") fail("the ?muse= param must be retained across a tab switch");
    const focus = run.shim.elementFor("zone-focus");
    if (focus.style.display !== "block") fail("focus must survive the tab switch");
    const title = run.shim.elementText(run.shim.elementFor("focus-title"));
    if (!title.includes("Focused on")) fail("focused header must survive the tab switch");
    const summary = run.shim.elementText(run.shim.elementFor("focus-summary"));
    if (!summary.includes("0 unique connections in this view")) fail("focused summary must recompute for the empty window");
    const note = run.shim.elementText(run.shim.elementFor("focus-note"));
    if (!note.includes("no observed connections for this muse in the 24h view — absence of data is not absence of friendship."))
      fail("focused empty-window state must be honest");
    if (run.shim.violations.length) fail("HTML-injection APIs used across a focused tab switch");
    const tabLife = findTab(run.shim, "LIFETIME");
    if (!tabLife) fail("LIFETIME tab not rendered");
    tabLife.fireEvent("click");
    await sleep(40);
    if (!run.shim.elementText(run.shim.elementFor("focus-summary")).includes("3 unique connections"))
      fail("focused pairs must return after switching back");
    if (focusPairCards(run.shim).length !== 3) fail("focused homepage cards must return after switching back");
    if (run.loc.search !== "?muse=Nim") fail("URL must still carry ?muse= on return to lifetime");
  }

  // G. no-param load — v1.2.5 + v1.2.14: the default page IS the curated
  // HIGHLIGHTS showcase (the selected tab): Find-a-Muse on top, the Socialites
  // zone discoverable with its warming-up message while the roll is empty,
  // the strongest connections as standard cards, growing/sparks off.
  {
    const run = buildSiteSandbox("");
    await sleep(sleepMs);
    if (run.shim.elementFor("zone-focus").style.display !== "none") fail("no ?muse param → the unfocused site");
    for (const id of ["zones-framing", "zone-growing", "zone-sparks"]) {
      if (run.shim.elementFor(id).style.display !== "none") fail(id + " stays hidden on the default-page showcase");
    }
    if (run.shim.elementFor("zone-socialites").style.display === "none") fail("the Socialites zone stays discoverable on the default page");
    if (!run.shim.allText().includes("still warming up")) fail("the warming-up message must render on the default page");
    if (run.shim.elementFor("zone-bonds").style.display === "none") fail("the bonds zone must be visible on the default page");
    const showcaseCards = run.shim.elementFor("bonds-cards").children.filter((n) => isHomepageCard(run.shim, n));
    if (showcaseCards.length !== 4)
      fail("the default page must open on the top-10 (here: all 4 pairs) highest relationships, got " + showcaseCards.length);
  }

  // H. v1.2.8 — the over-the-cut profile: 15 Nimbus pairs (3 canonical +
  // 12 wide) must render as ONE continuous flow in #focus-cards, no
  // "more…" divider splitting them mid-list (the snarlinggenie report).
  {
    const run = buildSiteSandbox("?muse=Nim", { "data/graph.json": wideLifetime, "data/graph_24h.json": empty24 });
    await sleep(sleepMs);
    if (run.shim.elementFor("zone-focus").style.display !== "block") fail("wide fixture: the focused view must be shown");
    const cards = focusPairCards(run.shim);
    if (cards.length !== 15)
      fail("wide focus must render ALL 15 pairs in one flow, got " + cards.length);
    if (run.shim.byId.has("focus-divider") || run.shim.byId.has("focus-rows"))
      fail("wide focus: the site must not touch the removed focus-divider/focus-rows");
    if (run.shim.elementText(run.shim.elementFor("zone-focus")).includes("more…"))
      fail("wide focus: no stray 'more…' mid-list");
    const first = namesOf(run.shim, cards[0])[0];
    if (first !== "Anastasia ✦ Nimbus")
      fail("wide focus order: strongest pair first, got " + JSON.stringify(first));
  }

  console.log("focus check OK: focus renders as homepage cards, not-found is honest, chips resolve, clear strips the param, tab switch keeps ?muse=");
}

(async () => {
  if (mode === "all" || mode === "bridge") checkBridge();
  if (mode === "all" || mode === "resolve") checkResolve();
  if (mode === "all" || mode === "focus") await checkFocus();
  if (!["all", "bridge", "resolve", "focus"].includes(mode)) fail("unknown mode: " + mode);
  console.log("deep-link check OK (" + mode + "): bridge + resolution + focused-view behavior verified without a browser");
  process.exit(0);
})().catch((err) => { console.error("FAIL: " + (err && err.stack || err)); process.exit(1); });