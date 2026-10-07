// TownHearts find-a-muse form resolution check (v1.2.7, spec 14500) —
// browser-free node harness. The Find-a-Muse form (findMuse) and the pair
// lookup (doLookup) shared a LOCAL case-sensitive resolve (index.html), so a
// query typed in any other case ("Snarlinggenie" for the roster's own
// lowercase "snarlinggenie") answered "matches 0 muses" while the ?muse=
// deep-link path (zone_rules.resolveMuse) resolved the same name fine.
// This harness runs the REAL index.html inline script against the REPO'S
// OWN sanitized public-3 sample (data/*.json) under a DOM shim and pins the
// deterministic resolution contract on BOTH paths:
//   - exact muse id (any case) wins, trimmed queries match case-insensitively,
//   - a unique case-insensitive prefix resolves,
//   - duplicate names answer with the honest count,
//   - unknown names keep the honest not-found copy.
// Usage: node test_assets/find_form_check.js <index.html>
// Exit 0 = verified; 1 = violation. Used by pytest (skips if node missing).

"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const indexHtml = fs.readFileSync(process.argv[2], "utf8");
const siteMatch = indexHtml.match(/<script>([\s\S]*?)<\/script>/);
if (!siteMatch) { console.error("FAIL: no inline script in index.html"); process.exit(1); }
const SITE_SCRIPT = siteMatch[1];

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

// ---------------- the repo's sanitized public-3 sample ---------------------

const DATA_DIR = path.join(path.dirname(path.resolve(process.argv[2])), "data");
const FILES = ["data/graph.json", "data/graph_30d.json", "data/graph_7d.json", "data/graph_24h.json"];
const FIXTURES = {};
for (const f of FILES) {
  const p = path.join(DATA_DIR, path.basename(f));
  if (!fs.existsSync(p)) fail("missing live data file: " + f);
  FIXTURES[f] = JSON.parse(fs.readFileSync(p, "utf8"));
}

const lifetime = FIXTURES["data/graph.json"];
const roster = (lifetime && lifetime.muses) || {};
if (!Object.keys(roster).length) fail("the live graph.json carries no roster");

// ---- sample-data pins (spec 14500), derived not guessed -------------------
// The spec pin: exactly one roster muse whose display name is
// "snarlinggenie" ignoring case ("Snarlinggenie" must resolve to it).

let targetId = null, targetName = null;
for (const [id, name] of Object.entries(roster)) {
  if (typeof name === "string" && name.toLowerCase() === "snarlinggenie") {
    if (targetId && targetId !== id)
      fail("the live roster has two snarlinggenie muses (" + targetId + ", " + id + ") — review the pins");
    targetId = id; targetName = name;
  }
}
if (!targetId) fail("the live roster lost the snarlinggenie pin (spec 14500) — review this harness against the new data");
// the reported repro (spec 14500 / hybrid phase B): the mixed-case query
// "Snarlinggenie" must land on the canonical muse id muse_j03y2bfbin — the
// pin the shipped sample must reproduce (re-derive if the sample changes).
if (targetId !== "muse_j03y2bfbin") fail("the spec-14500 repro target changed: got " + targetId + ", expected muse_j03y2bfbin — review the pins against the shipped sample");

// a UNIQUE case-insensitive prefix of the target name (deterministic pick:
// the shortest prefix of length >= 2 that stays unique and is not an id key;
// the full lowercase name is the guaranteed fallback)
let uniquePrefix = null;
for (let len = 2; len < targetName.length; len++) {
  const p = targetName.slice(0, len).toLowerCase();
  const hits = Object.entries(roster).filter(([, n]) => typeof n === "string" && n.toLowerCase().startsWith(p));
  if (hits.length === 1 && !Object.prototype.hasOwnProperty.call(roster, p)) { uniquePrefix = p; break; }
  if (hits.length > 1) break;   // the prefix collides before it becomes unique
}
if (!uniquePrefix) uniquePrefix = targetName.toLowerCase();

