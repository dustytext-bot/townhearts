// TownHearts renderer safety check — runs the index.html script under a
// minimal DOM shim and asserts that malicious data values are rendered as
// inert TEXT (text nodes only) and never routed into HTML parsing.
//
// Usage: node test_assets/render_check.js <index.html> <fixture.json>
// Exit 0 = safe; exit 1 = violation. Used by pytest (skip if node missing).
// v1.2.4: additionally asserts the growing-now cards use the standard
// homepage card class structure (the v1.2.2 focused-view pattern):
// div.card → div.duo (tier chip + the ONE "A ✦ B" pair text) → div.meta
// (ONE warmth line); edges get positive growth in-memory so the zone
// actually features cards, with the hostile names kept in the rendered
// structure.
// public-3 (hybrid migration phase B): the fixture is public-3 shaped —
// NO event arrays (flows/directed), no previews/reasons/amounts/exact
// timestamps exist. The harness asserts the fixture shape, drives the pair
// lookup, and pins the NEW aggregate evidence lines while asserting the
// per-event detail classes render NOWHERE.

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const Z = require(path.join(__dirname, "..", "zone_rules.js"));

const htmlPath = process.argv[2];
const fixturePath = process.argv[3];
const html = fs.readFileSync(htmlPath, "utf8");
const graph = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
// public-3 shape: the fixture itself must carry NO event arrays, and the
// site reads no such fields — assert the fixture before rendering.
for (const banned of ["flows", "directed"]){
  if (Object.prototype.hasOwnProperty.call(graph, banned)) { console.error("FAIL: fixture carries a " + banned + " event array — not public-3"); process.exit(1); }
  if (graph.meta && Object.prototype.hasOwnProperty.call(graph.meta, banned)) { console.error("FAIL: fixture meta carries " + banned); process.exit(1); }
}
for (const e of graph.edges || []) {
  const ctx = e.context || {};
  for (const banned of ["flows", "directed"]){
    if (Object.prototype.hasOwnProperty.call(ctx, banned)) { console.error("FAIL: fixture edge context carries a " + banned + " array — not public-3"); process.exit(1); }
  }
}
// v1.2.4: the fixture's edges carry no growth, so they qualify for no growing
// card — the structure check needs one. Re-render with positive growth while
// keeping every hostile name/preview/reason intact.
const synth = Object.assign({}, graph, {
  edges: graph.edges.map((e) => Object.assign({}, e, { growth_7d: 1, growth_30d: 1 })),
});

// v1.2.6: the 'Audited in public' banner must be the LAST visible section of
// the page — a footer position after every results zone/section. Static
// markup check: the banner is plain markup (not rendered data), so the
// position is pinned against the source HTML itself. Nothing visible (any
// tag with a name) may sit between the banner's closing div and the first
// <script>.
const bannerAt = html.indexOf("Audited in public.");
if (bannerAt < 0) { console.error("FAIL: the audit banner must be present"); process.exit(1); }
const footerAt = html.indexOf("</footer>");
if (footerAt < 0 || footerAt > bannerAt) {
  console.error("FAIL: the audit banner must sit after the page footer (page bottom)");
  process.exit(1);
}
const bannerTail = html.slice(html.indexOf("</div>", bannerAt) + "</div>".length,
                              html.indexOf("<script", bannerAt));
if (bannerTail === "" || /<[a-zA-Z]/.test(bannerTail)) {
  console.error("FAIL: nothing visible may follow the audit banner before the scripts");
  process.exit(1);
}

const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("no script block found"); process.exit(1); }

const violations = [];
const textLog = [];

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
    setAttribute(key, val) { (node.attrs ||= {})[key] = String(val); if (key === "class") node.className = String(val); },
    getAttribute(key) { const v = node.attrs && node.attrs[key]; return v == null ? null : v; },
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

const byId = new Map();
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

const sandbox = {
  document,
  Date,
  console,
  THZones: require(path.join(__dirname, "..", "zone_rules.js")),  // the site loads it first
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(synth) }),
};
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);

