// TownHearts HIGHLIGHTS-check (v1.2.5 + v1.2.14) — browser-free node harness
// running the index.html script under a minimal DOM shim. The default page —
// since v1.2.14 an EXPLICIT HIGHLIGHTS tab (the audit's replacement for the
// old hidden tabClicked mode) — is a curated showcase:
//   1. the Find-a-Muse card sits at the TOP of the markup (above the focused
//      view and every results zone) and still resolves + renders pairs;
//   2. NO Connections-growing-now / New-sparks zones (hidden entirely AND
//      nothing rendered into their containers) and no zones-framing line;
//   3. the Socialites stage renders when the roll is non-empty; an empty roll
//      shows the v1.2.14 compact warming-up message (never hidden entirely,
//      never invented entries);
//   4. the bonds area wears the "Strongest observed connections" hat: exactly
//      the top 10 pairs by warmth (desc, pairKey-asc tiebreak) rendered as
//      the standard homepage cards (the v1.2.4 anatomy), the full table
//      hidden, one small hint line pointing at the window tabs;
//   5. HIGHLIGHTS is the SELECTED tab (class + aria-pressed) and re-clicking
//      it is a no-op; the LIFETIME tab (and each window tab) restores the
//      FULL five-zone page under its window-specific heading, with the first
//      12 relationships rendered and the ranked remainder behind pointer-
//      based "Show 25 more" / "Show all" controls that never duplicate rows
//      and reset on a window change; the focused view (?muse=) is unchanged
//      (deep_link_check pins that view).
// Usage: node test_assets/showcase_check.js <index.html>
// Exit 0 = verified; 1 = violation. Used by pytest (skips if node missing).

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(process.argv[2], "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: no script block found"); process.exit(1); }
const SITE_SCRIPT = m[1];
const Z = require(path.join(__dirname, "..", "zone_rules.js"));

// pub-1.2: the stage's display order is Z.shuffle (Fisher–Yates, Math.random,
// per page load). Required zone_rules runs in THIS realm — patch THIS realm's
// Math.random (the shuffle is its only consumer) so the medallion order is
// deterministic and pinnable: random() === 0.5 every call.
Math.random = () => 0.5;

function fail(msg) { console.error("FAIL: " + msg); process.exit(1); }

// ---------------- DOM shim (same shape as deep_link_check.js) -------------

