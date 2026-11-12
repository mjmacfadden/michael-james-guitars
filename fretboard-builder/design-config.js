/*
 * design-config.js — the Fretboard Builder's serializable DESIGN CONFIG (store-only file).
 *
 * A design is a small, versioned JSON document holding every user-facing option on the
 * builder page. It is what a share link carries today and what a future custom order would
 * carry (see ORDERING.md). Shape (schema version 1):
 *
 *   { "schema": "mjg.fretboard-design", "version": 1,
 *     "engine": "fretboard-builder@<commit>",          // geometry version that produced it
 *     "params": { "strings": 4, "frets": 19, ... } }   // every field in FIELDS, in FIELDS order
 *
 * Rules:
 * - Params are stored in the units the customer sees (inches / mm / degrees), exactly like the
 *   form, so a design reads naturally in an order record.
 * - normalize() is the only way in: unknown keys are dropped, bad values fall back to defaults
 *   and out-of-range numbers are clamped, each with a warning. Strict callers (a future server)
 *   should reject any design that produces warnings.
 * - Adding a field with a default is backwards compatible (old links keep working). Renaming,
 *   removing or changing the meaning of a field needs VERSION + 1 and a migrate step in normalize().
 *
 * Works in the browser (window.FretboardDesign) and in Node (module.exports) for tests.
 * No DOM side effects except the guarded boot block at the bottom, which applies a shared
 * design from the URL to the form BEFORE engine/app.js renders the first build.
 */
