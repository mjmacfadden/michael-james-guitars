/*
 * geometry.js — parametric cigar box guitar fretboard geometry.
 *
 * Builds a triangle-soup mesh (millimetres) for a 3D-printable fretboard:
 *   - tapered board (wider at the heel than at the nut)
 *   - integrated raised frets (printed as part of the board, so a worn
 *     board is simply reprinted — a "fret job" for a few cents of PLA)
 *   - integrated nut with a string slot per string
 *   - countersunk holes for #6 flat-head wood screws, placed at the
 *     traditional fret-marker positions so the screw heads double as
 *     fret markers and the board can be screwed to a wooden neck
 *
 * Pure math, no DOM. In the browser it attaches `window.Fretboard`;
 * in Node it uses module.exports so the geometry can be unit-tested.
 */
(function (global) {
  'use strict';

  // #6 flat-head wood screw: shank ~3.5 mm, head ~8 mm, 82 deg head angle.
  var SCREW = {
    clearanceRadius: 2.1, // 4.2 mm through-hole
    headRadius: 4.1,      // 8.2 mm countersink opening
    headAngleDeg: 82
  };

  var MARKER_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
  var CIRCLE_SEGMENTS = 24;
  // Across-the-width sample points (fractions of the half width) used to
  // trace the fretboard radius curve on faces, walls, frets and the nut.
  var CHAIN_FRACS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
  // Top-edge round-over (fillet) along the board's two long top edges:
  // a quarter circle of radius r, tangent to the top surface and to the
  // vertical side wall, sampled in FILLET_SEGS steps. The bottom face
  // and its edges are never touched (the board must sit flush on the
  // neck), and the end/split faces stay flat — only their top corners
  // follow the rounded profile, so pieces still butt together cleanly.
  var FILLET_SEGS = 6;

  /** How far the filleted top drops below the unrounded top at x. */
  function filletDrop(x, halfW, r) {
    if (!r) return 0;
    var d = Math.abs(x) - (halfW - r);
    if (d <= 0) return 0;
    if (d > r) d = r;
    return r - Math.sqrt(Math.max(0, r * r - d * d));
  }

  /** x samples on one side's fillet arc, from the edge inward to the
   *  tangent line (side = -1 left, +1 right). Empty when r = 0. */
  function filletSideXs(halfW, r, side) {
    var xs = [];
    if (!r) return xs;
    var inner = halfW - r;
    for (var k = FILLET_SEGS; k >= 0; k--) {
      xs.push(side * (inner + r * Math.sin((k * Math.PI) / (2 * FILLET_SEGS))));
    }
    return xs; // FILLET_SEGS + 1 points: edge first, tangent point last
  }

  /** Across-the-width chain samples, left to right. With r = 0 this is
   *  exactly CHAIN_FRACS x halfW (unchanged geometry); with a fillet the
   *  fractions span the flat/crowned zone and the arc gets its own
   *  samples so the triangulation follows the round-over. */
  function chainXs(halfW, r) {
    if (!r) return CHAIN_FRACS.map(function (f) { return f * halfW; });
    var inner = halfW - r;
    var xs = filletSideXs(halfW, r, -1); // ends at -inner (tangent)
    CHAIN_FRACS.slice(1, -1).forEach(function (f) { xs.push(f * inner); });
    return xs.concat(filletSideXs(halfW, r, 1).reverse());
  }

  // String gauges (inches, low to high) used to size the nut slots.
  // 3- and 4-string sets are the classic cigar box tunings; 6 is a
  // standard light EADGBE set (.046–.010).
  var STRING_GAUGES = {
    1: [0.032],
    2: [0.042, 0.024],
    3: [0.042, 0.032, 0.024],
    4: [0.042, 0.032, 0.024, 0.017],
    5: [0.042, 0.032, 0.024, 0.017, 0.013],
    6: [0.046, 0.036, 0.026, 0.017, 0.013, 0.010]
  };
  var TUNING_LABELS = { 3: 'GDg', 4: 'GDgB', 6: 'EADGBE' };

  // Fret layouts: which semitone classes (0 = the octave) get a fret
  // ridge. null = chromatic (every semitone). Diatonic and pentatonic
  // boards are a cigar box staple — fewer frets, all of them in key.
  // 'pentatonic-plus' is Del Puckett's design: his site defines it as
  // the blues scale — the minor pentatonic plus the flat-5 blue note.
  var FRET_MODES = {
    chromatic: null,
    diatonic: [0, 2, 4, 5, 7, 9, 11],
    pentatonic: [0, 3, 5, 7, 10],
    'pentatonic-plus': [0, 3, 5, 6, 7, 10]
  };

  // Standard fretboard presets. Values use the builder's form units
  // (inches, except slotHeightMm) and keys match the design config.
  // Each is a common published 6-string electric spec; boards stay flat
  // (no radius) and printing/mounting options are left alone.
  //   t-style:  25.5" scale, 22 medium-jumbo frets (.046" tall),
  //             1.650" nut, ~2.2" wide at the heel.
  //   lp-style: 24.75" scale, 22 medium-jumbo frets (.045" tall),
  //             1.695" nut, 2.26" at the end of the board.
  // slotHeightMm 0.25 = .010" over fret 1 at the treble string, the
  // usual electric setup target (the bass side sits up to 0.2 mm higher).
  var PRESETS = {
    't-style': {
      label: 'T-Style',
      values: { strings: 6, frets: 22, fretMode: 'chromatic', scaleIn: 25.5,
        nutWidthIn: 1.65, heelWidthIn: 2.2, fretHeightIn: 0.046, slotHeightMm: 0.25 }
    },
    'lp-style': {
      label: 'LP-Style',
      values: { strings: 6, frets: 22, fretMode: 'chromatic', scaleIn: 24.75,
        nutWidthIn: 1.695, heelWidthIn: 2.26, fretHeightIn: 0.045, slotHeightMm: 0.25 }
    }
  };
  var PRESET_KEYS = ['strings', 'frets', 'fretMode', 'scaleIn', 'nutWidthIn',
    'heelWidthIn', 'fretHeightIn', 'slotHeightMm'];

  /**
   * Which preset (if any) a set of form-unit values matches exactly:
   * returns a PRESETS id, or 'custom'.
   */
  function matchPreset(values) {
    var ids = Object.keys(PRESETS);
    for (var i = 0; i < ids.length; i++) {
      var v = PRESETS[ids[i]].values, ok = true;
      for (var k = 0; k < PRESET_KEYS.length && ok; k++) {
        var a = v[PRESET_KEYS[k]], b = values ? values[PRESET_KEYS[k]] : undefined;
        ok = typeof a === 'number' ? Math.abs(a - Number(b)) < 1e-9 : a === b;
      }
      if (ok) return ids[i];
    }
    return 'custom';
  }

  /** A preset as buildFretboard() overrides (mm), to merge onto other params. */
  function presetParams(id) {
    var p = PRESETS[id];
    if (!p) return {};
    var v = p.values, IN = 25.4;
    return {
      strings: v.strings,
      frets: v.frets,
      fretSteps: FRET_MODES[v.fretMode] || null,
      scaleMm: v.scaleIn * IN,
      nutWidthMm: v.nutWidthIn * IN,
      heelWidthMm: v.heelWidthIn * IN,
      fretHeightMm: v.fretHeightIn * IN,
      slotHeightMm: v.slotHeightMm
    };
  }

  /** Distance from the nut to fret n (n = 0 is the nut itself). */
  function fretDistance(scaleMm, n) {
    return scaleMm * (1 - Math.pow(2, -n / 12));
  }

  // ---------------------------------------------------------------------
  // Triangle helpers. Triangles are flat [x0,y0,z0, x1,y1,z1, x2,y2,z2].
  // ---------------------------------------------------------------------

  function pushTri(tris, a, b, c) {
    tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }

  function triNormal(t, i) {
    var ax = t[i], ay = t[i + 1], az = t[i + 2];
    var bx = t[i + 3], by = t[i + 4], bz = t[i + 5];
    var cx = t[i + 6], cy = t[i + 7], cz = t[i + 8];
    var ux = bx - ax, uy = by - ay, uz = bz - az;
    var vx = cx - ax, vy = cy - ay, vz = cz - az;
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  }

  /** Flip any triangle in `tris` whose normal fails the test function. */
  function forceNormals(tris, test) {
    for (var i = 0; i < tris.length; i += 9) {
      var n = triNormal(tris, i);
      var cx = (tris[i] + tris[i + 3] + tris[i + 6]) / 3;
      var cy = (tris[i + 1] + tris[i + 4] + tris[i + 7]) / 3;
      var cz = (tris[i + 2] + tris[i + 5] + tris[i + 8]) / 3;
      if (!test(n, cx, cy, cz)) {
        // swap vertices 2 and 3
        for (var k = 0; k < 3; k++) {
          var tmp = tris[i + 3 + k];
          tris[i + 3 + k] = tris[i + 6 + k];
          tris[i + 6 + k] = tmp;
        }
      }
    }
    return tris;
  }

  function signedVolume(tris) {
    var v = 0;
    for (var i = 0; i < tris.length; i += 9) {
      var ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
      var bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
      var cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
  }

  /** Orient a closed solid so its signed volume is positive (outward normals). */
  function orientClosed(tris) {
    if (signedVolume(tris) < 0) {
      for (var i = 0; i < tris.length; i += 9) {
        for (var k = 0; k < 3; k++) {
          var tmp = tris[i + 3 + k];
          tris[i + 3 + k] = tris[i + 6 + k];
          tris[i + 6 + k] = tmp;
        }
      }
    }
    return tris;
  }

  /** Closed axis-aligned box. */
  function box(x0, x1, y0, y1, z0, z1) {
    var t = [];
    var c = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
    ];
    var faces = [
      [0, 3, 2, 1], [4, 5, 6, 7], // bottom, top
      [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7] // sides
    ];
    faces.forEach(function (f) {
      pushTri(t, c[f[0]], c[f[1]], c[f[2]]);
      pushTri(t, c[f[0]], c[f[2]], c[f[3]]);
    });
    return orientClosed(t);
  }

  /**
   * Loft a convex profile given in the (y, z) plane along x through a set
   * of sections [{x, s}]: at each section the profile is scaled by s about
   * the point (cy, zBase). Scaling down toward the ends rounds a prism
   * over — used for the fret ends. End caps are fanned (profile must be
   * convex) and the solid is oriented outward.
   */
  function loftProfileX(profile, cy, zBase, sections) {
    var t = [];
    var n = profile.length;
    var secs = sections.map(function (sec) {
      return profile.map(function (p) {
        return [sec.x, cy + (p[0] - cy) * sec.s, zBase + (p[1] - zBase) * sec.s + (sec.dz || 0)];
      });
    });
    var i, j;
    // end caps (fan) — wound to match the bands: cap normals point AWAY
    // from the solid (the original order pointed them inward, which
    // silently under-counted loft volumes and inverted the STL normals
    // on every fret end face)
    var first = secs[0], last = secs[secs.length - 1];
    for (j = 1; j < n - 1; j++) {
      pushTri(t, first[0], first[j], first[j + 1]);
      pushTri(t, last[0], last[j + 1], last[j]);
    }
    // bands between consecutive sections
    for (i = 0; i < secs.length - 1; i++) {
      for (j = 0; j < n; j++) {
        var a0 = secs[i][j], a1 = secs[i][(j + 1) % n];
        var b0 = secs[i + 1][j], b1 = secs[i + 1][(j + 1) % n];
        pushTri(t, a0, b0, b1);
        pushTri(t, a0, b1, a1);
      }
    }
    return orientClosed(t);
  }

  /**
   * Same loft, transposed: a convex profile in the (x, z) plane lofted
   * along y through sections [{y, s, dz}], scaled about (cx, zBase).
   * Used for the nut's end segments, whose side profile carries the
   * rounded-over end as a true arc.
   */
  function loftProfileY(profile, cx, zBase, sections) {
    var t = [];
    var n = profile.length;
    var secs = sections.map(function (sec) {
      return profile.map(function (p) {
        return [cx + (p[0] - cx) * sec.s, sec.y, zBase + (p[1] - zBase) * sec.s + (sec.dz || 0)];
      });
    });
    var i, j;
    var first = secs[0], last = secs[secs.length - 1];
    for (j = 1; j < n - 1; j++) {
      pushTri(t, first[0], first[j], first[j + 1]);
      pushTri(t, last[0], last[j + 1], last[j]);
    }
    for (i = 0; i < secs.length - 1; i++) {
      for (j = 0; j < n; j++) {
        var a0 = secs[i][j], a1 = secs[i][(j + 1) % n];
        var b0 = secs[i + 1][j], b1 = secs[i + 1][(j + 1) % n];
        pushTri(t, a0, b0, b1);
        pushTri(t, a0, b1, a1);
      }
    }
    return orientClosed(t);
  }

  /**
   * Loft through explicit sections: each section is a list of [x, y, z]
   * points with the same count, forming a convex polygon. Bands join
   * consecutive sections; the end sections are fanned closed.
   */
  function loftSections(secs, skipBand) {
    var t = [], skip = [];
    var n = secs[0].length;
    var i, j;
    var first = secs[0], last = secs[secs.length - 1];
    for (j = 1; j < n - 1; j++) {
      pushTri(t, first[0], first[j], first[j + 1]);
      pushTri(t, last[0], last[j + 1], last[j]);
      skip.push(false, false);
    }
    for (i = 0; i < secs.length - 1; i++) {
      for (j = 0; j < n; j++) {
        var a0 = secs[i][j], a1 = secs[i][(j + 1) % n];
        var b0 = secs[i + 1][j], b1 = secs[i + 1][(j + 1) % n];
        pushTri(t, a0, b0, b1);
        pushTri(t, a0, b1, a1);
        skip.push(j === skipBand, j === skipBand);
      }
    }
    // orient as the CLOSED solid, then drop the open band (if any): that
    // side is closed by a mating solid whose matching face is omitted too
    orientClosed(t);
    if (skipBand == null) return t;
    var out = [];
    for (i = 0; i < skip.length; i++) {
      if (!skip[i]) for (j = 0; j < 9; j++) out.push(t[i * 9 + j]);
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Board body (with screw holes)
  // ---------------------------------------------------------------------

  /**
   * Flat face (the board's top or bottom), triangulated in horizontal
   * bands between "chains" — left-to-right polylines that partition the
   * face: one at the nut edge, one at every fret line, two hugging each
   * screw hole (below and above the circle), one at the tail edge.
   * Each band is a simple polygon triangulated on its own, so triangles
   * stay small and local instead of webbing across the whole board.
   */
  function flatFace(holes, radius, z, up, widthAt, length, stationYs, earcut, fillet) {
    fillet = fillet || 0;
    var sorted = holes.slice().sort(function (a, b) { return a.y - b.y; });
    var chains = [];
    var chainKind = []; // 'station' | 'arc', parallel to chains
    var skipBand = {}; // chain index i -> band (i, i+1) is a hole interior

    function edgePt(y, side) { return [side * widthAt(y) / 2, y]; }
    function arcChain(h, over) {
      // with a fillet the chain walks the arc samples from the edge in,
      // matching the station chains so faces and walls share vertices
      var hw = widthAt(h.y) / 2;
      var pts = fillet
        ? filletSideXs(hw, fillet, -1).map(function (x) { return [x, h.y]; })
        : [edgePt(h.y, -1)];
      var half = CIRCLE_SEGMENTS / 2, i, a;
      for (i = 0; i <= half; i++) {
        a = over ? Math.PI - (i * Math.PI) / half : Math.PI + (i * Math.PI) / half;
        pts.push([h.x + radius * Math.cos(a), h.y + radius * Math.sin(a)]);
      }
      if (fillet) {
        filletSideXs(hw, fillet, 1).reverse().forEach(function (x) { pts.push([x, h.y]); });
      } else {
        pts.push(edgePt(h.y, 1));
      }
      return pts;
    }

    // Densify the stations: no band longer than ~12mm. Short bands keep
    // the face triangles small and local, which the preview's painter
    // sort needs to draw frets and holes correctly at glancing angles.
    // Stations inside a screw hole's span are dropped afterwards (the
    // midpoint of a fret gap is exactly where a marker hole sits) — a
    // chain crossing the hole circle corrupts the bands around it.
    var denseYs = [];
    var sortedYs = stationYs.slice().sort(function (a, b) { return a - b; });
    sortedYs.forEach(function (y) {
      if (denseYs.length) {
        var prev = denseYs[denseYs.length - 1];
        var parts = Math.ceil((y - prev) / 12);
        for (var dp = 1; dp < parts; dp++) denseYs.push(prev + ((y - prev) * dp) / parts);
      }
      denseYs.push(y);
    });
    denseYs = denseYs.filter(function (y, idx) {
      if (idx === 0 || idx === denseYs.length - 1) return true;
      // NOTE: the span uses the head radius (the larger of the two face
      // radii) regardless of which face is being built, so the top and
      // bottom faces end up with IDENTICAL station lists — their
      // boundaries must match vertex for vertex for the walls to share
      // edges with both (watertightness).
      return !sorted.some(function (h) { return Math.abs(y - h.y) <= SCREW.headRadius + 0.6; });
    });

    var events = [];
    denseYs.forEach(function (y) { events.push({ y: y, hole: null }); });
    sorted.forEach(function (h) { events.push({ y: h.y, hole: h }); });
    events.sort(function (a, b) { return a.y - b.y; });

    // z may be a function of (x, y) — the radiused top face. Station
    // chains then sample across the width so the triangulation follows
    // the curve instead of chord-cutting it.
    function zOf(x, y) { return typeof z === 'function' ? z(x, y) : z; }

    events.forEach(function (ev) {
      if (!ev.hole) {
        if (typeof z === 'function') {
          var chain = chainXs(widthAt(ev.y) / 2, fillet).map(function (x) { return [x, ev.y]; });
          chains.push(chain);
        } else {
          chains.push([edgePt(ev.y, -1), edgePt(ev.y, 1)]);
        }
        chainKind.push('station');
      } else {
        skipBand[chains.length] = true; // band between this hole's two chains
        chains.push(arcChain(ev.hole, false));
        chains.push(arcChain(ev.hole, true));
        chainKind.push('arc', 'arc');
      }
    });

    // The face's boundary, in order: the side sequences are the chains'
    // endpoints, the end sequences are the first/last chains. The side
    // and end walls are built from THESE points, so every wall edge is
    // shared with a face edge — no T-junctions, no open edges.
    function withZ(chain) {
      return chain.map(function (pt) { return [pt[0], pt[1], zOf(pt[0], pt[1])]; });
    }
    var boundary = {
      left: withZ(chains.map(function (ch) { return ch[0]; })),
      right: withZ(chains.map(function (ch) { return ch[ch.length - 1]; })),
      first: withZ(chains[0]),
      last: withZ(chains[chains.length - 1])
    };

    var tris = [];
    for (var c = 0; c < chains.length - 1; c++) {
      if (skipBand[c]) continue;
      // Two station chains with matching samples form a grid: triangulate
      // cell by cell so the diagonals stay inside one across-width cell.
      // A free earcut of the whole band picks long diagonals that drag
      // the curved surface off the true cylinder between stations.
      if (chainKind[c] === 'station' && chainKind[c + 1] === 'station' &&
          chains[c].length === chains[c + 1].length && chains[c].length > 2) {
        var A = chains[c], B = chains[c + 1], gk;
        for (gk = 0; gk < A.length - 1; gk++) {
          var a0 = A[gk], a1 = A[gk + 1], b0 = B[gk], b1 = B[gk + 1];
          pushTri(tris,
            [a0[0], a0[1], zOf(a0[0], a0[1])], [b0[0], b0[1], zOf(b0[0], b0[1])], [b1[0], b1[1], zOf(b1[0], b1[1])]);
          pushTri(tris,
            [a0[0], a0[1], zOf(a0[0], a0[1])], [b1[0], b1[1], zOf(b1[0], b1[1])], [a1[0], a1[1], zOf(a1[0], a1[1])]);
        }
        continue;
      }
      var A2 = chains[c], B2 = chains[c + 1];
      if (fillet) {
        // Fillet strips: both chains carry the same FILLET_SEGS + 1 arc
        // samples at each end, so grid those cells directly and earcut
        // only the flat middle — otherwise earcut joins arc vertices to
        // far-off vertices and tilts the flat top near screw holes.
        var F = FILLET_SEGS, fk, side;
        for (side = 0; side < 2; side++) {
          for (fk = 0; fk < F; fk++) {
            var ia = side === 0 ? fk : A2.length - 1 - fk;
            var ib = side === 0 ? fk : B2.length - 1 - fk;
            var ia2 = side === 0 ? ia + 1 : ia - 1, ib2 = side === 0 ? ib + 1 : ib - 1;
            var q = [A2[ia], B2[ib], B2[ib2], A2[ia2]];
            pushTri(tris, [q[0][0], q[0][1], zOf(q[0][0], q[0][1])], [q[1][0], q[1][1], zOf(q[1][0], q[1][1])], [q[2][0], q[2][1], zOf(q[2][0], q[2][1])]);
            pushTri(tris, [q[0][0], q[0][1], zOf(q[0][0], q[0][1])], [q[2][0], q[2][1], zOf(q[2][0], q[2][1])], [q[3][0], q[3][1], zOf(q[3][0], q[3][1])]);
          }
        }
        A2 = A2.slice(F, A2.length - F);
        B2 = B2.slice(F, B2.length - F);
      }
      var poly = A2.concat(B2.slice().reverse());
      var coords = [];
      poly.forEach(function (p) { coords.push(p[0], p[1]); });
      var idx = earcut(coords, null, 2);
      for (var i = 0; i < idx.length; i += 3) {
        pushTri(tris,
          [coords[idx[i] * 2], coords[idx[i] * 2 + 1], zOf(coords[idx[i] * 2], coords[idx[i] * 2 + 1])],
          [coords[idx[i + 1] * 2], coords[idx[i + 1] * 2 + 1], zOf(coords[idx[i + 1] * 2], coords[idx[i + 1] * 2 + 1])],
          [coords[idx[i + 2] * 2], coords[idx[i + 2] * 2 + 1], zOf(coords[idx[i + 2] * 2], coords[idx[i + 2] * 2 + 1])]);
      }
    }
    return {
      tris: forceNormals(tris, function (n) { return up ? n[2] > 0 : n[2] < 0; }),
      boundary: boundary
    };
  }

  /** Ring strip between two circles (used for countersink cone + hole wall). */
  function ringStrip(cx, cy, rTop, zTop, rBot, zBot) {
    var t = [];
    for (var i = 0; i < CIRCLE_SEGMENTS; i++) {
      var a0 = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      var a1 = ((i + 1) / CIRCLE_SEGMENTS) * Math.PI * 2;
      var p = function (r, z, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a), z]; };
      // zTop may be a function of (x, y) so a rim can follow the
      // fretboard radius curve (used for the countersink cone's top rim)
      var pT = function (r, a) {
        var px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
        return [px, py, typeof zTop === 'function' ? zTop(px, py) : zTop];
      };
      pushTri(t, pT(rTop, a0), pT(rTop, a1), p(rBot, zBot, a1));
      pushTri(t, pT(rTop, a0), p(rBot, zBot, a1), p(rBot, zBot, a0));
    }
    // Normals must point INTO the hole void (toward the axis): the solid
    // material lives outside the cylinder.
    return forceNormals(t, function (n, gx, gy) {
      var rx = gx - cx, ry = gy - cy;
      return n[0] * rx + n[1] * ry < 0;
    });
  }

  // --- alignment keys at split seams -----------------------------------
  // A pin on the nut-side piece plugs into a socket in the tail-side
  // piece's head wall, so the two pieces register to each other when
  // glued or screwed down. 0.15 mm radial clearance (socketR - pinR).
  var KEY = { pinR: 1.6, socketR: 1.75, protrude: 3.5, embed: 1.5, depth: 3.7, segs: 16 };

  function keyCircle(cx, cz, r) {
    var pts = [];
    for (var i = 0; i < KEY.segs; i++) {
      var a = (i / KEY.segs) * Math.PI * 2;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
    return pts;
  }

  /** Closed pin cylinder along +y: base buried in the nut-side piece. */
  function seamPin(cx, cz, ySeam) {
    var yB = ySeam - KEY.embed, yT = ySeam + KEY.protrude;
    var rb = keyCircle(cx, cz, KEY.pinR).map(function (pt) { return [pt[0], yB, pt[1]]; });
    var rt = keyCircle(cx, cz, KEY.pinR).map(function (pt) { return [pt[0], yT, pt[1]]; });
    var sides = [], caps = [];
    for (var i = 0; i < KEY.segs; i++) {
      var j = (i + 1) % KEY.segs;
      pushTri(sides, rb[i], rt[i], rt[j]);
      pushTri(sides, rb[i], rt[j], rb[j]);
      pushTri(caps, [cx, yB, cz], rb[j], rb[i]);
      pushTri(caps, [cx, yT, cz], rt[i], rt[j]);
    }
    sides = forceNormals(sides, function (n, gx, gy, gz) {
      var rx = gx - cx, rz = gz - cz;
      return n[0] * rx + n[2] * rz > 0;
    });
    caps = forceNormals(caps, function (n, gx, gy) {
      return gy < (yB + yT) / 2 ? n[1] < 0 : n[1] > 0;
    });
    return sides.concat(caps);
  }

  /**
   * A piece's head wall (the curtain under the top face's first chain)
   * with circular socket holes cut into it, plus the socket tubes and
   * their end caps. The wall is triangulated as a cross-section in the
   * (x, z) plane with earcut holes; the tube rings reuse the exact
   * hole vertices, so every edge is shared and the piece stays sealed.
   */
  function seamWallWithSockets(chain, sockets, y0, earcut, outward) {
    var w = [];
    var poly = chain.map(function (pt) { return [pt[0], pt[2]]; });
    for (var bi = chain.length - 1; bi >= 0; bi--) poly.push([chain[bi][0], 0]);
    var coords = [];
    poly.forEach(function (pt) { coords.push(pt[0], pt[1]); });
    var holeIdx = [], circles = [];
    sockets.forEach(function (s) {
      var pts = keyCircle(s.x, s.z, s.r);
      holeIdx.push(coords.length / 2);
      pts.forEach(function (pt) { coords.push(pt[0], pt[1]); });
      circles.push(pts);
    });
    var idx = earcut(coords, holeIdx, 2);
    for (var i = 0; i < idx.length; i += 3) {
      pushTri(w,
        [coords[idx[i] * 2], y0, coords[idx[i] * 2 + 1]],
        [coords[idx[i + 1] * 2], y0, coords[idx[i + 1] * 2 + 1]],
        [coords[idx[i + 2] * 2], y0, coords[idx[i + 2] * 2 + 1]]);
    }
    w = forceNormals(w, outward);
    sockets.forEach(function (s, si) {
      var pts = circles[si];
      var sides = [], cap = [];
      for (var ci = 0; ci < pts.length; ci++) {
        var cj = (ci + 1) % pts.length;
        var a0 = [pts[ci][0], y0, pts[ci][1]], a1 = [pts[cj][0], y0, pts[cj][1]];
        var b0 = [pts[ci][0], y0 + KEY.depth, pts[ci][1]], b1 = [pts[cj][0], y0 + KEY.depth, pts[cj][1]];
        pushTri(sides, a0, b0, b1);
        pushTri(sides, a0, b1, a1);
        pushTri(cap, [s.x, y0 + KEY.depth, s.z], b1, b0);
      }
      sides = forceNormals(sides, function (n, gx, gy, gz) {
        var rx = gx - s.x, rz = gz - s.z;
        return n[0] * rx + n[2] * rz < 0;
      });
      cap = forceNormals(cap, function (n) { return n[1] < 0; });
      w = w.concat(sides, cap);
    });
    return w;
  }

  /**
   * One printable piece of the board, spanning y in [y0, y1]: flat faces,
   * four side walls (the two cut faces become the piece's end walls), and
   * the cone + hole wall for each screw hole inside the range.
   * `sockets` (optional) cuts alignment-key sockets into the y0 wall.
   */
  function boardBody(p, holes, widthAt, y0, y1, stations, earcut, zTopAt, sockets, fillet, openStart) {
    var T = p.thicknessMm;
    var curved = !!(p.radiusMm || 0);
    var tris = [];

    // top + bottom faces (top follows the radius curve when radiused;
    // the bottom stays flat for printing and neck contact)
    // The top face drops over the fillet arc near each long edge; the
    // walls are built from the top face's boundary, so the side walls
    // simply end lower (at the arc's bottom tangent) — still vertical.
    var zTop = fillet
      ? function (x, y) { return zTopAt(x) - filletDrop(x, widthAt(y) / 2, fillet); }
      : zTopAt;
    var topFace = flatFace(holes, SCREW.headRadius, zTop, true, widthAt, y1, stations, earcut, fillet);
    // the bottom z is a function too (returning 0) so its station
    // chains sample across the width exactly like the top face's —
    // the end walls are built from those chain points, and a 2-point
    // bottom chain would leave the walls' subdivided bottom edges
    // unmatched (open edges at every piece end)
    var botFace = flatFace(holes, SCREW.clearanceRadius, function () { return 0; }, false, widthAt, y1, stations, earcut, fillet);
    tris = tris.concat(topFace.tris, botFace.tris);

    // Side and end walls, built from the top face's OWN boundary
    // vertices (returned by flatFace), so every wall edge coincides
    // with a face edge: the mesh is watertight — no T-junctions where
    // a long wall edge passes a face vertex. End walls are returned
    // separately: at a split seam the two pieces' end walls are
    // coincident and internal, and the preview must paint them UNDER
    // the top faces or they leak through as dark shards.
    function outward(n, gx, gy) {
      // outward = away from the piece centre (0, (y0+y1)/2)
      return n[0] * gx + n[1] * (gy - (y0 + y1) / 2) > 0;
    }
    function wallStrip(pts) {
      var w = [];
      for (var sg = 0; sg < pts.length - 1; sg++) {
        var P0 = pts[sg], P1 = pts[sg + 1];
        if (P0[0] === P1[0] && P0[1] === P1[1]) continue; // degenerate
        pushTri(w, [P0[0], P0[1], 0], [P1[0], P1[1], 0], [P1[0], P1[1], P1[2]]);
        pushTri(w, [P0[0], P0[1], 0], [P1[0], P1[1], P1[2]], [P0[0], P0[1], P0[2]]);
      }
      return forceNormals(w, outward);
    }
    tris = tris.concat(wallStrip(topFace.boundary.left), wallStrip(topFace.boundary.right));
    // openStart: the start wall is left off because the headstock
    // extension's matching face is left off too — the two fuse into one
    // closed solid instead of two shells sharing a face. (Only ever the
    // first piece, which never has seam sockets.)
    var firstChain = topFace.boundary.first;
    var chainOk = firstChain.length >= 2 && firstChain.every(function (pt, ci) {
      return ci === 0 || pt[0] > firstChain[ci - 1][0];
    });
    var firstWall = openStart ? []
      : sockets && sockets.length && chainOk
        ? seamWallWithSockets(firstChain, sockets, y0, earcut, outward)
        : wallStrip(firstChain);
    var endWalls = firstWall.concat(wallStrip(topFace.boundary.last));

    // countersink cone + straight hole wall for each screw hole —
    // returned separately ('recess') so the preview can paint them as
    // their own layer between the board body and the raised features
    var coneDepth = Math.min(
      (SCREW.headRadius - SCREW.clearanceRadius) / Math.tan((SCREW.headAngleDeg / 2) * Math.PI / 180),
      T - 1.2
    );
    var recess = [];
    holes.forEach(function (h) {
      recess = recess.concat(ringStrip(h.x, h.y, SCREW.headRadius, curved ? zTopAt : T, SCREW.clearanceRadius, T - coneDepth));
      recess = recess.concat(ringStrip(h.x, h.y, SCREW.clearanceRadius, T - coneDepth, SCREW.clearanceRadius, 0));
    });
    return { tris: tris, endWalls: endWalls, recess: recess, coneDepth: coneDepth };
  }

  // ---------------------------------------------------------------------
  // Main builder
  // ---------------------------------------------------------------------

  /**
   * params (all mm):
   *   scaleMm, strings, frets, nutWidthMm, heelWidthMm (width at last fret),
   *   thicknessMm, fretHeightMm, tailMm (board length past the last fret),
   *   nutScrew / tailScrew (extra holes at the ends; nut on, tail off),
   *   tailCornerRadiusMm (rounded tail corners for a routed neck pocket;
   *   6.35 = 1/4", matching a router bit; 0 = square corners),
   *   headstockExtMm (flat extension past the nut toward the headstock,
   *   then a 45-degree taper down the full thickness to the tip — total
   *   reach is this plus the board thickness; 0 = board ends at the nut),
   *   radiusMm (fretboard radius across the width; 0 = flat. The bottom
   *   stays flat; frets, nut and the headstock extension follow the
   *   curve; thickness is measured at the centerline),
   *   nutHeightMm (minimum nut height), nutDepthMm, slotHeightMm (target
   *   height of the treble string's underside above the 1st fret crown at
   *   the nut face; bass strings ramp up to +0.2mm, capped at 0.5mm),
   *   slotSlopeDeg (slot floors slope down toward the headstock at this
   *   angle from their high point at the fret-side face; default 7.5),
   *   stringGaugesIn (nut slot gauges, low->high),
   *   leftHanded (bool: mirror the nut slot order for a left-handed build),
   *   splitAfterFret (0 = one piece; N = two pieces, split just past fret N),
   *   splitAfterFrets (list of frets to split after — up to 3 pieces;
   *   takes precedence over splitAfterFret when non-empty),
   *   autoSplit + bedMm (plan the fewest seams, max 3 pieces, so every
   *   piece fits the print bed; used when no split is specified),
   *   seamKeys (alignment pin + socket at each seam, 0.15 mm clearance),
   *   fretSteps (semitone classes that get a ridge; null = chromatic),
   *   skipMarkers (fret numbers whose marker screw hole is omitted;
   *   default [17] — the spacing up there earns its keep better as wood),
   *   edgeFilletMm (radius of the round-over on the two long TOP edges;
   *   default 1, 0 = sharp. The bottom face and its edges stay sharp and
   *   flat. Frets and the nut are shortened by the same amount at each
   *   end so they finish on the flat top, inside the round-over)
   * earcut: the earcut function (vendored in the browser, required in Node).
   *
   * Returns { triangles (all pieces combined), pieces: [{y0, y1, lengthMm,
   * triangles}], meta }.
   */
  /**
   * Reject parameters the geometry can't honour, with a clear error —
   * better to fail loudly here than to emit NaN coordinates and a
   * broken STL. Ranges are generous (well past the UI's limits); the
   * UI surfaces the message instead of downloading anything.
   */
  function validateParams(p) {
    function num(name, v) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error('Invalid ' + name + ': expected a finite number, got ' + String(v));
      }
    }
    function range(name, v, lo, hi) {
      num(name, v);
      if (v < lo || v > hi) {
        throw new Error('Invalid ' + name + ': ' + v + ' is outside the supported range ' + lo + '–' + hi);
      }
    }
    function intRange(name, v, lo, hi) {
      num(name, v);
      if (!Number.isInteger(v) || v < lo || v > hi) {
        throw new Error('Invalid ' + name + ': expected a whole number from ' + lo + ' to ' + hi + ', got ' + v);
      }
    }
    range('scaleMm', p.scaleMm, 100, 2000);
    intRange('strings', p.strings, 1, 6);
    intRange('frets', p.frets, 1, 36);
    range('nutWidthMm', p.nutWidthMm, 10, 150);
    range('heelWidthMm', p.heelWidthMm, 10, 200);
    range('thicknessMm', p.thicknessMm, 1, 25);
    range('fretHeightMm', p.fretHeightMm, 0, 3);
    range('tailMm', p.tailMm, 0, 300);
    range('nutHeightMm', p.nutHeightMm, 0.5, 10);
    range('nutDepthMm', p.nutDepthMm, 2, 15);
    range('slotHeightMm', p.slotHeightMm, 0.05, 1);
    range('slotSlopeDeg', p.slotSlopeDeg, 0, 20);
    range('tailCornerRadiusMm', p.tailCornerRadiusMm, 0, 25);
    range('headstockExtMm', p.headstockExtMm, 0, 100);
    range('radiusMm', p.radiusMm, 0, 5000);
    if (p.radiusMm > 0 && p.radiusMm < 75) {
      throw new Error('Invalid radiusMm: ' + p.radiusMm + ' is too tight — minimum 75, or 0 for a flat board');
    }
    range('fretBaseWidthMm', p.fretBaseWidthMm, 0.5, 8);
    intRange('splitAfterFret', p.splitAfterFret, 0, 36);
    if (p.splitAfterFrets != null) {
      if (!Array.isArray(p.splitAfterFrets)) {
        throw new Error('Invalid splitAfterFrets: expected an array of fret numbers, or null');
      }
      p.splitAfterFrets.forEach(function (f, i) {
        intRange('splitAfterFrets[' + i + ']', f, 1, 36);
        if (i > 0 && f <= p.splitAfterFrets[i - 1]) {
          throw new Error('Invalid splitAfterFrets: frets must be in increasing order, got ' +
            p.splitAfterFrets.join(', '));
        }
      });
    }
    range('bedMm', p.bedMm, 0, 2000);
    range('edgeFilletMm', p.edgeFilletMm, 0, 3);
    if (p.stringGaugesIn != null) {
      if (!Array.isArray(p.stringGaugesIn) || p.stringGaugesIn.length === 0) {
        throw new Error('Invalid stringGaugesIn: expected a non-empty array of string gauges (inches)');
      }
      p.stringGaugesIn.forEach(function (g, i) { range('stringGaugesIn[' + i + ']', g, 0.005, 0.1); });
    }
    if (p.fretSteps != null && !Array.isArray(p.fretSteps)) {
      throw new Error('Invalid fretSteps: expected an array of semitone classes, or null for chromatic');
    }
    if (p.skipMarkers != null && !Array.isArray(p.skipMarkers)) {
      throw new Error('Invalid skipMarkers: expected an array of fret numbers');
    }
  }

  /**
   * Auto split planner: choose the fewest seams (at most 2, so at most
   * 3 pieces) so every piece fits bedMm, with seams just past a fret
   * ridge and piece lengths as even as the fret lines allow (minimise
   * the longest piece, then the spread). Returns { splitFrets,
   * pieceLengthsMm }. splitFrets is empty when one piece fits; when
   * even 3 pieces can't fit, it's the most even 3-piece split and the
   * build warns about the overflow.
   */
  function planSplits(params, bedMm) {
    var p = Object.assign({
      tailMm: 20, nutDepthMm: 5, headstockExtMm: 0, thicknessMm: 5,
      fretBaseWidthMm: 2.4
    }, params);
    var distances = [];
    for (var n = 0; n <= p.frets; n++) distances.push(fretDistance(p.scaleMm, n));
    var start = -p.nutDepthMm - ((p.headstockExtMm || 0) > 0 ? p.headstockExtMm + p.thicknessMm : 0);
    var end = distances[p.frets] + p.tailMm;
    var cand = [];
    for (var f = 1; f < p.frets; f++) cand.push({ fret: f, y: distances[f] + p.fretBaseWidthMm / 2 });
    function evaluate(seamList) {
      var b = [start].concat(seamList.map(function (s) { return s.y; }), [end]);
      var lens = [];
      for (var i = 0; i < b.length - 1; i++) lens.push(b[i + 1] - b[i]);
      var mean = (end - start) / lens.length;
      return {
        splitFrets: seamList.map(function (s) { return s.fret; }),
        pieceLengthsMm: lens,
        max: Math.max.apply(null, lens),
        dev: lens.reduce(function (s2, L) { return s2 + (L - mean) * (L - mean); }, 0)
      };
    }
    function better(a, b) {
      if (a.max < b.max - 1e-9) return true;
      if (a.max > b.max + 1e-9) return false;
      return a.dev < b.dev;
    }
    var best1 = evaluate([]);
    if (best1.max <= bedMm) return best1;
    var best2 = null;
    cand.forEach(function (c) {
      var e = evaluate([c]);
      if (!best2 || better(e, best2)) best2 = e;
    });
    if (best2 && best2.max <= bedMm) return best2;
    var best3 = null;
    for (var i = 0; i < cand.length; i++) {
      for (var j = i + 1; j < cand.length; j++) {
        var e3 = evaluate([cand[i], cand[j]]);
        if (!best3 || better(e3, best3)) best3 = e3;
      }
    }
    return best3 || best2 || best1;
  }

  function buildFretboard(params, earcut) {
    var p = Object.assign({
      thicknessMm: 5,
      fretHeightMm: 0.9,
      tailMm: 20,
      nutScrew: true,
      tailScrew: false,
      tailCornerRadiusMm: 6.35,
      headstockExtMm: 0,
      radiusMm: 0,
      leftHanded: false,
      nutHeightMm: 2.0,
      slotHeightMm: 0.3,
      slotSlopeDeg: 7.5,
      nutDepthMm: 5,
      stringGaugesIn: null,
      fretBaseWidthMm: 2.4,
      splitAfterFret: 0,
      splitAfterFrets: null,
      autoSplit: false,
      bedMm: 0,
      seamKeys: true,
      fretSteps: null,
      skipMarkers: [17],
      edgeFilletMm: 1
    }, params);
    validateParams(p);

    var warnings = [];
    var distances = [];
    var n;
    for (n = 0; n <= p.frets; n++) distances.push(fretDistance(p.scaleMm, n));
    // Which fret numbers actually get a ridge (all of them when chromatic)
    var keptFrets = [];
    for (n = 1; n <= p.frets; n++) {
      if (!p.fretSteps || p.fretSteps.indexOf(n % 12) !== -1) keptFrets.push(n);
    }
    var lastFretY = distances[p.frets];
    var length = lastFretY + p.tailMm;

    function widthAt(y) {
      // y < 0 is the board's extension under the nut (headstock side of
      // the scale zero): the width stays at the nut width there rather
      // than extrapolating the taper past the nut.
      return p.nutWidthMm + (p.heelWidthMm - p.nutWidthMm) * (Math.max(y, 0) / lastFretY);
    }

    // --- fretboard radius ------------------------------------------------
    // Cylindrical curve across the width, crowned at the centerline:
    // sagAt(x) is how far the surface drops below the center height at
    // offset x; zTopAt(x) is the top surface height there. Flat (the
    // default) makes both constant.
    var radiusR = p.radiusMm || 0;
    function sagAt(x) {
      if (!radiusR) return 0;
      var q = radiusR * radiusR - x * x;
      return q <= 0 ? radiusR : radiusR - Math.sqrt(q);
    }
    function zTopAt(x) { return p.thicknessMm - sagAt(x); }
    if (radiusR) {
      var edgeT = p.thicknessMm - sagAt(Math.max(widthAt(length), p.nutWidthMm) / 2);
      if (edgeT < 3.3) {
        warnings.push('Fretboard edges get thin (≈' + (edgeT / 25.4).toFixed(2) +
          '″) with this radius at this width — consider a flatter radius or a thicker board.');
      }
    }

    // --- top-edge fillet -------------------------------------------------
    // Clamp so at least 1mm of vertical side wall remains at the thinnest
    // edge (radiused boards thin out toward the edges).
    var filletR = p.edgeFilletMm || 0;
    if (filletR) {
      var thinEdge = p.thicknessMm - sagAt(Math.max(widthAt(length), p.nutWidthMm) / 2);
      var maxFillet = Math.max(0, thinEdge - 1);
      if (filletR > maxFillet) {
        warnings.push('Edge round-over reduced to ' + maxFillet.toFixed(2) +
          ' mm so the board edge keeps at least 1 mm of straight side.');
        filletR = maxFillet;
      }
      if (filletR < 0.05) filletR = 0;
    }
    // Frets and the nut stop this far short of the board edge (each end)
    // in addition to their usual clearance: inset = fillet radius, so
    // they end exactly where the rounded zone begins and sit entirely
    // on the full-height top — nothing overhangs or pokes out of the
    // curve. 0 mm radius = today's lengths.
    var featureInset = filletR;

    // --- screw holes ---------------------------------------------------
    var holes = [];
    var skippedMarkers = [];
    MARKER_FRETS.forEach(function (m) {
      if (m > p.frets) return;
      if (p.skipMarkers.indexOf(m) !== -1) return;
      var gap = distances[m] - distances[m - 1];
      var y = (distances[m] + distances[m - 1]) / 2;
      if (gap < SCREW.headRadius * 2 + 2.5) {
        skippedMarkers.push(m);
        return;
      }
      holes.push({ x: 0, y: y, label: 'fret ' + m });
    });
    if (p.nutScrew) {
      var yNut = distances[1] / 2;
      if (yNut - SCREW.headRadius > p.nutDepthMm + 1) {
        holes.push({ x: 0, y: yNut, label: 'nut end' });
      }
    }
    if (p.tailScrew) {
      var yTail = length - 9;
      if (yTail > lastFretY + SCREW.headRadius + 1) {
        holes.push({ x: 0, y: yTail, label: 'tail end' });
      }
    }
    if (skippedMarkers.length) {
      warnings.push('No room for a screw at fret marker(s) ' +
        skippedMarkers.join(', ') + ' — the fret spacing there is narrower than the screw head.');
    }

    // --- split into printable pieces ------------------------------------
    // Each seam sits just past its fret's ridge (on its tail side), so
    // the ridge itself hides the joint line and every fret stays whole
    // on one piece. All pieces screw to the same neck, which is what
    // registers them to each other. Splits come from splitAfterFrets
    // (a list — up to 3 pieces), the legacy splitAfterFret (one seam),
    // or the Auto planner (autoSplit + bedMm) when neither is given.
    // The board blank starts nutDepthMm BEFORE the scale zero: the nut
    // sits on the headstock side of y=0, so its fret-side face — the
    // point the strings actually leave from — is exactly at y=0 and
    // every fret distance is measured from the true break point.
    var boardStart = -p.nutDepthMm;
    var requestedSplits = [];
    if (Array.isArray(p.splitAfterFrets) && p.splitAfterFrets.length) {
      requestedSplits = p.splitAfterFrets.slice();
    } else if (p.splitAfterFret > 0) {
      requestedSplits = [p.splitAfterFret];
    } else if (p.autoSplit && p.bedMm > 0) {
      requestedSplits = planSplits(p, p.bedMm).splitFrets;
    }
    var seams = []; // [{fret, y}] effective seams, in order
    requestedSplits.forEach(function (f) {
      if (f < p.frets) {
        seams.push({ fret: f, y: distances[f] + p.fretBaseWidthMm / 2 });
      } else {
        warnings.push('Split not applied after fret ' + f + ': with ' + p.frets +
          ' frets there is no fret ' + f + ' to split after.');
      }
    });
    var seamYs = seams.map(function (s) { return s.y; });
    var splitY = seamYs.length ? seamYs[0] : null;
    var bounds = [boardStart].concat(seamYs, [length]);
    var ranges = [];
    for (var ri = 0; ri < bounds.length - 1; ri++) ranges.push([bounds[ri], bounds[ri + 1]]);

    // Alignment keys per seam: two pins across the width at mid
    // thickness, when requested and the seam cross-section has room
    // (enough width, thickness, and material above the socket).
    var seamCircles = seams.map(function (s) {
      if (!p.seamKeys) return null;
      var w = widthAt(s.y), cz = p.thicknessMm / 2;
      var xs = [-w / 4, w / 4];
      // Room check against the FINISHED top: the lowest point of the
      // (radiused, filleted) top surface anywhere over the socket's width
      // must stay >= 0.3mm above the socket, so a pin or socket can never
      // break through the round-over; and the socket keeps >= 0.3mm of
      // side wall inside the board edge.
      function minTopOver(x) {
        var m = Infinity;
        for (var k = -4; k <= 4; k++) {
          var xx = x + (k / 4) * KEY.socketR;
          m = Math.min(m, zTopAt(xx) - filletDrop(xx, w / 2, filletR));
        }
        return m;
      }
      var ok = w >= 24 && p.thicknessMm >= 4.2 && xs.every(function (x) {
        return minTopOver(x) - (cz + KEY.socketR) >= 0.3 && cz - KEY.socketR >= 0.3 &&
          Math.abs(x) + KEY.socketR <= w / 2 - 0.3;
      });
      if (!ok) {
        warnings.push('Alignment pins skipped at the seam after fret ' + s.fret +
          ' — the board is too narrow or thin there.');
        return null;
      }
      return xs.map(function (x) { return { x: x, z: cz }; });
    });

    var embed = 0.6;
    var groupBody = [], groupEndWalls = [], groupRecess = [], groupFeatures = [];
    var wn = p.nutWidthMm;
    var gauges = p.stringGaugesIn || STRING_GAUGES[p.strings] || STRING_GAUGES[3];
    var coneDepth = 0;
    var nutInfo = null;
    var tris = [];
    var pieces = [];
    // Rounded tail corners (last piece only), clamped to fit the board.
    var cornerR = Math.min(p.tailCornerRadiusMm || 0, widthAt(length) / 2 - 2, length / 4);
    if (cornerR < 0.5) cornerR = 0;

    ranges.forEach(function (range, pieceIdx) {
      var y0 = range[0], y1 = range[1];
      var pieceHoles = holes.filter(function (h) {
        return h.y > y0 + 0.01 && h.y < y1 - 0.01;
      });
      var stations = [y0];
      distances.forEach(function (d) {
        if (d > y0 + 0.001 && d < y1 - 0.001) stations.push(d);
      });
      stations.push(y1);

      // --- outline + face width function for this piece ----------------
      // The board's tail end can have rounded corners so it drops into a
      // routed neck pocket (a router bit leaves radiused corners). The
      // face triangulation gets extra stations in the corner zone and a
      // width function that follows the arcs, so faces and walls share
      // the same boundary points.
      var r = pieceIdx === ranges.length - 1 ? cornerR : 0;
      var wFn = widthAt;
      if (r > 0) {
        var cx = widthAt(length) / 2 - r;
        wFn = function (y) {
          if (y <= length - r) return widthAt(y);
          var dy = y - (length - r);
          var arcHalf = cx + Math.sqrt(Math.max(0, r * r - dy * dy));
          return Math.min(widthAt(y), arcHalf * 2);
        };
        [1, 2, 3].forEach(function (k) {
          stations.push(length - r + r * Math.sin((k * Math.PI) / 8));
        });
        stations.push(length - r);
      }

      var pieceSockets = pieceIdx > 0 && seamCircles[pieceIdx - 1]
        ? seamCircles[pieceIdx - 1].map(function (c) { return { x: c.x, z: c.z, r: KEY.socketR }; })
        : null;
      var joinExt = pieceIdx === 0 && p.headstockExtMm > 0;
      var body = boardBody(p, pieceHoles, wFn, y0, y1, stations, earcut, zTopAt, pieceSockets, filletR, joinExt);
      coneDepth = body.coneDepth;
      var ptris = body.tris.concat(body.endWalls, body.recess);
      groupBody = groupBody.concat(body.tris);
      groupEndWalls = groupEndWalls.concat(body.endWalls);
      groupRecess = groupRecess.concat(body.recess);

      // --- integrated frets whose ridge falls inside this piece --------
      // The fret profile is a half-ellipse crown (like real fret wire):
      // rounded over the top instead of a flat-topped trapezoid, so the
      // string rolls over it and there's no sharp edge to wear or chip.
      for (n = 1; n <= p.frets; n++) {
        if (keptFrets.indexOf(n) === -1) continue; // not in this fret mode
        var y = distances[n];
        if (y < y0 + 0.01 || y > y1 - 0.01) continue;
        var half = widthAt(y) / 2 - 0.4 - featureInset;
        var halfBase = p.fretBaseWidthMm / 2;
        var rise = p.fretHeightMm + embed; // ellipse semi-axis, base -> crown
        var profile = [
          [y - halfBase, p.thicknessMm - embed],
          [y + halfBase, p.thicknessMm - embed]
        ];
        var CSEG = 16, k, ang;
        for (k = 1; k < CSEG; k++) {
          ang = (k / CSEG) * Math.PI;
          profile.push([
            y + halfBase * Math.cos(ang),
            p.thicknessMm - embed + rise * Math.sin(ang)
          ]);
        }
        // Cap each fret end with a true half dome, like the ball end of
        // a filed fret: the profile is lofted along x through sections
        // sampled on a quarter ellipse — at angle a from the dome's pole
        // the section sits domeR*(1 - cos a) in from the tip and is
        // scaled by sin a — so the end curves continuously in both
        // silhouettes (a semicircle in plan, a quarter ellipse from the
        // side) and sinks through the board surface instead of stopping
        // at a small vertical end wall, which read as a sharp point.
        // The outermost section (a = 11.25 deg) still sits below the
        // board top, so the cap fan closing the loft stays buried.
        var domeR = Math.min(halfBase, half * 0.5);
        var full = half - domeR; // half-width of the full-height zone
        var DSEG = 8, dk, da;
        var sections = [];
        for (dk = 1; dk <= DSEG; dk++) {
          da = (dk / DSEG) * Math.PI / 2;
          sections.push({ x: -half + domeR * (1 - Math.cos(da)), s: Math.sin(da) });
        }
        [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75].forEach(function (fr) {
          sections.push({ x: fr * full, s: 1 });
        });
        for (dk = DSEG; dk >= 1; dk--) {
          da = (dk / DSEG) * Math.PI / 2;
          sections.push({ x: half - domeR * (1 - Math.cos(da)), s: Math.sin(da) });
        }
        // Each section drops by the radius sag at its x, so the crown
        // stands fretHeightMm proud of the LOCAL surface everywhere.
        sections.forEach(function (sec) { sec.dz = -sagAt(sec.x); });
        ptris = ptris.concat(loftProfileX(profile, y, p.thicknessMm - embed, sections));
      }

      // --- integrated nut with string slots (first piece only) ---------
      // Each slot is sized for its string: width = gauge + a hair of
      // clearance. The slot FLOOR is set from a target action: how high
      // the string's underside sits above the first fret's crown,
      // measured at the nut's fret-side face. Bass strings sit highest,
      // treble strings lowest — slotHeightMm is the treble target and
      // the bass target runs up to 0.2mm higher (capped at 0.5mm). The
      // nut top then follows from the floors: each string sits ~60% of
      // its diameter down in its slot, and the nut is never shorter
      // than nutHeightMm. The nut is built as a row of segment boxes
      // alternating raised material and slot floors.
      if (pieceIdx === 0) {
        var nStr = p.strings;
        var trebleTarget = p.slotHeightMm;
        var bassTarget = Math.min(0.5, p.slotHeightMm + 0.2);
        function slotTarget(j) { // j: string index, low -> high
          if (nStr <= 1) return trebleTarget;
          return bassTarget + (trebleTarget - bassTarget) * (j / (nStr - 1));
        }
        function slotFloor(j) {
          // never below the first fret's crown (+ a hair for safety)
          return Math.max(p.thicknessMm + p.fretHeightMm + slotTarget(j),
            p.thicknessMm + p.fretHeightMm + 0.02);
        }
        var nutTop = p.thicknessMm + p.nutHeightMm;
        var nutTargets = [], nutFloors = [];
        if (nStr > 0) {
          for (var gi = 0; gi < nStr; gi++) {
            var gDia = (gauges[gi] || 0.024) * 25.4;
            nutTargets.push(slotTarget(gi));
            nutFloors.push(slotFloor(gi));
            nutTop = Math.max(nutTop, slotFloor(gi) + 0.6 * gDia);
          }
        }
        nutInfo = { topMm: nutTop, targetsMm: nutTargets, floorsMm: nutFloors };
        if (p.strings > 0) {
          var margin = Math.max(3.2, wn * 0.09);
          var spread = wn - margin * 2;
          var stringX = [];
          var i;
          for (i = 0; i < p.strings; i++) {
            stringX.push(p.strings === 1 ? 0 : -spread / 2 + (spread * i) / (p.strings - 1));
          }
          // 3-string CBG nuts use fixed spacing: center slot on the
          // centerline, the outer two 1/2" away on each side (clamped
          // on very narrow nuts so the slots stay on the board).
          if (p.strings === 3) {
            var s3 = Math.min(12.7, spread / 2);
            stringX = [-s3, 0, s3];
          }
          var segs = [];
          // nut ends pull in by the fillet inset, but always leave at
          // least 0.8mm of nut outside the outermost slot
          var maxSlotHalf = 0;
          stringX.forEach(function (x, si) {
            var jj = p.leftHanded ? si : p.strings - 1 - si;
            maxSlotHalf = Math.max(maxSlotHalf, ((gauges[jj] || 0.024) * 25.4 + 0.1) / 2);
          });
          var outerX = Math.max(Math.abs(stringX[0]), Math.abs(stringX[stringX.length - 1]));
          var nutInset = Math.max(0, Math.min(featureInset, wn / 2 - outerX - maxSlotHalf - 0.8));
          if (nutInset < featureInset - 1e-9) {
            warnings.push('Nut ends could only be pulled in ' + nutInset.toFixed(2) +
              ' mm (not the full ' + featureInset.toFixed(2) +
              ' mm round-over) to keep material beside the outer slots.');
          }
          if (nutInfo) nutInfo.insetMm = nutInset;
          var cursor = -wn / 2 + nutInset;
          stringX.forEach(function (x, si) {
            // Gauges run low->high. On a right-handed board the thick
            // strings sit at the +x side of the nut, so the slot order is
            // reversed; the left-handed option restores low-at--x. The
            // gauge index j follows the STRING (not the slot position),
            // so the slot-floor target ramp tracks pitch.
            var j = p.leftHanded ? si : p.strings - 1 - si;
            var g = gauges[j];
            var diaMm = (g || 0.024) * 25.4;
            var w = diaMm + 0.1;
            segs.push({ x0: cursor, x1: x - w / 2, top: nutTop });
            segs.push({ x0: x - w / 2, x1: x + w / 2, top: slotFloor(j), slot: true, j: j });
            cursor = x + w / 2;
          });
          segs.push({ x0: cursor, x1: wn / 2 - nutInset, top: nutTop });
        } else {
          segs = [{ x0: -wn / 2 + featureInset, x1: wn / 2 - featureInset, top: nutTop }];
          if (nutInfo) nutInfo.insetMm = featureInset;
        }
        // Emit the nut segments. The two END segments get a round-over
        // at their outer face — a true 1.2mm radius carried in the
        // segment's side profile and lofted along the nut's depth — so
        // the nut's left and right ends can't catch or cut a hand
        // sliding up the neck. The long front/back edges stay square,
        // and slot floors are exact boxes. On a radiused board each
        // segment is sliced into <=3mm sub-boxes whose tops follow the
        // curve (so slot depth is constant at every string), and the
        // nut's base reaches deeper so its corners stay buried.
        var nutBottom = p.thicknessMm - embed - sagAt(wn / 2);
        var ROLL_R = 1.2;
        function rolledProfile(x0, x1, top, roll, ROLL_R) {
          var prof = [[x0, nutBottom], [x1, nutBottom]];
          var a, th;
          if (roll === 'R' || roll === 'LR') {
            prof.push([x1, top - ROLL_R]);
            for (a = 15; a < 90; a += 15) {
              th = (a * Math.PI) / 180;
              prof.push([x1 - ROLL_R + ROLL_R * Math.cos(th), top - ROLL_R + ROLL_R * Math.sin(th)]);
            }
            prof.push([x1 - ROLL_R, top]);
          } else {
            prof.push([x1, top]);
          }
          if (roll === 'L' || roll === 'LR') {
            prof.push([x0 + ROLL_R, top]);
            for (a = 105; a < 180; a += 15) {
              th = (a * Math.PI) / 180;
              prof.push([x0 + ROLL_R + ROLL_R * Math.cos(th), top - ROLL_R + ROLL_R * Math.sin(th)]);
            }
            prof.push([x0, top - ROLL_R]);
          } else if (roll === 'R') {
            prof.push([x0, top]); // close the top edge (the L block does it otherwise)
          }
          return prof;
        }
        function emitBox(x0, x1, top, roll) {
          var rr = ROLL_R;
          var need = roll === 'LR' ? 2 * rr + 0.6 : rr + 0.6;
          // With a fillet the end segments get shorter; shrink the
          // round-over to fit (keeping 0.6mm flat) rather than falling
          // back to a sharp square end.
          if (roll && filletR && x1 - x0 < need) {
            rr = ((x1 - x0) - 0.6) / (roll === 'LR' ? 2 : 1);
            if (rr >= 0.3) need = 0;
          }
          if (!roll || x1 - x0 < need) {
            ptris = ptris.concat(box(x0, x1, -p.nutDepthMm, 0, nutBottom, top));
            return;
          }
          ptris = ptris.concat(loftProfileY(
            rolledProfile(x0, x1, top, roll, rr), (x0 + x1) / 2, nutBottom,
            [{ y: -p.nutDepthMm, s: 1 }, { y: 0, s: 1 }]));
        }
        // Emit one slot as a prism whose top — the slot floor — slopes
        // DOWN toward the headstock: highest exactly at the fret-side
        // face (y=0, the scale zero), so the string's only contact
        // point, its break point, is pinned to the face. The drop over
        // the nut depth is tan(slope) x depth, clamped so at least
        // 0.3mm of nut always remains under the slot. Floors are
        // lofted with shared vertices, keeping the mesh watertight.
        var nutFloorsBack = [];
        function emitSlot(x0, x1, floor) {
          var drop = Math.min(
            Math.tan((p.slotSlopeDeg * Math.PI) / 180) * p.nutDepthMm,
            floor - (nutBottom + 0.3));
          if (drop < 0) drop = 0;
          var profile = [
            [-p.nutDepthMm, nutBottom], [0, nutBottom],
            [0, floor], [-p.nutDepthMm, floor - drop]
          ];
          var steps = Math.max(1, Math.ceil((x1 - x0) / 3));
          for (var st = 0; st < steps; st++) {
            var bx0 = x0 + ((x1 - x0) * st) / steps;
            var bx1 = x0 + ((x1 - x0) * (st + 1)) / steps;
            var dz = -sagAt((bx0 + bx1) / 2);
            ptris = ptris.concat(loftProfileX(profile, 0, 0, [
              { x: bx0, s: 1, dz: dz }, { x: bx1, s: 1, dz: dz }
            ]));
          }
          return floor - drop;
        }
        segs.forEach(function (s, si) {
          if (s.x1 - s.x0 <= 0.01) return;
          if (s.slot) {
            nutFloorsBack[s.j] = emitSlot(s.x0, s.x1, s.top);
            return;
          }
          var roll = segs.length === 1 ? 'LR' : si === 0 ? 'L' : si === segs.length - 1 ? 'R' : null;
          if (!radiusR) {
            emitBox(s.x0, s.x1, s.top, roll);
            return;
          }
          var steps = Math.max(1, Math.ceil((s.x1 - s.x0) / 3));
          for (var st = 0; st < steps; st++) {
            var bx0 = s.x0 + ((s.x1 - s.x0) * st) / steps;
            var bx1 = s.x0 + ((s.x1 - s.x0) * (st + 1)) / steps;
            var bTop = s.top - sagAt((bx0 + bx1) / 2);
            var subRoll = null;
            if (st === 0 && (roll === 'L' || roll === 'LR')) subRoll = steps === 1 ? 'LR' : 'L';
            if (st === steps - 1 && (roll === 'R' || roll === 'LR')) subRoll = steps === 1 ? 'LR' : 'R';
            emitBox(bx0, bx1, bTop, subRoll);
          }
        });
        if (nutInfo) nutInfo.floorsBackMm = nutFloorsBack;
      }

      // --- headstock extension (first piece only) ----------------------
      // A classic electric-style tongue past the nut: a FLAT portion at full
      // thickness extends headstockExtMm past the nut, then a 45-degree
      // taper runs down the full board thickness to the tip — so the
      // total reach past the nut is headstockExtMm + thicknessMm.
      if (pieceIdx === 0 && p.headstockExtMm > 0) {
        var ext = p.headstockExtMm;
        var nd = p.nutDepthMm; // the wedge starts at the nut's headstock face
        // Same long-edge round-over as the board: sample across the
        // width on the board's own chain points (so the extension's
        // nut-side face matches the board's end wall exactly) and drop
        // only the TOP vertices — the bottom stays flat at z = 0.
        // (The previous loft shifted the WHOLE profile by the radius
        // sag, pushing the extension's bottom up to ~0.6mm below z=0 on
        // radiused boards, and was a separate shell sharing part of a
        // face with the board — a non-manifold seam.)
        var eSecs = chainXs(wn / 2, filletR).map(function (wx) {
          var h = p.thicknessMm - sagAt(wx) - filletDrop(wx, wn / 2, filletR);
          return [[wx, -nd, 0], [wx, -(nd + ext + p.thicknessMm), 0], [wx, -(nd + ext), h], [wx, -nd, h]];
        });
        // band 3 (top-back -> bottom-back, the y = -nd face) is left
        // open: it coincides with the board's start wall, which is
        // omitted too, so board + extension form one closed solid.
        ptris = ptris.concat(loftSections(eSecs, 3));
      }

      // alignment pins on this piece's tail seam (they plug into the
      // next piece's sockets); appended after the recess so they land
      // in the features slice below
      if (pieceIdx < ranges.length - 1 && seamCircles[pieceIdx]) {
        seamCircles[pieceIdx].forEach(function (c) {
          ptris = ptris.concat(seamPin(c.x, c.z, y1));
        });
      }

      groupFeatures = groupFeatures.concat(ptris.slice(body.tris.length + body.endWalls.length + body.recess.length));
      var extReach = (p.headstockExtMm || 0) > 0 ? p.headstockExtMm + p.thicknessMm : 0;
      var pieceY0 = pieceIdx === 0 ? y0 - extReach : y0;
      pieces.push({ y0: pieceY0, y1: y1, lengthMm: y1 - pieceY0, triangles: ptris });
      tris = tris.concat(ptris);
    });

    if (p.bedMm > 0) {
      pieces.forEach(function (piece, pi) {
        if (piece.lengthMm > p.bedMm + 0.01) {
          warnings.push('Part ' + (pi + 1) + ' is ' + piece.lengthMm.toFixed(0) +
            ' mm long — longer than the ' + p.bedMm + ' mm print bed.');
        }
      });
    }

    return {
      triangles: tris,
      // Preview layers, painted in this order (the camera always looks
      // from above the board): body, then the recessed hole walls, then
      // the raised features. Same triangles as 'pieces', grouped so the
      // painter sort never has to order a fret against the face under it.
      groups: { endWalls: groupEndWalls, body: groupBody, recess: groupRecess, features: groupFeatures },
      pieces: pieces,
      meta: {
        lengthMm: p.nutDepthMm + length + ((p.headstockExtMm || 0) > 0 ? p.headstockExtMm + p.thicknessMm : 0),
        lastFretYMm: lastFretY,
        nutWidthMm: wn,
        tailWidthMm: widthAt(length),
        fretDistancesMm: distances,
        holes: holes,
        skippedMarkers: skippedMarkers,
        coneDepthMm: coneDepth,
        splitYMm: splitY,
        splitYMs: seamYs,
        splitFrets: seams.map(function (s) { return s.fret; }),
        seamKeys: !!p.seamKeys,
        keptFrets: keptFrets,
        radiusMm: radiusR,
        stringGaugesIn: gauges,
        nut: nutInfo,
        edgeFilletMm: filletR,
        featureInsetMm: featureInset,
        tuningLabel: TUNING_LABELS[p.strings] || '',
        triangleCount: tris.length / 9,
        warnings: warnings
      }
    };
  }

  var api = {
    SCREW: SCREW,
    MARKER_FRETS: MARKER_FRETS,
    STRING_GAUGES: STRING_GAUGES,
    FRET_MODES: FRET_MODES,
    PRESETS: PRESETS,
    PRESET_KEYS: PRESET_KEYS,
    matchPreset: matchPreset,
    presetParams: presetParams,
    fretDistance: fretDistance,
    planSplits: planSplits,
    buildFretboard: buildFretboard,
    signedVolume: signedVolume
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Fretboard = api;
  }
})(typeof window !== 'undefined' ? window : this);