// a duplicate display name (two ids, one case-insensitive name) — the
// lexicographically first, deterministically derived from the sample roster
const lcMap = new Map();
for (const [id, name] of Object.entries(roster)) {
  if (typeof name !== "string" || !name) continue;
  const k = name.toLowerCase();
  if (!lcMap.has(k)) lcMap.set(k, []);
  lcMap.get(k).push(id);
}
let dupName = null, dupIds = [];
for (const [k, ids] of [...lcMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  if (ids.length >= 2) { dupName = k; dupIds = ids; break; }
}
if (!dupName) fail("the live roster has no duplicate display name — the ambiguity pins need review");
let dupSpelling = null;
for (const [id, name] of Object.entries(roster)) {
  if (dupIds.includes(id) && typeof name === "string" && name) { dupSpelling = name; break; }
}
if (!dupSpelling) fail("duplicate roster entries must carry string names for the pins");

// a pairing partner for the target muse, from the sample's id index
// (deterministic first hit in key order) — pins the pair-lookup (doLookup)
// path over the published aggregates
let partnerId = null;
for (const k of Object.keys(lifetime.index || {})) {
  const sides = k.split("|");
  if (sides.includes(targetId) && sides.length === 2) {
    partnerId = sides[0] === targetId ? sides[1] : sides[0];
    break;
  }
}
if (!partnerId) fail("the live index has no observed pair for " + targetId + " — review the pins");

const UNKNOWN = "zzzz-no-such-muse";

const Z = require(path.join(__dirname, "..", "zone_rules.js"));

function buildSiteSandbox(search, opts) {
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
    // the real page loads zone_rules.js as a script tag exposing THZones;
    // opts.noZ simulates the library failing to load entirely
    THZones: (opts && opts.noZ) ? undefined : Z,
    fetch: (url) => (url in FIXTURES)
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(FIXTURES[url]) })
      : Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SITE_SCRIPT, sandbox);
  return { shim, locCalls, histCalls, loc, sandbox };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const sleepMs = 60;

// the FORM path: type into the Find-a-Muse input and press the find button
function runForm(run, query) {
  const input = run.shim.elementFor("muse-q");
  input.value = query;
  run.shim.elementFor("muse-go").fireEvent("click");
  return {
    status: run.shim.elementText(run.shim.elementFor("muse-status")),
    rows: run.shim.elementText(run.shim.elementFor("muse-rows")),
  };
}

async function checkForms() {
  const expected = "“" + targetName + "” (" + targetId + ")";
  const notFoundCopy = "matches 0 muses — enter the muse id instead (ids are canonical; names can change and collide)";

  // A. the reported repro (spec 14500): mixed-case roster name
  {
    const run = buildSiteSandbox("");
    await sleep(sleepMs);
    const r = runForm(run, "Snarlinggenie");
    if (r.status.includes("matches 0 muses"))
      fail("spec 14500 repro must not answer 'matches 0 muses' for 'Snarlinggenie': " + JSON.stringify(r.status));
    if (!r.status.includes(expected))
      fail("'Snarlinggenie' must resolve to “" + targetName + "” (" + targetId + "): " + JSON.stringify(r.status));
    if (!r.rows.length) fail("a resolved muse must render its strongest-pairs rows");
    if (run.shim.violations.length) fail("HTML-injection APIs used by the form path: " + JSON.stringify(run.shim.violations.slice(0, 3)));
  }

  // B. all-caps + padded (trim) spellings resolve to the same muse
  for (const q of ["SNARLINGGENIE", "  snarlinggenie  ", "\nsnArLiNgGeNiE\t"]) {
    const run = buildSiteSandbox("");
    await sleep(sleepMs);
    const r = runForm(run, q);
    if (!r.status.includes(expected))
      fail("case/trim query " + JSON.stringify(q) + " must resolve to " + targetId + ": " + JSON.stringify(r.status));
    if (run.shim.violations.length) fail("HTML-injection APIs used for " + JSON.stringify(q) + ": " + JSON.stringify(run.shim.violations.slice(0, 3)));
  }

  // C. exact-id and case-insensitive-id both win (ids canonical)
  for (const q of [targetId, targetId.toUpperCase(), targetId.slice(0, 3) + targetId.slice(3).toUpperCase()]) {
    const run = buildSiteSandbox("");
    await sleep(sleepMs);
    const r = runForm(run, q);
    if (!r.status.includes(expected))
      fail("id query " + JSON.stringify(q) + " must resolve to " + targetId + ": " + JSON.stringify(r.status));
  }

  // D. unique case-insensitive prefix resolves the same muse
  {
    const run = buildSiteSandbox("");
    await sleep(sleepMs);
    const r = runForm(run, uniquePrefix);
    const idIn = "(" + targetId + ")";
    if (!r.status.includes(idIn))
      fail("unique prefix " + JSON.stringify(uniquePrefix) + " must resolve to " + targetId + ": " + JSON.stringify(r.status));
    if (run.shim.violations.length) fail("HTML-injection APIs used by the prefix run: " + JSON.stringify(run.shim.violations.slice(0, 3)));
  }

  // E. duplicate display name → the honest count, never a guess
  {
    const run = buildSiteSandbox("");
    await sleep(sleepMs);
    const r = runForm(run, dupSpelling);
    if (!r.status.includes("“" + dupSpelling + "” matches " + dupIds.length + " muses — enter the muse id instead (ids are canonical; names can change and collide)"))
      fail("duplicate name " + JSON.stringify(dupSpelling) + " must answer the honest count (" + dupIds.length + "): " + JSON.stringify(r.status));
  }

  // F. genuinely unknown name → the honest not-found copy stays
  {
    const run = buildSiteSandbox("");
    await sleep(sleepMs);
    const r = runForm(run, "  " + UNKNOWN + "  ");
    if (!r.status.includes("“" + UNKNOWN + "” " + notFoundCopy))
      fail("unknown name must keep the honest not-found copy: " + JSON.stringify(r.status));
    if (r.rows.length) fail("an unresolved query must not render rows: " + JSON.stringify(r.rows.slice(0, 80)));
  }

  // G. the pair lookup (doLookup) resolves through the same rules
  {
    const run = buildSiteSandbox("");
    await sleep(sleepMs);
    const inputA = run.shim.elementFor("q-a");
    const inputB = run.shim.elementFor("q-b");
    inputA.value = "Snarlinggenie";        // mixed case, the reported spelling
    inputB.value = roster[partnerId];
    run.shim.elementFor("q-go").fireEvent("click");
    const status = run.shim.elementText(run.shim.elementFor("q-status"));
    if (status.includes("matches 0 muses"))
      fail("pair lookup must not answer 'matches 0 muses' for the mixed-case roster name: " + JSON.stringify(status));
    const canonical = [targetId, partnerId].slice().sort().join("|");
    if (!status.includes("pairKey = " + canonical))
      fail("pair lookup must build the canonical pairKey " + canonical + ": " + JSON.stringify(status));
  }

  // H. no-library fallback (THZones missing): the strict cases still work —
  // exact id, case-insensitively matched id, case-insensitive display name;
  // a prefix that the fallback can not check answers with the honest count,
  // never the muse the prefix happens to point at.
  {
    const run = buildSiteSandbox("", { noZ: true });
    await sleep(sleepMs);
    for (const q of [targetId, "  " + targetName + "  ", targetName.toUpperCase()]) {
      const r = runForm(run, q);
      if (!r.status.includes(expected))
        fail("no-Z fallback must still resolve " + JSON.stringify(q) + ": " + JSON.stringify(r.status));
    }
    const pre = runForm(run, uniquePrefix);
    if (pre.status.includes("“" + targetName + "” ("))
      fail("no-Z fallback must not fake a prefix resolution: " + JSON.stringify(pre.status));
    if (!pre.status.includes("muses — enter the muse id instead"))
      fail("no-Z fallback prefix answer must stay the honest form copy: " + JSON.stringify(pre.status));
  }
}