function makeShim() {
  const violations = [], textLog = [], byId = new Map();

  // pub-1.2: the stage renders SVG paths (createElementNS) and positions the
  // medallions via CSS custom properties (style.setProperty) — the shim
  // supports both, storing everything in plain properties for assertions.
  function styleBox() {
    const st = {};
    st.setProperty = (k, v) => { st[String(k)] = String(v); };
    st.getPropertyValue = (k) => (st[String(k)] == null ? "" : String(st[String(k)]));
    return st;
  }

  function makeElement(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      style: styleBox(),
      className: "",
      disabled: false,
      value: "",
      href: undefined,
      attrs: {},
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
      setAttribute(key, val) { node.attrs[key] = String(val); if (key === "class") node.className = String(val); },
      getAttribute(key) { const v = node.attrs[key]; return v == null ? null : v; },
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
    createElementNS: (ns, tag) => makeElement(String(tag)),
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

// ---------------- fixtures -------------------------------------------------

const NOW = "2026-10-06T12:00:00Z";
// a deterministic clock: the banner assertions must never depend on wall-clock
// time (a later run would otherwise read the fixture's sampled_at as stale)
const RealDate = Date;
const PINNED_NOW = RealDate.parse(NOW) + 60000;   // one minute after the sample
const PinnedDate = function (...args) {
  return args.length ? new RealDate(...args) : new RealDate(PINNED_NOW);
};
PinnedDate.prototype = RealDate.prototype;
PinnedDate.parse = RealDate.parse.bind(RealDate);
PinnedDate.now = () => PINNED_NOW;
PinnedDate.UTC = RealDate.UTC.bind(RealDate);

// 14 edges: a warmth spread with ties (10 and 6, and 4) so the top-10 trim
// plus the pairKey-asc tiebreak is observable; three of them carry growth so
// the FULL view still has growing-now output. The top pair's name is hostile
// to prove the showcase path renders it as inert text.
const edgeDef = [
  ["muse_a|muse_b", "muse_a", "muse_b", "Anastasia", "Bet<script>ta", 30, "bond", 0, 0],
  ["muse_c|muse_d", "muse_c", "muse_d", "Candor", "Dapple", 24, "companion", 0, 0],
  ["muse_e|muse_f", "muse_e", "muse_f", "Elm", "Fen", 18, "companion", 0, 0],
  ["muse_g|muse_h", "muse_g", "muse_h", "Gale", "Holly", 14, "companion", 0, 0],
  ["muse_i|muse_j", "muse_i", "muse_j", "Isla", "Jory", 12, "friendly", 0, 0],
  ["muse_k|muse_l", "muse_k", "muse_l", "Kip", "Lumen", 10, "friendly", 0, 0],
  ["muse_m|muse_n", "muse_m", "muse_n", "Moss", "Nox", 10, "friendly", 0, 0],
  ["muse_o|muse_p", "muse_o", "muse_p", "Ora", "Pim", 8, "friendly", 0, 0],
  ["muse_q|muse_r", "muse_q", "muse_r", "Quill", "Rill", 6, "friendly", 0, 0],
  ["muse_s|muse_t", "muse_s", "muse_t", "Sorrel", "Thistle", 6, "friendly", 0, 0],
  ["muse_u|muse_v", "muse_u", "muse_v", "Umber", "Vetch", 4, "acquaintance", 3, 0],
  ["muse_w|muse_x", "muse_w", "muse_x", "Wick", "Xenia", 4, "acquaintance", 0, 2],
  ["muse_y|muse_z", "muse_y", "muse_z", "Yarrow", "Zest", 2, "acquaintance", 0, 1],
  ["muse_a2|muse_b2", "muse_a2", "muse_b2", "Aster", "Bramble", 2, "acquaintance", 0, 0],
];

function mkGraph(socRoll, sourceWindow, opts) {
  const o = opts || {};
  const sampledAt = o.sampled_at || NOW;
  const status = o.status || "complete";
  const edges = edgeDef.map((d) => ({
    pair: d[0], a: d[1], b: d[2], a_name: d[3], b_name: d[4],
    warmth: d[5], co_locations: d[5] / 2, co_loc_weight: d[5], shared_days: 1,
    first_seen_date: "2026-10-06", last_seen_date: "2026-10-06",
    common_places: { Docks: 1 }, largest_shared_group: 2,
    recent_shared_samples_30d: d[5] / 2, growth_7d: d[7], growth_30d: d[8], tier: d[6],
    context: { directed_count: 0, reciprocal_directed: false, flow_count: 0, mb_flow_total: 0 },
  }));
  const muses = {};
  edgeDef.forEach((d) => { muses[d[1]] = d[3]; muses[d[2]] = d[4]; });
  return {
    meta: {
      sampled_at: sampledAt, generated_at: NOW, epoch: 1, epoch_started_at: "2026-09-01T00:00:00Z",
      collection_status: status, cadence_hours: 3, stale_after_hours: 7,
      source_window: sourceWindow,
      scoring: { formula: "warmth = SUM 2/(n-1) over shared observations", inputs: ["co-location rows"],
                 context_not_scoring: ["flows", "directed"] },
      scoring_version: "co-presence-2", schema_version: "public-3", publisher_version: "pub-1.0",
      socialites: socRoll, socialites_window: "30d",
    },
    muses,
    edges, index: {}, index_names: {},
  };
}

// A: the default (lifetime) graph with an honestly EMPTY socialites roll
const lifetimeA = mkGraph([], "2026-09-01T00:00:00Z .. " + NOW + " (lifetime)");
// B: the same shape carrying a NON-EMPTY roll (the synth for the stage test)
// — muse_a + muse_b are the two sides of the fixture's warmth-30 edge, so the
// stage's web has exactly one REAL inter-roll path to pin (and the roll's
// name carries the fixture's hostile payload — the pill must render it inert)
const lifetimeB = mkGraph(
  [{ muse_id: "muse_a", name: "Anastasia", window: "30d" },
   { muse_id: "muse_b", name: "Bet<script>ta", window: "30d" }],
  "past 30 days incl. all samples within " + NOW);
// the 30d tab file carries its own (non-empty) roll — per-window (v1.2.3)
const graph30d = lifetimeB;
// pub-1.2: a DIFFERENT roll in a different window file — the 7d stage must
// re-render with THIS roll (and muse_g|muse_i is NOT an edge in the fixture
// → zero paths, the honest edgeless case)
const graph7d = mkGraph(
  [{ muse_id: "muse_g", name: "Gale", window: "7d" },
   { muse_id: "muse_i", name: "Isla", window: "7d" }],
  "past 7 days incl. all samples within " + NOW);

const FIXTURES = { "data/graph.json": lifetimeA, "data/graph_30d.json": graph30d, "data/graph_7d.json": graph7d };
// part 3's own fixture: a THREE-muse roll + two GROWN inter-roll cross-edges
// (a real web needs edges among the roll; the pristine edgeDef is a perfect
// matching, so the soc fixture carries muse_a|muse_c + muse_c|muse_e the way
// a real snapshot would — edges are edges)
const socGraph = mkGraph(
  [{ muse_id: "muse_a", name: "Anastasia", window: "30d" },
   { muse_id: "muse_c", name: "Candor", window: "30d" },
   { muse_id: "muse_e", name: "Elm", window: "30d" }],
  "past 30 days incl. all samples within " + NOW);
socGraph.edges.push(
  { pair: "muse_a|muse_c", a: "muse_a", b: "muse_c", a_name: "Anastasia", b_name: "Candor",
    warmth: 8, co_locations: 4, co_loc_weight: 8, shared_days: 2, first_seen_date: "2026-09-20",
    last_seen_date: "2026-10-06", common_places: { Docks: 4 }, largest_shared_group: 2,
    recent_shared_samples_30d: 4, growth_7d: 0, growth_30d: 0, tier: "friendly",
    context: { directed_count: 0, reciprocal_directed: false, flow_count: 0, mb_flow_total: 0 } },
  { pair: "muse_c|muse_e", a: "muse_c", b: "muse_e", a_name: "Candor", b_name: "Elm",
    warmth: 5, co_locations: 2, co_loc_weight: 5, shared_days: 1, first_seen_date: "2026-10-01",
    last_seen_date: "2026-10-06", common_places: { Docks: 2 }, largest_shared_group: 3,
    recent_shared_samples_30d: 2, growth_7d: 0, growth_30d: 0, tier: null,
    context: { directed_count: 0, reciprocal_directed: false, flow_count: 0, mb_flow_total: 0 } });
const SOC_FIXTURES = { "data/graph.json": socGraph };

  // Z.shuffle runs in THIS realm (the module was required above), so the
  // patched Math.random === 0.5 applies — replicate its algorithm exactly.
  function expectedShuffle(list) {
  const items = list.slice();
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(0.5 * (i + 1));   // the patched Math.random() === 0.5
    const t = items[i]; items[i] = items[j]; items[j] = t;
  }
  return items;
}

function buildSiteSandbox(search, fixtures) {
  const shim = makeShim();
  const loc = {
    search, pathname: "/townhearts/", hash: "",
    href: "https://dustytext-bot.github.io/townhearts/" + search,
    replace() {},
  };
  const hist = { replaceState() {} };
  const sandbox = {
    location: loc, history: hist,
    document: shim.document, Date: PinnedDate, console,
    THZones: Z,   // index.html loads zone_rules.js first
    fetch: (url) => (url in fixtures)
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(fixtures[url]) })
      : Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SITE_SCRIPT, sandbox);
  return { shim, loc };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function findTab(shim, label) {
  const host = shim.elementFor("windows");
  for (const b of host.children) {
    if (shim.elementText(b) === label) return b;
  }
  return null;
}

