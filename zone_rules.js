/*
 * TownHearts zone rules (v1.2) — the site's five-zone results area as pure,
 * importable logic (no DOM, no fetch, no LLM, no Musebuck inputs).
 *
 * Loaded by index.html BEFORE the inline script (sets window.THZones) and
 * required directly by the node test harnesses, so the browser render and
 * the tests exercise the same functions.
 *
 * Zone rules implemented here:
 *   growingNow — zone 2: pairs with growth (7d or 30d) > 0, ranked by
 *     growth_7d (tiebreak growth_30d, then pairKey). Socialite-a-socialite
 *     pairs are excluded entirely; within the first 10 rows at most ONE row
 *     per socialite appears — every further socialite row (and every row
 *     past the 10th) continues after the divider in the `rest` block,
 *     keeping its ranked position.
 *   newSparks  — zone 3: pairs whose first_seen_date falls within
 *     opts.days (30) of anchorIso (meta.sampled_at; date-level evidence in
 *     public-3), newest first; the first opts.cap (12) rows are the featured
 *     block, the rest continue after the divider.
 *   allBonds   — zone 4: the full table by warmth (tiebreak pairKey),
 *     unfiltered.
 *   musePairs  — zone 5: one muse's pairs, strongest first (top-N capped by
 *     the caller's divider rendering).
 *   socialiteIds — roll entries -> muse ids.
 *   resolveMuse — muse deep links (v1.2.1): name resolution for ?muse=<name>
 *     and the 404.html path bridge — exact muse id wins, then the exact
 *     display name (case-sensitive), then case-insensitive over the roster
 *     values and the index_names keys' two sides (legacy names a rename left
 *     behind still resolve), then a unique case-insensitive prefix match;
 *     anything else is an honest not-found answer carrying the candidate
 *     muses for "did you mean…" chips. Never invents a match.
 *   focusSummary — the focused view's summary math: unique connections,
 *     per-tier counts, total recent growth_7d, strongest pair (still a
 *     reported rate; nothing here changes warmth, co_locations, or a tier).
 *   focusCardView (v1.2.2) — the focused view's pair card as a pure,
 *     browser-free view-model (tier, names label + ✦, warmth, bar width,
 *     reported growth rates, first/last seen DATES — public-3 publishes
 *     dates only); the focused renderer
 *     turns it into the SAME homepage card markup the zones use, and the
 *     tests assert the shape without a browser.
 *   topBonds (v1.2.5) — the default-page showcase: ONLY the highest
 *     relationships — the allBonds order (warmth desc, pairKey-asc tiebreak)
 *     sliced to a cap (default 10). Pure presentation; never a data edit.
 *   displayWarmth (v1.2.14) — the ONE shared warmth display formatter for
 *     every UI surface: full precision stays in the files and SQLite; the UI
 *     shows a human number (integers plain, other values rounded to 2
 *     decimals with trailing zeros trimmed, values below 0.01 as "<0.01",
 *     non-finite as a dash). Pure formatting; never changes a calculation or
 *     a stored value.
 *   shuffle    — zone 1 stage ORDER only: randomized per page load
 *     (Fisher–Yates, Math.random). The roll itself is deterministic in the
 *     file (v1.2.3: computed per window, stored without a seeded shuffle —
 *     muse_id ASCII ascending); this is presentation, not qualification.
 *
 * Growth is a reported rate of change, never a tier: no function here
 * changes warmth, co_locations, or any tier.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.THZones = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAY_MS = 86400000;

  function num(v) {
    return (typeof v === "number" && isFinite(v)) ? v : 0;
  }

  function pairCmp(x, y) {
    if (x.pair < y.pair) return -1;
    if (x.pair > y.pair) return 1;
    return 0;
  }

  function socialiteIds(roll) {
    var out = [];
    var list = Array.isArray(roll) ? roll : [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (entry && typeof entry.muse_id === "string" && entry.muse_id) {
        out.push(entry.muse_id);
      }
    }
    return out;
  }

  function growingNow(edges, socIds) {
    var socSet = {};
    var list = Array.isArray(socIds) ? socIds : [];
    for (var s = 0; s < list.length; s++) {
      if (typeof list[s] === "string") socSet[list[s]] = true;
    }
    var rows = [];
    var all = Array.isArray(edges) ? edges : [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (!e) continue;
      var aSoc = !!socSet[e.a], bSoc = !!socSet[e.b];
      if (aSoc && bSoc) continue;                 // socialite × socialite: excluded entirely
      if (num(e.growth_7d) <= 0 && num(e.growth_30d) <= 0) continue;
      rows.push(e);
    }
    rows.sort(function (x, y) {
      return num(y.growth_7d) - num(x.growth_7d) ||
             num(y.growth_30d) - num(x.growth_30d) ||
             pairCmp(x, y);
    });
    var FEATURED_ROWS = 10;
    var featured = [], rest = [], seen = {};
    for (var j = 0; j < rows.length; j++) {
      var edge = rows[j];
      var socMember = socSet[edge.a] ? edge.a : (socSet[edge.b] ? edge.b : null);
      var capFull = featured.length >= FEATURED_ROWS;
      var socRepeat = socMember && seen[socMember];
      if (!capFull && !socRepeat) {
        if (socMember) seen[socMember] = true;    // one row per socialite in the first 10
        featured.push(edge);
      } else {
        rest.push(edge);                          // continues after the 'more…' divider
      }
    }
    return { featured: featured, rest: rest };
  }

  function newSparks(edges, anchorIso, opts) {
    var o = opts || {};
    var days = (typeof o.days === "number" && isFinite(o.days)) ? o.days : 30;
    var cap = (typeof o.cap === "number" && isFinite(o.cap)) ? o.cap : 12;
    var rows = [];
    var anchor = Date.parse(anchorIso);
    if (!isNaN(anchor)) {
      var all = Array.isArray(edges) ? edges : [];
      for (var i = 0; i < all.length; i++) {
        var e = all[i];
        if (!e || typeof e.first_seen_date !== "string") continue;
        var t = Date.parse(e.first_seen_date);
        if (isNaN(t)) continue;
        if (t < anchor - days * DAY_MS || t > anchor) continue;
        rows.push(e);
      }
    }
    rows.sort(function (x, y) {
      var dx = Date.parse(x.first_seen_date), dy = Date.parse(y.first_seen_date);
      return dy - dx || pairCmp(x, y);
    });
    return { featured: rows.slice(0, cap), rest: rows.slice(cap) };
  }

  function allBonds(edges) {
    var rows = Array.isArray(edges) ? edges.slice() : [];
    rows.sort(function (x, y) { return num(y.warmth) - num(x.warmth) || pairCmp(x, y); });
    return rows;
  }

  // v1.2.5: the default-page showcase — the highest relationships only. The
  // allBonds order (warmth desc, stable pairKey-asc tiebreak) sliced to a
  // cap (default 10). Pure and non-mutating, like the rest of the rules.
  function topBonds(edges, opts) {
    var o = opts || {};
    var cap = (typeof o.cap === "number" && isFinite(o.cap) && o.cap >= 0) ? o.cap : 10;
    return allBonds(edges).slice(0, cap);
  }

  function musePairs(edges, museId) {
    var rows = [];
    var all = Array.isArray(edges) ? edges : [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (!e) continue;
      if (e.a === museId || e.b === museId) rows.push(e);
    }
    rows.sort(function (x, y) { return num(y.warmth) - num(x.warmth) || pairCmp(x, y); });
    return rows;
  }

  function displayWarmth(value) {
    if (!Number.isFinite(value)) return "\u2014";
    if (value > 0 && value < 0.01) return "<0.01";
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function shuffle(list) {
    var items = Array.isArray(list) ? list.slice() : [];
    for (var i = items.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = items[i]; items[i] = items[j]; items[j] = tmp;
    }
    return items;
  }

  function uniqIds(ids, roster) {
    var seen = {}, out = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (id == null || seen[id]) continue;
      seen[id] = true;
      var nm = roster[id];
      out.push({ id: id, name: (typeof nm === "string" && nm) ? nm : id });
    }
    return out;
  }

  function resolveMuse(query, roster, indexNames) {
    var q = String(query == null ? "" : query).replace(/^\s+|\s+$/g, "");
    var names = (roster && typeof roster === "object") ? roster : {};
    var ix = (indexNames && typeof indexNames === "object") ? indexNames : {};
    var lower = q.toLowerCase();
    function fail(reason, cands) { return { ok: false, query: q, reason: reason, candidates: cands || [] }; }
    if (!q) return fail("unknown");

    // 1. the muse id wins over any name (ids are canonical)
    if (Object.prototype.hasOwnProperty.call(names, q)) {
      return { ok: true, id: q, name: (typeof names[q] === "string" && names[q]) ? names[q] : q, via: "id" };
    }

    // 1b. the id is canonical but typing is not: the id also matches in any
    // case (v1.2.7) — one lower-cased id hit answers directly. Several hit
    // ids would be a collision, so this falls through to the name passes
    // rather than guess.
    if (lower) {
      var ciIds = [];
      for (var keyId in names) {
        if (Object.prototype.hasOwnProperty.call(names, keyId) &&
            keyId.toLowerCase() === lower) ciIds.push(keyId);
      }
      if (ciIds.length === 1) {
        var ciIdName = names[ciIds[0]];
        return { ok: true, id: ciIds[0],
                 name: (typeof ciIdName === "string" && ciIdName) ? ciIdName : ciIds[0],
                 via: "id" };
      }
    }

    // 2. exact display name, case-sensitive
    var exact = [];
    for (var key in names) {
      if (Object.prototype.hasOwnProperty.call(names, key) && names[key] === q) exact.push(key);
    }
    if (exact.length === 1) return { ok: true, id: exact[0], name: names[exact[0]], via: "exact" };
    if (exact.length > 1) return fail("ambiguous", uniqIds(exact, names));

    // 3. case-insensitive: first over the roster values ...
    var ci = [];
    for (var key2 in names) {
      if (Object.prototype.hasOwnProperty.call(names, key2) &&
          typeof names[key2] === "string" && names[key2].toLowerCase() === lower) ci.push(key2);
    }
    if (ci.length === 1) return { ok: true, id: ci[0], name: names[ci[0]], via: "ci" };
    if (ci.length > 1) return fail("ambiguous", uniqIds(ci, names));

    // ... then over the index_names keys' two sides — the edges reachable
    // there carry both ids and the pairing-record names, so a name a rename
    // has left behind still resolves to the canonical muse id.
    var ciSides = [];
    for (var k in ix) {
      if (!Object.prototype.hasOwnProperty.call(ix, k)) continue;
      var e = ix[k];
      if (!e) continue;
      if (typeof e.a_name === "string" && e.a && e.a_name.toLowerCase() === lower) ciSides.push(e.a);
      if (typeof e.b_name === "string" && e.b && e.b_name.toLowerCase() === lower) ciSides.push(e.b);
    }
    var sideCands = uniqIds(ciSides, names);
    if (sideCands.length === 1) {
      var sideName = names[sideCands[0].id];
      return { ok: true, id: sideCands[0].id,
               name: (typeof sideName === "string" && sideName) ? sideName : sideCands[0].name,
               via: "index" };
    }
    if (sideCands.length > 1) return fail("ambiguous", sideCands);

    // 4. a UNIQUE case-insensitive prefix match resolves too — first over the
    // roster, then over the index_names sides; an ambiguous prefix answers
    // with its candidate list instead of guessing.
    var pre = [];
    for (var key3 in names) {
      if (Object.prototype.hasOwnProperty.call(names, key3) &&
          typeof names[key3] === "string" && names[key3].toLowerCase().indexOf(lower) === 0) pre.push(key3);
    }
    var cands = uniqIds(pre, names);
    if (cands.length > 1) return fail("ambiguous", cands);
    if (cands.length === 0) {
      var preSides = [];
      for (var k2 in ix) {
        if (!Object.prototype.hasOwnProperty.call(ix, k2)) continue;
        var e2 = ix[k2];
        if (!e2) continue;
        if (typeof e2.a_name === "string" && e2.a && e2.a_name.toLowerCase().indexOf(lower) === 0) preSides.push(e2.a);
        if (typeof e2.b_name === "string" && e2.b && e2.b_name.toLowerCase().indexOf(lower) === 0) preSides.push(e2.b);
      }
      var preCands = uniqIds(preSides, names);
      if (preCands.length > 1) return fail("ambiguous", preCands);
      if (preCands.length === 1) {
        var preName = names[preCands[0].id];
        return { ok: true, id: preCands[0].id,
                 name: (typeof preName === "string" && preName) ? preName : preCands[0].name,
                 via: "prefix" };
      }
      return fail("unknown");   // nothing matched at any strictness
    }
    return { ok: true, id: cands[0].id, name: cands[0].name, via: "prefix" };
  }

  function focusSummary(pairs) {
    var list = Array.isArray(pairs) ? pairs : [];
    var out = { connections: list.length, bonds: 0, companions: 0, friendly: 0,
                acquaintance: 0, untiered: 0, growth7d: 0, top: null };
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e) continue;
      var t = e.tier;
      if (t === "bond") out.bonds++;
      else if (t === "companion") out.companions++;
      else if (t === "friendly") out.friendly++;
      else if (t === "acquaintance") out.acquaintance++;
      else out.untiered++;
      out.growth7d += num(e.growth_7d);
      if (!out.top || num(e.warmth) > num(out.top.warmth) ||
          (num(e.warmth) === num(out.top.warmth) && pairCmp(e, out.top) < 0)) out.top = e;
    }
    return out;
  }

  function focusCardView(e) {
    if (!e) return null;
    var w = num(e.warmth);
    return {
      tier: (e.tier == null) ? null : String(e.tier),
      label: String(e.a_name) + " ✦ " + String(e.b_name),
      warmth: w,
      barPct: Math.min(100, (w / 30) * 100),        // the power-up bar width
      growth7d: num(e.growth_7d),                   // a reported rate, never a tier
      growth30d: num(e.growth_30d),
      // public-3: published first/last seen are plain dates (no timestamps)
      firstObs: (typeof e.first_seen_date === "string" && e.first_seen_date) ? e.first_seen_date : null,
      lastSeen: (typeof e.last_seen_date === "string" && e.last_seen_date) ? e.last_seen_date : null,
    };
  }

  return {
    num: num,
    socialiteIds: socialiteIds,
    growingNow: growingNow,
    newSparks: newSparks,
    allBonds: allBonds,
    topBonds: topBonds,
    musePairs: musePairs,
    shuffle: shuffle,
    resolveMuse: resolveMuse,
    focusSummary: focusSummary,
    focusCardView: focusCardView,
    displayWarmth: displayWarmth,
  };
});