async function checkFocus() {
  // H. the deep-link path on the LIVE data: mixed case still focused
  {
    const run = buildSiteSandbox("?muse=Snarlinggenie");
    await sleep(sleepMs);
    const title = run.shim.elementText(run.shim.elementFor("focus-title"));
    if (!(title.includes("Focused on ") && title.includes(targetName) && title.includes("id " + targetId)))
      fail("?muse=Snarlinggenie must focus the live muse: " + JSON.stringify(title));
  }

  // I. the deep-link path also matches the id in any case (v1.2.7)
  {
    const run = buildSiteSandbox("?muse=" + encodeURIComponent(targetId.toUpperCase()));
    await sleep(sleepMs);
    const title = run.shim.elementText(run.shim.elementFor("focus-title"));
    if (!(title.includes("Focused on ") && title.includes(targetName) && title.includes("id " + targetId)))
      fail("?muse= with an upper-cased id must focus the live muse: " + JSON.stringify(title));
  }

  // J. trimmed + case-insensitive deep link
  {
    const run = buildSiteSandbox("?muse=" + encodeURIComponent("  SNARLINGGENIE  "));
    await sleep(sleepMs);
    const title = run.shim.elementText(run.shim.elementFor("focus-title"));
    if (!(title.includes("Focused on ") && title.includes(targetName)))
      fail("a padded + all-caps ?muse= must focus the live muse: " + JSON.stringify(title));
  }

  // K. unknown ?muse= stays honest on the live data
  {
    const run = buildSiteSandbox("?muse=" + UNKNOWN);
    await sleep(sleepMs);
    const note = run.shim.elementText(run.shim.elementFor("focus-note"));
    if (!note.includes("no muse with that name in the current graph"))
      fail("unknown deep-link muse must be answered honestly: " + JSON.stringify(note));
  }
}

(async () => {
  await checkForms();
  await checkFocus();
  console.log("find-form check OK: the reported 0-match repro resolves (" + targetId + "), ids/cases/trim/prefix resolve, " +
    "duplicates answer honestly, unknown stays honest — form AND deep-link paths");
})().catch((e) => { console.error("FAIL: " + e.message); process.exit(1); });