// the standard homepage card (v1.2.4): div.card → div.duo (tier chip + the
// ONE "A ✦ B" pair text) → div.meta (ONE line)
const chain = (n) => (n.children || []).map((c) => c.className);
const isCard = (n) => n.className === "card" &&
  JSON.stringify(chain(n)) === JSON.stringify(["duo", "meta"]);
const namesOf = (shim, n) => {
  const duo = (n.children[0] && n.children[0].children) || [];
  return duo.filter((k) => !/^tier-chip tier-/.test(k.className))
            .map((k) => shim.elementText(k).trim());
};

(async () => {
  // the expected top-10: warmth desc, stable pairKey-asc tiebreak
  const expectedTop10 = edgeDef.slice(0, 10).map((d) => d[3] + " ✦ " + d[4]);

  // ---- 1. THE DEFAULT PAGE (no tab picked, no ?muse=) — the showcase ------
  {
    const run = buildSiteSandbox("", FIXTURES);
    await sleep(60);
    const { shim } = run;
    // Find-a-Muse at the top of the markup: above the focused view and every
    // results zone
    const idx = (s) => html.indexOf(s);
    if (!(idx('id="zone-find"') < idx('id="zone-focus"')))
      fail("the Find-a-Muse card must sit above the focused view in the markup");
    if (!(idx('id="zone-find"') < idx('id="zone-socialites"') &&
          idx('id="zone-find"') < idx('id="zone-growing"') &&
          idx('id="zone-find"') < idx('id="zone-bonds"')))
      fail("the Find-a-Muse card must sit above the results zones in the markup");
    // growing / sparks / framing: hidden entirely AND nothing rendered in
    if (shim.elementFor("zone-growing").style.display !== "none")
      fail("zone-growing must be hidden on the default page");
    if (shim.elementFor("zone-sparks").style.display !== "none")
      fail("zone-sparks must be hidden on the default page");
    if (shim.elementFor("zones-framing").style.display !== "none")
      fail("the zones framing line must be hidden on the default page");
    if (shim.elementFor("cards").children.length !== 0 ||
        shim.elementFor("growing-rest").children.length !== 0)
      fail("growing-now must not be rendered on the default page");
    if (shim.elementFor("sparks").children.length !== 0 ||
        shim.elementFor("sparks-rest").children.length !== 0)
      fail("new sparks must not be rendered on the default page");
    // socialites: an empty roll NO LONGER hides the section (v1.2.14, audit
    // P2) — the compact warming-up message shows, the stage stays EMPTY
    if (shim.elementFor("zone-socialites").style.display === "none")
      fail("the Socialites zone must stay discoverable on the default page");
    const socStatus = shim.elementText(shim.elementFor("soc-status"));
    if (!socStatus.includes("still warming up"))
      fail("an empty roll on the default page shows the warming-up message, got: " + JSON.stringify(socStatus));
    if (shim.elementFor("soc-stage").children.length !== 0)
      fail("no invented stage entries while the roll is empty");
    // pub-1.2: the empty window strips the stage panel and draws NO paths
    if (!shim.elementFor("zone-socialites").className.includes("soc-empty"))
      fail("an empty roll must badge the section soc-empty (no stage, no panel)");
    if (shim.elementFor("th-lines").children.length !== 0)
      fail("no connection paths while the roll is empty");
    // bonds: the strongest connections — exactly the top 10, standard cards
    if (shim.elementFor("zone-bonds").style.display === "none")
      fail("the bonds zone must be visible on the default page");
    const bTitle = shim.elementText(shim.elementFor("bonds-title"));
    if (!bTitle.includes("Strongest observed connections"))
      fail("showcase bonds title: " + JSON.stringify(bTitle));
    // v1.2.14: a complete+fresh dataset leaves BOTH banners empty
    if (shim.elementFor("stale-banner").children.length !== 0)
      fail("a fresh dataset must not show the stale banner");
    if (shim.elementFor("collection-banner").children.length !== 0)
      fail("a complete dataset must not show the partial-collection banner");
    if (shim.elementFor("grid").style.display !== "none")
      fail("the full table must be hidden on the default page");
    const showcaseCards = shim.elementFor("bonds-cards").children.filter((n) => isCard(n));
    if (showcaseCards.length !== 10)
      fail("the showcase must render exactly the top 10 pairs, got " + showcaseCards.length);
    const labels = showcaseCards.map((n) => namesOf(shim, n)[0]);
    if (JSON.stringify(labels) !== JSON.stringify(expectedTop10))
      fail("highest-relationships order (warmth desc, pairKey tie): " + JSON.stringify(labels));
    if (labels.some((l) => l.includes("Umber")))
      fail("pairs past the 10th must not render on the showcase");
    for (const c of showcaseCards) if (!namesOf(shim, c).some((s) => s.includes(" ✦ ")))
      fail("every showcase card ships the pair as one inline 'A ✦ B' text");
    const note = shim.elementText(shim.elementFor("grid-note"));
    if (!note.includes("tab"))
      fail("the showcase should hint at the window tabs for the full ledger: " + JSON.stringify(note));
    // Find-a-Muse still resolves + renders at the top
    if (!(shim.elementFor("muse-go")._listeners && shim.elementFor("muse-go")._listeners.click))
      fail("find button not wired");
    shim.elementFor("muse-q").value = "muse_u";
    shim.elementFor("muse-go").fireEvent("click");
    await sleep(20);
    if (shim.elementFor("muse-rows").children.length !== 1)
      fail("Find-a-Muse must still resolve + render its pairs from the top card");
    // hostile name rendered as inert text on the showcase path
    if (!shim.allText().includes("Bet<script>ta"))
      fail("the hostile name must render as inert text on the showcase");
    if (shim.violations.length)
      fail("HTML-injection APIs on the showcase path: " + JSON.stringify(shim.violations.slice(0, 3)));
    // v1.2.14: HIGHLIGHTS is a REAL selected tab — five tabs, HIGHLIGHTS
    // marked (class + aria-pressed), and re-clicking it changes nothing
    const tabHost = shim.elementFor("windows");
    if (tabHost.children.length !== 5)
      fail("five tabs (HIGHLIGHTS | LIFETIME | 30d | 7d | 24h), got " + tabHost.children.length);
    const hl = findTab(shim, "HIGHLIGHTS");
    if (!hl) fail("HIGHLIGHTS tab not rendered");
    if (hl.className !== "on")
      fail("HIGHLIGHTS must be the selected tab on the default page: " + JSON.stringify(hl.className));
    if (hl.attrs["aria-pressed"] !== "true")
      fail("HIGHLIGHTS aria-pressed must be true, got " + JSON.stringify(hl.attrs));
    const others = tabHost.children.filter((b) => b !== hl);
    if (others.some((b) => b.attrs["aria-pressed"] !== "false"))
      fail("unselected tabs must carry aria-pressed=false: " + JSON.stringify(others.map((b) => b.attrs)));
    const beforeCards = shim.elementFor("bonds-cards").children.filter((n) => isCard(n)).length;
    const beforeTitle = shim.elementText(shim.elementFor("bonds-title"));
    hl.fireEvent("click");
    await sleep(30);
    if (shim.elementFor("bonds-cards").children.filter((n) => isCard(n)).length !== beforeCards ||
        shim.elementText(shim.elementFor("bonds-title")) !== beforeTitle)
      fail("clicking the already-selected HIGHLIGHTS tab must be a no-op (idempotent)");
  }

  // ---- 2. THE LIFETIME TAB (AND EVERY WINDOW TAB) RESTORES THE FULL PAGE --
  {
    const run = buildSiteSandbox("", FIXTURES);
    await sleep(60);
    const { shim } = run;
    const tabLife = findTab(shim, "LIFETIME");
    if (!tabLife) fail("LIFETIME tab not rendered");
    tabLife.fireEvent("click");
    await sleep(60);
    for (const id of ["zones-framing", "zone-socialites", "zone-growing", "zone-sparks", "zone-bonds"]) {
      if (shim.elementFor(id).style.display === "none")
        fail(id + " must be visible in the full view after a tab click");
    }
    if (!shim.elementText(shim.elementFor("soc-status")).includes("no Socialites in this window"))
      fail("the full view keeps the Socialites honest empty state");
    if (!shim.elementText(shim.elementFor("bonds-title")).includes("All-time relationships"))
      fail("the full view must show the LIFETIME heading, got: " + JSON.stringify(shim.elementText(shim.elementFor("bonds-title"))));
    if (shim.elementFor("grid").style.display === "none")
      fail("the full table must be visible on tab views");
    // v1.2.14: progressive disclosure — the table opens on the first 12
    // relationships (of 14 here), with a live count and native buttons
    if (shim.elementFor("__tbody__").children.length !== 12)
      fail("the full table opens on the first 12 relationships, got " + shim.elementFor("__tbody__").children.length);
    if (!shim.elementText(shim.elementFor("bonds-count")).includes("showing 12 of 14 relationships"))
      fail("the disclosure count must state showing 12 of 14, got: " + JSON.stringify(shim.elementText(shim.elementFor("bonds-count"))));
    if (shim.elementFor("bonds-more25").style.display === "none" || shim.elementFor("bonds-showall").style.display === "none")
      fail("the disclosure buttons must be visible with rows remaining");
    if (shim.elementFor("bonds-cards").children.length !== 0)
      fail("the showcase cards must clear on the full view");
    if (shim.elementFor("cards").children.length < 1)
      fail("growing-now must render its output in the full view");
    // the selected tab's state flips to LIFETIME — buildTabs REBUILDS the
    // buttons on every load, so re-find them before reading their state
    const lifeNow = findTab(shim, "LIFETIME");
    if (!lifeNow || lifeNow.attrs["aria-pressed"] !== "true")
      fail("the activated LIFETIME tab must carry aria-pressed=true, got " + JSON.stringify(lifeNow && lifeNow.attrs));
    const hlNow = findTab(shim, "HIGHLIGHTS");
    if (!hlNow || hlNow.attrs["aria-pressed"] !== "false")
      fail("HIGHLIGHTS must carry aria-pressed=false after LIFETIME activates, got " + JSON.stringify(hlNow && hlNow.attrs));
    // expand: Show all appends the ranked remainder WITHOUT duplicates
    shim.elementFor("bonds-showall").fireEvent("click");
    await sleep(20);
    if (shim.elementFor("__tbody__").children.length !== 14)
      fail("Show all must render the complete table (14), got " + shim.elementFor("__tbody__").children.length);
    if (!shim.elementText(shim.elementFor("bonds-count")).includes("showing 14 of 14 relationships — all shown"))
      fail("the count must report the completed expansion, got: " + JSON.stringify(shim.elementText(shim.elementFor("bonds-count"))));
    if (shim.elementFor("bonds-more25").style.display !== "none" || shim.elementFor("bonds-showall").style.display !== "none")
      fail("the disclosure buttons must hide once everything is rendered");
    shim.elementFor("bonds-more25").fireEvent("click");
    if (shim.elementFor("__tbody__").children.length !== 14)
      fail("exhausted clicks must never duplicate rows");
    // re-clicking the SELECTED LIFETIME tab is a plain no-op: nothing
    // re-renders, nothing resets (the old code re-rendered in full mode — the
    // hidden-state flip the audit called out)
    tabLife.fireEvent("click");
    await sleep(20);
    if (shim.elementFor("__tbody__").children.length !== 14)
      fail("clicking the selected LIFETIME tab must be a no-op (no reset)");
    const rowPairs = shim.elementFor("__tbody__").children.map((tr) => shim.elementText(tr.children[1]));
    if (new Set(rowPairs).size !== rowPairs.length)
      fail("duplicate rows after repeated expansion: " + JSON.stringify(rowPairs.slice(0, 6)));
    // the growing zone's own featured/rest split stays pointer-based too:
    // 3 growing pairs here are all featured (under the cap), so its controls stay hidden
    if (shim.elementFor("growing-more").style.display !== "none")
      fail("nothing to disclose → the growing controls must stay hidden");
    // a different window: the 30d tab keeps the full page + its OWN roll
    const tab30 = findTab(shim, "30d");
    if (!tab30) fail("30d tab not rendered");
    tab30.fireEvent("click");
    await sleep(60);
    if (shim.elementFor("zone-socialites").style.display === "none")
      fail("the Socialites stage shows in the full 30d view");
    if (shim.elementFor("soc-stage").children.length !== 2)
      fail("the per-window roll's stage must render, got " +
        shim.elementFor("soc-stage").children.length);
    // pub-1.2: the stage renders the roll AS the medallions, in the
    // (deterministically stubbed) shuffled display order — muse_b's roll name
    // is the fixture's hostile payload: rendered as inert text
    const stageNames = shim.elementFor("soc-stage").children.map((b) => shim.elementText(b));
    if (JSON.stringify(stageNames) !== JSON.stringify(expectedShuffle(["Anastasia", "Bet<script>ta"])))
      fail("the medallions must be the roll names in shuffled order, got " + JSON.stringify(stageNames));
    // pub-1.2: LINES = REAL CONNECTIONS — the only inter-roll edge for this
    // roll is muse_a|muse_b → exactly ONE path, tagged with that pairKey
    const socPathsVol2 = shim.elementFor("th-lines").children;
    if (socPathsVol2.length !== 1 ||
        JSON.stringify(socPathsVol2.map((p) => p.attrs["data-pair"])) !== JSON.stringify(["muse_a|muse_b"]))
      fail("the stage must draw exactly the inter-roll edges, got " +
        JSON.stringify(socPathsVol2.map((p) => p.attrs && p.attrs["data-pair"])));
    if (socPathsVol2.length && socPathsVol2[0].className !== "th-path")
      fail("the connection path must carry the demo's th-path class");
    const vb = shim.elementFor("th-lines").attrs["viewBox"];
    if (!vb || !String(vb).startsWith("0 0 "))
      fail("the lines svg must carry its viewBox for the stage box, got: " + JSON.stringify(vb));
    // the medallions sit on the ellipse: the shim keeps the CSS custom props
    if (socPathsVol2.length){
      const b0 = shim.elementFor("soc-stage").children[0];
      if (b0.style["--x"] === undefined || b0.style["--y"] === undefined)
        fail("arrange() must position each medallion via --x/--y");
    }
    if (!shim.elementText(shim.elementFor("bonds-title")).includes("Relationships in the last 30 days"))
      fail("the 30d tab must show its own heading, got: " + JSON.stringify(shim.elementText(shim.elementFor("bonds-title"))));
    // v1.2.14: a window switch RESETS expansion — a fresh initial slice
    if (shim.elementFor("__tbody__").children.length !== 12)
      fail("switching windows must reset expansion to the initial slice, got " + shim.elementFor("__tbody__").children.length);
    // the New sparks section: 12 up front here, with the total + the honest
    // young-history explanation, revealed the same pointer-based way
    const sparksCount = shim.elementText(shim.elementFor("sparks-count"));
    if (!sparksCount.includes("showing 12 of 14 new sparks"))
      fail("New sparks must open on 12 with its total count, got: " + JSON.stringify(sparksCount));
    if (!sparksCount.includes("entire history is still young"))
      fail("New sparks must explain the size while the whole history is young: " + JSON.stringify(sparksCount));
    shim.elementFor("sparks-showall").fireEvent("click");
    await sleep(20);
    if (shim.elementFor("sparks-rest").children.length !== 2)
      fail("Show all must append the ranked remainder once, got " + shim.elementFor("sparks-rest").children.length);
    shim.elementFor("sparks-showall").fireEvent("click");
    if (shim.elementFor("sparks-rest").children.length !== 2)
      fail("repeated expansions must not duplicate spark rows");
    if (shim.elementFor("grid").style.display === "none")
      fail("every tab keeps the full table");
    // pub-1.2 (per-window, continued): the 7d tab's OWN file carries a
    // DIFFERENT roll — the stage re-renders with THAT roll (names change) —
    // and muse_g|muse_i is no fixture edge → ZERO paths (honest)
    const tab7 = findTab(shim, "7d");
    if (!tab7) fail("7d tab not rendered");
    tab7.fireEvent("click");
    await sleep(60);
    const names7 = shim.elementFor("soc-stage").children.map((b) => shim.elementText(b)).slice().sort();
    if (JSON.stringify(names7) !== JSON.stringify(["Gale", "Isla"]))
      fail("a window with a different roll must re-render the stage with THAT roll, got " + JSON.stringify(names7));
    if (shim.elementFor("th-lines").children.length !== 0)
      fail("an edgeless roll must draw zero paths (honest), got " +
        JSON.stringify(shim.elementFor("th-lines").children.map((p) => p.attrs && p.attrs["data-pair"])));
    const tab24 = findTab(shim, "24h");
    if (!tab24) fail("24h tab not rendered");
    tab24.fireEvent("click");
    await sleep(60);
    if (!shim.allText().includes("could not be loaded"))
      fail("a missing window file must render the honest load-error state");
    if (shim.elementFor("zone-growing").style.display === "none")
      fail("the full view restores on the error state too");
    if (shim.elementFor("stale-banner").children.length !== 0 || shim.elementFor("collection-banner").children.length !== 0)
      fail("a failed window load must not retain old banners");
    if (shim.violations.length)
      fail("HTML-injection APIs across the tab flow: " + JSON.stringify(shim.violations.slice(0, 3)));
  }

  // ---- 3. SYNTH ROLL: the stage shows on the DEFAULT page when non-empty --
  // pub-1.2 re-target: the dancing-bubble row + separate chip line are GONE —
  // the roll renders AS the 3D medallions (demo anatomy), each carrying its
  // own name pill; the real inter-roll edge(s) draw the web's paths; the
  // demo's hover/focus/click interactions name the socialite in the live hint.
  {
    const run = buildSiteSandbox("", SOC_FIXTURES);
    await sleep(60);
    const { shim } = run;
    if (shim.elementFor("zone-socialites").style.display === "none")
      fail("a non-empty roll must SHOW the Socialites stage on the default page");
    if (shim.elementFor("soc-stage").children.length !== 3)
      fail("one medallion per roll entry, got " + shim.elementFor("soc-stage").children.length);
    if (shim.elementFor("zone-socialites").className.includes("soc-empty"))
      fail("a populated roll must NOT badge the section soc-empty");
    if (shim.byId.has("soc-chips"))
      fail("the retired soc-chips row must not be re-created");
    // exactly the roll's names — in the deterministically shuffled order
    const stageBtns = shim.elementFor("soc-stage").children;
    const stageOrder = stageBtns.map((b) => shim.elementText(b));
    if (JSON.stringify(stageOrder) !== JSON.stringify(expectedShuffle(["Anastasia", "Candor", "Elm"])))
      fail("the medallions must be the roll names in shuffled order, got " + JSON.stringify(stageOrder));
    if (JSON.stringify(stageOrder) === JSON.stringify(["Anastasia", "Candor", "Elm"]))
      fail("the stubbed shuffle must actually reorder the roll (display-only shuffle is live)");
    // the demo's medallion anatomy: button > medallion > float > spinner > 3 hearts + the name pill
    const b0 = stageBtns[0];
    const medal = b0.children[0], flt = medal && medal.children[0], spin = flt && flt.children[0], pill = b0.children[1];
    if (!medal || medal.className !== "th-medallion" || !flt || flt.className !== "th-float" ||
        !spin || spin.className !== "th-spinner" || spin.children.length !== 3 ||
        spin.children.map((h) => h.className).join("|") !==
          "th-heart th-front|th-heart th-mid|th-heart th-back" ||
        !pill || pill.className !== "th-name")
      fail("the spinning-heart medallion anatomy must match the demo's: " +
        JSON.stringify(b0.children.map((c) => c.className)));
    // demo data attrs: the name (inert attribute — never markup) + the muse id
    if (b0.attrs["data-name"] !== "Anastasia" || b0.attrs["data-muse-id"] !== "muse_a")
      fail("each medallion must carry data-name + data-muse-id (inert attributes): " +
        JSON.stringify({ name: b0.attrs["data-name"], id: b0.attrs["data-muse-id"] }));
    if (b0.tagName !== "BUTTON" || b0.attrs.type !== "button")
      fail("each socialite must be a real button (keyboard-accessible)");
    // LINES = REAL CONNECTIONS: the roll {a, c, e} has exactly the two GROWN
    // inter-roll edges (muse_a|muse_c, muse_c|muse_e) → two paths, drawn in
    // pairKey order, tagged with their pairKeys
    const socPaths = shim.elementFor("th-lines").children;
    if (socPaths.length !== 2 ||
        JSON.stringify(socPaths.map((p) => p.attrs["data-pair"])) !==
          JSON.stringify(["muse_a|muse_c", "muse_c|muse_e"]) ||
        socPaths.some((p) => p.className !== "th-path" ||
                       !String(p.attrs.d || "").startsWith("M ")))
      fail("the stage must draw exactly the inter-roll edges as th-path elements, got " +
        JSON.stringify(socPaths.map((p) => p.attrs)));
    // demo interactions through the shim: hover/focus/click names them in the
    // live hint + lights THAT person's paths; leave/blur/toggle clears
    const anastasia = stageBtns[0];               // shuffled first = Anastasia
    anastasia.fireEvent("mouseenter");
    if (!shim.elementText(shim.elementFor("soc-status"))
      .includes("Showing Anastasia's connections (1 on this stage)"))
      fail("hovering a socialite must name them in the live hint: " +
        JSON.stringify(shim.elementText(shim.elementFor("soc-status"))));
    if (socPaths[0].className !== "th-path active" || !anastasia.className.includes("active"))
      fail("hovering a socialite must light their path + them: " +
        JSON.stringify([socPaths[0].className, anastasia.className]));
    anastasia.fireEvent("mouseleave");
    if (shim.elementText(shim.elementFor("soc-status")) !== "Hover, focus, or tap a Socialite.")
      fail("leaving must restore the demo's default hint");
    if (socPaths[0].className !== "th-path")
      fail("leaving must clear the path highlight");
    anastasia.fireEvent("focus");
    if (!shim.elementText(shim.elementFor("soc-status")).includes("Showing Anastasia's connections"))
      fail("focusing a socialite must name them too (keyboard parity)");
    anastasia.fireEvent("blur");
    if (anastasia.className.includes("active")) fail("blur must clear the person");
    anastasia.fireEvent("click");
    if (!anastasia.className.includes("active") || socPaths[0].className !== "th-path active")
      fail("clicking a socialite must activate them (tap target)");
    anastasia.fireEvent("click");
    if (anastasia.className.includes("active"))
      fail("clicking an active socialite must toggle them off (the demo's toggle)");
    // the multi-edge case: hovering the person in the MIDDLE of the web
    // lights BOTH of their paths and reports the count
    const candor = stageBtns[2];                  // shuffled [Anastasia, Elm, Candor]
    if (shim.elementText(candor) !== "Candor")
      fail("fixture sanity: the third medallion must be Candor");
    candor.fireEvent("mouseenter");
    if (!shim.elementText(shim.elementFor("soc-status"))
      .includes("Showing Candor's connections (2 on this stage)"))
      fail("hovering Candor must light BOTH paths + report the count: " +
        JSON.stringify(shim.elementText(shim.elementFor("soc-status"))));
    if (socPaths[0].className !== "th-path active" || socPaths[1].className !== "th-path active")
      fail("Candor's two paths must both light: " +
        JSON.stringify(socPaths.map((p) => p.className)));
    candor.fireEvent("mouseleave");
    if (socPaths[0].className !== "th-path" || socPaths[1].className !== "th-path")
      fail("leaving Candor must clear both paths");
    // nothing else changes: growing/sparks stay off, the top-10 stays
    if (shim.elementFor("zone-growing").style.display !== "none")
      fail("growing-now stays off the showcase even with a roll present");
    if (shim.elementFor("bonds-cards").children.filter((n) => isCard(n)).length !== 10)
      fail("the top-10 strongest connections unchanged with a roll present");
    if (shim.violations.length) fail("HTML-injection APIs on the synth-roll path");
  }

  // ---- 4. v1.2.14 banners on a partial+stale file (v1.3.3: partial hidden)
  // The audit's P0 (v1.2.14) made a partial collection_status visible on
  // EVERY view; v1.3.3 (owner call, 2026-10-06) hides that notice for now —
  // so on a partial+stale fixture the RED stale banner must show on every
  // view while the amber collection-banner stays empty, both clear exactly
  // as before on fresh/failed loads, and the two conditions stay apart.
  {
    const OLD = "2026-10-04T00:00:00Z";             // 36h before the pinned now → stale (> 7h)
    const P = "partial:legacy-name-ambiguity";      // the REAL dataset's own status
    const partialLifetime = mkGraph([], "x .. " + NOW + " (lifetime)", { status: P, sampled_at: OLD });
    const partial30 = mkGraph([], "past 30 days incl. all samples within " + OLD, { status: P, sampled_at: OLD });
    const freshComplete24 = mkGraph([], "past 24 hours incl. all samples within " + NOW, { status: "complete", sampled_at: NOW });
    const PARTIAL_FIXTURES = {
      "data/graph.json": partialLifetime,
      "data/graph_30d.json": partial30,
      "data/graph_24h.json": freshComplete24,
      // graph_7d.json intentionally absent → the failed-load branch
    };
    const run = buildSiteSandbox("", PARTIAL_FIXTURES);
    await sleep(60);
    const { shim } = run;
    const bannerText = (id) => shim.elementText(shim.elementFor(id));
    // on HIGHLIGHTS: the stale banner shows, the partial notice stays hidden
    if (!bannerText("stale-banner").includes("stale data"))
      fail("the stale banner must show for an old sampled_at on the default view");
    if (shim.elementFor("collection-banner").children.length !== 0)
      fail("the collection notice is owner-suppressed (v1.3.3): it must stay empty even when collection_status != complete, got: " + JSON.stringify(bannerText("collection-banner")));
    if (bannerText("stale-banner").includes("Partial dataset"))
      fail("the stale banner must never borrow the partial notice's copy");
    if (shim.violations.length) fail("HTML-injection APIs on the banner path: " + JSON.stringify(shim.violations.slice(0, 3)));
    // the LIFETIME tab: same file — stale shows, partial stays hidden
    findTab(shim, "LIFETIME").fireEvent("click");
    await sleep(40);
    if (!bannerText("stale-banner").includes("stale data"))
      fail("the stale banner must stay visible on every tab");
    if (shim.elementFor("collection-banner").children.length !== 0)
      fail("the suppressed collection notice must stay empty on every tab");
    // the 30d tab (its own file, same partial status) — same story
    findTab(shim, "30d").fireEvent("click");
    await sleep(40);
    if (!bannerText("stale-banner").includes("stale data"))
      fail("the stale banner must stay visible on window tabs too");
    if (shim.elementFor("collection-banner").children.length !== 0)
      fail("the suppressed collection notice must stay empty on window tabs too");
    // the 24h tab (complete + fresh): CLEAR BOTH — the fresh-data branches
    findTab(shim, "24h").fireEvent("click");
    await sleep(40);
    if (shim.elementFor("stale-banner").children.length !== 0)
      fail("a fresh dataset must clear a stale banner");
    if (shim.elementFor("collection-banner").children.length !== 0)
      fail("a complete dataset must clear the partial-collection banner");
    // the 7d tab (missing file): the failure must not retain old warnings
    findTab(shim, "7d").fireEvent("click");
    await sleep(40);
    if (shim.elementFor("stale-banner").children.length !== 0 || shim.elementFor("collection-banner").children.length !== 0)
      fail("a failed window load must not retain old banners");
    if (shim.elementFor("zone-growing").style.display === "none")
      fail("the full view restores on the error state too");
    // back to HIGHLIGHTS: the stale banner returns (the file is stale again);
    // the collection notice stays owner-suppressed
    findTab(shim, "HIGHLIGHTS").fireEvent("click");
    await sleep(40);
    if (!bannerText("stale-banner").includes("stale data") || shim.elementFor("collection-banner").children.length !== 0)
      fail("returning to a partial+stale view must re-show the stale banner and keep the notice hidden");
  }

  console.log("showcase check OK: HIGHLIGHTS is the real selected default tab (idempotent), the showcase = Find-a-Muse top + warming-up/active Socialites + the top-10 strongest connections, the stale banner shows on stale views while the owner-suppressed partial notice stays hidden (v1.3.3) and both clear on fresh/failed loads; LIFETIME + window tabs restore the full page with per-window headings and pointer-based progressive disclosure (no duplicate rows, reset on window change)");
  process.exit(0);
})().catch((err) => { console.error("FAIL: " + (err && err.stack || err)); process.exit(1); });