setTimeout(async () => {
  // v1.2.5: the initial load — no tab picked, no ?muse= — is the default
  // page's curated showcase: growing/sparks not rendered, the bonds area on
  // its "highest relationships" hat (top-10 standard cards). The card
  // structure assertions below want the FULL view, so restore it by clicking
  // the LIFETIME tab (any tab click = the full view) and let the same
  // assertions run over the re-render.
  const elementText = (node) => {
    let out = "";
    for (const c of (node && node.children) || []) out += (c && typeof c.text === "string") ? c.text : elementText(c);
    return out;
  };
  const gZone = document.getElementById("zone-growing"), sZone = document.getElementById("zone-sparks"),
        fZone = document.getElementById("zones-framing"), bZone = document.getElementById("zone-bonds");
  if (!gZone || !sZone || !fZone || !bZone) { console.error("FAIL: showcase zone elements missing"); process.exit(1); }
  if (gZone.style.display !== "none" || sZone.style.display !== "none" || fZone.style.display !== "none") {
    console.error("FAIL: the default page must hide growing/sparks/framing entirely (showcase)");
    process.exit(1);
  }
  const gCards0 = (byId.get("cards") || {}).children || [];
  if (gCards0.filter((n) => n.className === "card").length) {
    console.error("FAIL: growing-now must not render on the default page (showcase)");
    process.exit(1);
  }
  const showcaseCards = (byId.get("bonds-cards") || {}).children || [];
  if (!showcaseCards.filter((n) => n.className === "card").length) {
    console.error("FAIL: the showcase must render its highest-relationships cards on the default load");
    process.exit(1);
  }
  // (the full-table visibility on the showcase is asserted by
  // showcase_check and zone tests; here only the cards matter)
  const tabs = ((byId.get("windows") || {}).children || []);
  const lifeTab = tabs.find((b) => elementText(b) === "LIFETIME");
  if (!lifeTab || !lifeTab._listeners || !lifeTab._listeners.click) {
    console.error("FAIL: tabs not wired for the showcase → full-view restoration");
    process.exit(1);
  }
  lifeTab.fireEvent("click");
  await new Promise((res) => setTimeout(res, 30));
  if (gZone.style.display === "none") {
    console.error("FAIL: the LIFETIME tab click must restore the full view (growing zone visible)");
    process.exit(1);
  }
  // v1.2.4: the growing-now featured cards must render through the standard
  // homepage card component — the same pattern the v1.2.2 focused-view
  // assertion uses. One coherent header line (the tier chip inline with the
  // pair as a single "A ✦ B" text node — the homepage table's convention) and
  // ONE meta warmth line: no per-segment elements to stack, no blank-line
  // bar, no standalone ✦ glyph, whatever the renderer does with flex.
  const textOf = (node) => {
    if (node && typeof node.text === "string") return node.text;
    let out = "";
    for (const c of (node && node.children) || []) out += (c && typeof c.text === "string") ? c.text : textOf(c);
    return out;
  };
  const growingCards = ((byId.get("cards") || {}).children || []).filter((n) => n.className === "card");
  if (!growingCards.length) {
    console.error("FAIL: no growing-now cards rendered — the structure check needs at least one");
    process.exit(1);
  }
  const byNames = {};
  for (const e of synth.edges) byNames[e.a_name + " ✦ " + e.b_name] = e;
  for (const card of growingCards) {
    const chain = card.children.map((c) => c.className);
    if (JSON.stringify(chain) !== JSON.stringify(["duo", "meta"])) {
      console.error("FAIL: growing card class chain is not the homepage anatomy [duo, meta]: " + JSON.stringify(chain));
      process.exit(1);
    }
    const headerKids = card.children[0].children || [];
    const chips = headerKids.filter((k) => /^tier-chip tier-/.test(k.className));
    const names = headerKids.filter((k) => !/^tier-chip tier-/.test(k.className));
    if (headerKids.length !== 2 || chips.length !== 1 || names.length !== 1) {
      console.error("FAIL: the card header must be exactly the tier chip + the ONE pair text: " +
        JSON.stringify(headerKids.map((k) => [k.className, textOf(k)])));
      process.exit(1);
    }
    if (headerKids.some((k) => !textOf(k).trim())) {
      console.error("FAIL: the card header must have no blank segments");
      process.exit(1);
    }
    const headerText = textOf(names[0]).trim();
    if (headerText === "✦" || !byNames[headerText]) {
      console.error("FAIL: the pair must ship as ONE \"A ✦ B\" text node (homepage convention), got: " +
        JSON.stringify(textOf(names[0])));
      process.exit(1);
    }
    const metaLine = (card.children[1].children || []).map((k) => textOf(k));
    if (metaLine.length !== 1 || !metaLine[0].trim()) {
      console.error("FAIL: the warmth row must be ONE meta line with no blank segments: " + JSON.stringify(metaLine));
      process.exit(1);
    }
    const e = byNames[headerText];
    const expect = "🔥 warmth " + Z.displayWarmth(e.warmth) + " · +" + Z.displayWarmth(1) + " (7d) · +" + Z.displayWarmth(1) + " (30d) · last " + e.last_seen_date;
    if (metaLine[0] !== expect) {
      console.error("FAIL: growing meta line mismatch: " + JSON.stringify(metaLine[0]) + " vs " + JSON.stringify(expect));
      process.exit(1);
    }
  }
  // drive the pair-lookup path so the aggregate evidence renders too
  const qa = document.getElementById("q-a"), qb = byId.get("q-b"), go = byId.get("q-go");
  if (qa && qb && go && go._listeners && go._listeners.click) {
    qa.value = graph.edges[0].a;
    qb.value = graph.edges[0].b;
    go.fireEvent("click");
  } else {
    console.error("FAIL: lookup controls not wired (q-a/q-b/q-go + click listener)");
    process.exit(1);
  }
  // every dynamic string must appear as pure text somewhere: public-3 keeps
  // only names/roster/place strings — the hostile fixture names must render
  // as inert text. (Roster entries with no edge in the fixture never render
  // — names display only through observed pairs — so payloads cover what the
  // site actually draws: edge names + place strings.)
  const payloads = [];
  for (const e of graph.edges) {
    payloads.push(e.a_name, e.b_name);
    for (const p of Object.keys(e.common_places || {})) payloads.push(p);
  }
  // pub-1.2: the Socialites stage renders the roll's names too — the same
  // inert-text contract (the fixture's roll name is itself a payload)
  for (const s of (graph.meta.socialites || [])) payloads.push(s.name);
  const evidenceText = (byId.get("q-evidence").children || []).map(textOf).join("\n");
  // the NEW aggregate evidence lines, on the mandated shape
  const e0 = graph.edges[0];
  const ctx0 = e0.context || {};
  const needs = [];
  if (ctx0.directed_count > 0) needs.push("Public directed interaction",
    ctx0.directed_count + " directed line" + (ctx0.directed_count === 1 ? "" : "s") + " observed · " +
    (ctx0.reciprocal_directed ? "reciprocal" : "not reciprocal"));
  if (ctx0.flow_count > 0) needs.push("Public Musebuck activity",
    ctx0.flow_count + " public flow" + (ctx0.flow_count === 1 ? "" : "s") + " observed");
  needs.push("Observation evidence", "Most common public locations", "largest shared group");
  const evidenceJoined = evidenceText.replace(/\s+/g, " ").toLowerCase();
  const missingEvidence = needs.filter((n) => !evidenceJoined.includes(String(n).replace(/\s+/g, " ").toLowerCase()));
  // absences: no per-event detail may render anywhere in the body
  const allText = textLog.join("\n");
  const forbidden = ["speech at ", "\u201C", "MB \u2014", "ignore previous instructions"];
  const leaked = forbidden.filter((n) => allText.includes(n));
  if (missingEvidence.length) {
    console.error("FAIL: aggregate evidence lines missing:", JSON.stringify(missingEvidence));
    process.exit(1);
  }
  if (leaked.length) {
    console.error("FAIL: per-event detail leaked into the render:", JSON.stringify(leaked));
    process.exit(1);
  }
  const missing = payloads.filter((p) => !allText.includes(p));
  if (missing.length) {
    console.error("FAIL: payloads not rendered as text (dropped/mangled):", JSON.stringify(missing.slice(0, 5)));
    process.exit(1);
  }
  if (violations.length) {
    console.error("FAIL: HTML-injection APIs were used:", violations.slice(0, 5));
    process.exit(1);
  }
  console.log("render check OK: " + payloads.length + " untrusted values rendered as inert text, no HTML-parsing APIs used; " +
    growingCards.length + " growing-now card(s) on the homepage card anatomy (one header line + one warmth line); " +
    "aggregate evidence lines verified (no per-event detail anywhere); " +
    "default-page HIGHLIGHTS showcase verified (no growing/sparks render, strongest-connections cards up) and the LIFETIME tab restores the full view");
  process.exit(0);
}, 50);