(function (root) {
  'use strict';

  var SCHEMA = 'mjg.fretboard-design';
  var VERSION = 1;
  var HASH_KEY = 'design';
  var IN = 25.4;
  // Custom orders are NOT live. Flip only when the backend described in ORDERING.md exists.
  var ORDERING_ENABLED = false;

  // key: JSON name · id: form control id · type: int | num | bool | enum
  var FIELDS = [
    { key: 'strings', id: 'strings', type: 'enum', values: [2, 3, 4, 5, 6], def: 4 },
    { key: 'frets', id: 'frets', type: 'int', min: 12, max: 24, def: 19 },
    { key: 'fretMode', id: 'fret-mode', type: 'enum', values: ['chromatic', 'diatonic', 'pentatonic', 'pentatonic-plus'], def: 'chromatic' },
    { key: 'scaleIn', id: 'scale', type: 'num', min: 18, max: 30, def: 23.5 },
    { key: 'nutWidthIn', id: 'nut-width', type: 'num', min: 1, max: 2.5, def: 1.5 },
    { key: 'heelWidthIn', id: 'heel-width', type: 'num', min: 1.1, max: 3, def: 1.5 },
    { key: 'split', id: 'split', type: 'enum', values: ['0', '5', '7', '9', '12', '5,12', '7,14', 'auto'], def: '7' },
    { key: 'bedLengthMm', id: 'bed-length', type: 'num', min: 100, max: 400, def: 220 },
    { key: 'fret17Screw', id: 'fret-17', type: 'bool', def: false },
    { key: 'thicknessIn', id: 'thickness', type: 'num', min: 0.14, max: 0.31, def: 0.2 },
    { key: 'fretHeightIn', id: 'fret-height', type: 'num', min: 0.02, max: 0.06, def: 0.035 },
    { key: 'slotHeightMm', id: 'slot-height', type: 'num', min: 0.1, max: 0.8, def: 0.3 },
    { key: 'slotSlopeDeg', id: 'slot-slope', type: 'num', min: 0, max: 20, def: 7.5 },
    { key: 'tailIn', id: 'tail', type: 'num', min: 0.4, max: 2.36, def: 1.2 },
    { key: 'nutScrew', id: 'nut-screw', type: 'bool', def: true },
    { key: 'tailScrew', id: 'tail-screw', type: 'bool', def: false },
    { key: 'roundTail', id: 'round-tail', type: 'bool', def: true },
    { key: 'leftHanded', id: 'left-handed', type: 'bool', def: false },
    { key: 'headstockExt', id: 'headstock-ext', type: 'bool', def: true },
    { key: 'seamKeys', id: 'seam-keys', type: 'bool', def: true },
    { key: 'edgeFilletMm', id: 'edge-fillet', type: 'enum', values: [0, 0.5, 1, 1.5, 2], def: 1 },
    { key: 'radiusMm', id: 'fb-radius', type: 'enum', values: [0, 406.4, 304.8, 241.3, 184.15], def: 0 }
  ];

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function defaults() {
    var p = {};
    FIELDS.forEach(function (f) { p[f.key] = f.def; });
    return p;
  }

  function normalizeValue(f, raw, warn) {
    if (raw === undefined) return f.def;
    if (f.type === 'bool') {
      if (typeof raw === 'boolean') return raw;
      warn(f.key + ' must be true/false');
      return f.def;
    }
    if (f.type === 'enum') {
      for (var i = 0; i < f.values.length; i++) {
        if (String(f.values[i]) === String(raw)) return f.values[i];
      }
      warn(f.key + ' has an unsupported value');
      return f.def;
    }
    var n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
    if (!isFinite(n)) { warn(f.key + ' must be a number'); return f.def; }
    if (f.type === 'int' && Math.round(n) !== n) { warn(f.key + ' must be a whole number'); n = Math.round(n); }
    var c = clamp(n, f.min, f.max);
    if (c !== n) warn(f.key + ' was outside ' + f.min + '–' + f.max);
    return c;
  }

  /** Coerce anything into a valid current-version design. Returns { config, warnings }. */
  function normalize(input, opts) {
    var warnings = [];
    var warn = function (m) { warnings.push(m); };
    var src = input && typeof input === 'object' ? input : {};
    if (input && typeof input === 'object') {
      if (src.schema !== undefined && src.schema !== SCHEMA) warn('not a fretboard design');
      if (src.version !== undefined && src.version !== VERSION) {
        // Only v1 exists. A future v2 adds a migrate step here (v1 -> v2) instead of a warning.
        warn('design version ' + src.version + ' is not supported; using defaults where needed');
      }
    } else {
      warn('design must be an object');
    }
    var rawParams = src.params && typeof src.params === 'object' ? src.params : {};
    var known = {};
    var params = {};
    FIELDS.forEach(function (f) {
      known[f.key] = true;
      params[f.key] = normalizeValue(f, rawParams[f.key], warn);
    });
    Object.keys(rawParams).forEach(function (k) { if (!known[k]) warn('unknown field ' + k + ' ignored'); });
    var engine = (opts && opts.engine) || (typeof src.engine === 'string' ? src.engine : null);
    var config = { schema: SCHEMA, version: VERSION, engine: engine || 'unknown', params: params };
    return { config: config, warnings: warnings };
  }

  function create(params, engine) { return normalize({ schema: SCHEMA, version: VERSION, engine: engine, params: params }).config; }

  /** Stable JSON: fixed top-level key order and FIELDS order for params. */
  function canonicalJSON(config) {
    var c = normalize(config).config;
    var p = {};
    FIELDS.forEach(function (f) { p[f.key] = c.params[f.key]; });
    return JSON.stringify({ schema: c.schema, version: c.version, engine: c.engine, params: p });
  }

  // --- base64url (UTF-8 safe), for links like fretboard-builder.html#design=...
  function b64urlEncode(str) {
    var b64 = typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(str)))
      : Buffer.from(str, 'utf8').toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return typeof atob === 'function'
      ? decodeURIComponent(escape(atob(b64)))
      : Buffer.from(b64, 'base64').toString('utf8');
  }

  function encode(config) { return b64urlEncode(canonicalJSON(config)); }

  /** Parse an encoded design. Returns { config, warnings } or null when it is not a design at all. */
  function decode(encoded) {
    try {
      var obj = JSON.parse(b64urlDecode(encoded));
      if (!obj || obj.schema !== SCHEMA) return null;
      return normalize(obj);
    } catch (e) { return null; }
  }

  /** Read the encoded design from a location.hash like "#design=..." (or null). */
  function fromHash(hash) {
    var m = /(?:^#|&)design=([A-Za-z0-9_-]+)/.exec(hash || '');
    return m ? decode(m[1]) : null;
  }

  function shareUrl(config, baseHref) {
    return String(baseHref).split('#')[0] + '#' + HASH_KEY + '=' + encode(config);
  }

  // --- form <-> design (the builder page uses the same element ids as the standalone app)
  function readForm(doc, engine) {
    var p = {};
    FIELDS.forEach(function (f) {
      var el = doc.getElementById(f.id);
      if (!el) return;
      if (f.type === 'bool') p[f.key] = !!el.checked;
      else if (f.type === 'enum') p[f.key] = el.value;
      else {
        var v = parseFloat(el.value);
        if (isFinite(v)) p[f.key] = v; // blank/invalid -> default, like app.js
      }
    });
    return create(p, engine);
  }

  function applyToForm(doc, config) {
    var p = normalize(config).config.params;
    FIELDS.forEach(function (f) {
      var el = doc.getElementById(f.id);
      if (!el) return;
      if (f.type === 'bool') el.checked = !!p[f.key];
      else el.value = String(p[f.key]);
    });
    // Keep the scale preset dropdown and the frets label in step with the values.
    var preset = doc.getElementById('scale-preset');
    if (preset) {
      var match = 'custom';
      var opts = preset.options || [];
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value !== 'custom' && Number(opts[i].value) === p.scaleIn) match = opts[i].value;
      }
      preset.value = match;
    }
    var fv = doc.getElementById('frets-value');
    if (fv) fv.textContent = String(p.frets);
  }

  /**
   * Design params -> Fretboard.buildFretboard() params. Mirrors readParams() in engine/app.js
   * (a test runs app.js against a fake DOM and checks they agree), so a server can rebuild the
   * exact same STL from a design without a browser.
   */
  function toBuildParams(params, Fretboard) {
    var p = normalize({ params: params }).config.params;
    var sel;
    if (p.split === 'auto') sel = { frets: null, auto: true };
    else if (p.split.indexOf(',') !== -1) sel = { frets: p.split.split(',').map(function (s) { return parseInt(s, 10); }), auto: false };
    else { var n = parseInt(p.split, 10) || 0; sel = { frets: n > 0 ? [n] : null, auto: false }; }
    return {
      scaleMm: p.scaleIn * IN,
      strings: p.strings,
      frets: p.frets,
      nutWidthMm: p.nutWidthIn * IN,
      heelWidthMm: p.heelWidthIn * IN,
      thicknessMm: p.thicknessIn * IN,
      fretHeightMm: p.fretHeightIn * IN,
      tailMm: p.tailIn * IN,
      slotHeightMm: p.slotHeightMm,
      slotSlopeDeg: p.slotSlopeDeg,
      nutScrew: p.nutScrew,
      tailScrew: p.tailScrew,
      tailCornerRadiusMm: p.roundTail ? 6.35 : 0,
      leftHanded: p.leftHanded,
      headstockExtMm: p.headstockExt ? 6.35 : 0,
      radiusMm: p.radiusMm,
      edgeFilletMm: p.edgeFilletMm,
      splitAfterFrets: sel.frets,
      autoSplit: sel.auto,
      bedMm: sel.auto ? p.bedLengthMm : 0,
      seamKeys: p.seamKeys,
      fretSteps: Fretboard.FRET_MODES[p.fretMode] || null,
      skipMarkers: p.fret17Screw ? [] : [17]
    };
  }

  /** SHA-256 of the canonical JSON (hex). A stable id for "this exact design". */
  function designId(config) {
    var json = canonicalJSON(config);
    var subtle = root.crypto && root.crypto.subtle;
    if (!subtle) return Promise.resolve(null);
    var bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : Buffer.from(json, 'utf8');
    return subtle.digest('SHA-256', bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  /**
   * FUTURE ORDER HOOK (disabled). Shows the cart line a custom order would add; see ORDERING.md.
   * While ORDERING_ENABLED is false this never touches the cart or the network.
   */
  function proposedCartLine(config) {
    var c = normalize(config).config;
    return designId(c).then(function (id) {
      return {
        id: 'custom-fretboard',          // future product id in functions/data/catalog.json
        variantId: 'standard',           // future variant (e.g. 'pla' / 'petg')
        name: 'Custom fretboard (' + c.params.strings + '-string, ' + c.params.scaleIn + '″ scale)',
        qty: 1,
        designId: id,
        design: c
      };
    });
  }

  function requestOrder(config) {
    if (!ORDERING_ENABLED) return Promise.resolve({ ok: false, reason: 'ordering_disabled' });
    // Future: put the line in the cart once the backend accepts { productId, variantId, qty, designId, design }.
    return proposedCartLine(config).then(function (line) { return { ok: false, reason: 'not_implemented', line: line }; });
  }

  var api = {
    SCHEMA: SCHEMA, VERSION: VERSION, HASH_KEY: HASH_KEY, ORDERING_ENABLED: ORDERING_ENABLED, FIELDS: FIELDS,
    defaults: defaults, normalize: normalize, create: create, canonicalJSON: canonicalJSON,
    encode: encode, decode: decode, fromHash: fromHash, shareUrl: shareUrl,
    readForm: readForm, applyToForm: applyToForm, toBuildParams: toBuildParams,
    designId: designId, proposedCartLine: proposedCartLine, requestOrder: requestOrder
  };

  root.FretboardDesign = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // Boot (browser only): apply a shared design from the URL before app.js reads the form.
  if (typeof document !== 'undefined' && document.getElementById && document.getElementById('fb-builder')) {
    var shared = fromHash(root.location && root.location.hash);
    if (shared) {
      applyToForm(document, shared.config);
      api.loadedFromLink = shared;
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
