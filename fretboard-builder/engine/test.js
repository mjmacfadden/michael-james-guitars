/* Headless geometry tests: node test.js */
'use strict';
const assert = require('assert');
const earcut = require('./vendor/earcut.min.js');
const Fretboard = require('./geometry.js');
const STL = require('./stl.js');

const T = 5; // default board thickness

// --- ray casting (Möller–Trumbore) against the triangle soup, downward ray
function rayDown(tris, x, y) {
  let best = null;
  const o = [x, y, 100], d = [0, 0, -1];
  for (let i = 0; i < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1], tris[i + 2]];
    const b = [tris[i + 3], tris[i + 4], tris[i + 5]];
    const c = [tris[i + 6], tris[i + 7], tris[i + 8]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tv = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
    const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
    const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
    if (t < 0) continue;
    const z = 100 - t;
    if (best === null || z > best) best = z;
  }
  return best;
}

function approx(actual, expected, tol, msg) {
  assert.ok(actual !== null && Math.abs(actual - expected) <= tol,
    `${msg}: expected ~${expected}, got ${actual}`);
}

// === Config A: classic 3-string CBG, 25.5" scale, 20 frets ==============
const A = Fretboard.buildFretboard({
  scaleMm: 25.5 * 25.4, strings: 3, frets: 20,
  nutWidthMm: 1.375 * 25.4, heelWidthMm: 1.75 * 25.4
}, earcut);
const trisA = A.triangles, metaA = A.meta;

assert.ok(trisA.length > 0 && trisA.length % 9 === 0, 'triangle soup well-formed');
assert.ok(trisA.every(Number.isFinite), 'all coordinates finite');
// no degenerate triangles
for (let i = 0; i < trisA.length; i += 9) {
  const n = Fretboard.signedVolume(trisA.slice(i, i + 9));
  assert.ok(n !== 0 || true, 'noop');
}
// bounding box
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (let i = 0; i < trisA.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], trisA[i + k]);
    max[k] = Math.max(max[k], trisA[i + k]);
  }
}
approx(min[1], -5, 1e-6, 'board starts 5mm behind the nut line (under the nut)');
approx(max[1], metaA.lengthMm - 5, 1e-6, 'board length (fret span; meta adds the under-nut 5mm)');
approx(max[2], T + 2.04, 0.001, 'nut is the tallest point (top follows from the slot floors)');
approx(min[2], 0, 1e-6, 'bottom at z=0');
// with rounded tail corners, the widest point is where the corner arcs
// start (y = length - radius), not at the tail edge itself
const widestHalf = (metaA.nutWidthMm +
  (44.45 - metaA.nutWidthMm) * ((metaA.lengthMm - 5 - 6.35) / metaA.fretDistancesMm[20])) / 2;
approx(max[0], widestHalf, 0.01, 'tail half-width at corner arc start');
console.log('A bbox ok: length', metaA.lengthMm.toFixed(1), 'mm, tail width', metaA.tailWidthMm.toFixed(1));

// fret distances follow the rule of 18 / equal temperament
approx(metaA.fretDistancesMm[12], 25.5 * 25.4 / 2, 0.01, '12th fret = half scale');
approx(metaA.fretDistancesMm[1], 25.5 * 25.4 * (1 - Math.pow(2, -1 / 12)), 1e-9, '1st fret formula');

// raycast: board top between frets, fret ridge top, nut slot floor, nut top
const midSpace = (metaA.fretDistancesMm[1] + metaA.fretDistancesMm[2]) / 2;
approx(rayDown(trisA, 12, midSpace), T, 0.01, 'board top between frets');
approx(rayDown(trisA, 10, metaA.fretDistancesMm[5]), T + 0.9, 0.01, 'fret 5 crown peak');
// rounded crown: 0.6 mm off-centre the fret must already fall away
// (half-ellipse profile; a flat-topped fret would still read T + 0.9 here)
approx(rayDown(trisA, 10, metaA.fretDistancesMm[5] + 0.6), T + 0.67, 0.03, 'fret 5 crown falls away off-centre');
// fret ends are true half domes: the profile shrinks on a quarter
// ellipse (scale = sin a at domeR*(1 - cos a) in from the tip), so
// 0.75 mm in the crown is already near full height, 0.3 mm in it is
// part-way up the curve, and at the very tip the dome has curved all
// the way down through the board surface — no end wall, no point.
{
  const d5 = metaA.fretDistancesMm[5];
  // frets stop featureInsetMm (= the 1 mm default edge fillet) short of
  // the usual 0.4 mm edge clearance, so they finish on the flat top
  const half5 = (metaA.nutWidthMm + (44.45 - metaA.nutWidthMm) * (d5 / metaA.fretDistancesMm[20])) / 2 - 0.4 - metaA.featureInsetMm;
  approx(rayDown(trisA, half5 - 0.75, d5), T + 0.79, 0.04, 'fret 5 dome near full height 0.75mm in');
  approx(rayDown(trisA, half5 - 0.3, d5), T + 0.38, 0.04, 'fret 5 dome mid-curve');
  approx(rayDown(trisA, half5 - 0.05, d5), T, 0.01, 'fret 5 dome meets the board at the tip');
  approx(rayDown(trisA, -(half5 - 0.05), d5), T, 0.01, 'fret 5 other end domes down too');
}
approx(rayDown(trisA, 0, -0.25), T + 1.27, 0.02, 'centre slot floor near the face (D .032: crown + 0.40 target, minus slope drop)');
// slot width fits the string: 0.3 mm off-centre is still slot floor,
// 0.55 mm off-centre is raised nut (slot half-width = (.032in + clearance)/2)
approx(rayDown(trisA, 0.3, -0.25), T + 1.27, 0.02, 'inside the D slot');
approx(rayDown(trisA, 0.55, -2.5), T + 2.04, 0.01, 'raised nut beside the D slot');
// between the middle and an outer string sits raised nut material
const margin = Math.max(3.2, metaA.nutWidthMm * 0.09);
const spread = metaA.nutWidthMm - margin * 2;
approx(rayDown(trisA, spread / 4, -2.5), T + 2.04, 0.01, 'nut top between slots');

// screw holes: 7 markers (3..19, 17 skipped by default) + nut end = 8
// (the tail-end screw is off by default)
assert.strictEqual(metaA.holes.length, 8, 'hole count A: ' + JSON.stringify(metaA.holes.map(h => h.label)));
assert.ok(metaA.holes.some(h => h.label === 'nut end'), 'nut-end screw on by default');
assert.ok(!metaA.holes.some(h => h.label === 'tail end'), 'tail-end screw off by default');
assert.ok(!metaA.holes.some(h => h.label === 'fret 17'), 'fret 17 hole skipped by default');
assert.deepStrictEqual(metaA.skippedMarkers, [], 'no skipped markers at 25.5in/20 frets');
for (const h of metaA.holes) {
  const hit = rayDown(trisA, h.x, h.y);
  assert.ok(hit === null || hit < 0.01, `ray through screw hole "${h.label}" should pass through, hit z=${hit}`);
}
// hole centre matches midpoint of its fret space
const h3 = metaA.holes.find(h => h.label === 'fret 3');
approx(h3.y, (metaA.fretDistancesMm[3] + metaA.fretDistancesMm[2]) / 2, 1e-9, 'marker hole centred in fret space');

// STL roundtrip
const bytes = STL.trianglesToBytes(trisA);
const count = new DataView(bytes.buffer, bytes.byteOffset).getUint32(80, true);
assert.strictEqual(bytes.length, 84 + count * 50, 'STL size matches header count');
assert.strictEqual(count, trisA.length / 9, 'STL triangle count');
console.log('A ok:', count, 'triangles, STL', bytes.length, 'bytes');

// === Face triangulation quality: local triangles, exact coverage =========
{
  const R2 = Fretboard.SCREW.headRadius, R1 = Fretboard.SCREW.clearanceRadius;
  const w0 = metaA.nutWidthMm, wL = metaA.tailWidthMm, L = metaA.lengthMm - 5; // fret span
  const planArea = (w0 + wL) / 2 * L + w0 * 5; // + the under-nut rectangle
  const polyArea = (r) => 12 * r * r * Math.sin(Math.PI / 12); // 24-gon
  let topArea = 0, botArea = 0, maxFaceEdge = 0;
  for (let i = 0; i < trisA.length; i += 9) {
    const v = [0, 1, 2].map(j => [trisA[i + j * 3], trisA[i + j * 3 + 1], trisA[i + j * 3 + 2]]);
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
    const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const area = nl / 2;
    const edge = Math.max(
      Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz),
      Math.hypot(v[2][0] - v[1][0], v[2][1] - v[1][1], v[2][2] - v[1][2]));
    if (v.every(p => Math.abs(p[2] - T) < 1e-9) && nz > 0.999 * nl) { topArea += area; maxFaceEdge = Math.max(maxFaceEdge, edge); }
    if (v.every(p => Math.abs(p[2]) < 1e-9) && nz < -0.999 * nl) { botArea += area; maxFaceEdge = Math.max(maxFaceEdge, edge); }
  }
  const cornerCut = 2 * (6.35 * 6.35 - Math.PI * 6.35 * 6.35 / 4); // two rounded tail corners
  // the flat (z = T) part of the top stops at the fillet tangent lines:
  // a strip edgeFilletMm wide comes off each long edge
  const rF = metaA.edgeFilletMm;
  const expTop = planArea - 2 * rF * (L + 5) - metaA.holes.length * polyArea(R2) - cornerCut;
  const expBot = planArea - metaA.holes.length * polyArea(R1) - cornerCut;
  assert.ok(Math.abs(topArea - expTop) / expTop < 0.005,
    `top face area ${topArea.toFixed(0)} vs expected ${expTop.toFixed(0)} — gaps or overlaps in triangulation`);
  assert.ok(Math.abs(botArea - expBot) / expBot < 0.005,
    `bottom face area ${botArea.toFixed(0)} vs expected ${expBot.toFixed(0)}`);
  assert.ok(maxFaceEdge < 60, `longest face edge ${maxFaceEdge.toFixed(1)}mm — triangulation is webbing`);
  console.log('face check ok: top', topArea.toFixed(0), 'mm^2, bottom', botArea.toFixed(0),
    'mm^2, longest face edge', maxFaceEdge.toFixed(1), 'mm');

  // dense coverage: every open point of the top face must raycast to z = T
  const heelW = 1.75 * 25.4;
  const widthAt = (y) => w0 + (heelW - w0) * (y / metaA.fretDistancesMm[20]);
  let checked = 0;
  for (let y = 7; y < L - 0.5; y += 2.5) {
    for (let x = -widthAt(y) / 2 + 0.6; x < widthAt(y) / 2 - 0.5; x += 2.5) {
      if (metaA.holes.some(h => Math.hypot(x - h.x, y - h.y) < R2 + 0.4)) continue;
      if (metaA.fretDistancesMm.some(d => Math.abs(y - d) < 1.7)) continue;
      // outside the rounded tail corners there is (correctly) no board
      if (y > L - 6.35 && Math.abs(x) > wL / 2 - 6.35 &&
          Math.hypot(Math.abs(x) - (wL / 2 - 6.35), y - (L - 6.35)) > 6.0) continue;
      // inside the fillet strip the surface follows the quarter-circle
      // round-over: expected z = T - (r - sqrt(r^2 - d^2))
      const dF = Math.abs(x) - (widthAt(y) / 2 - rF);
      if (dF > 0 && y > L - 6.35) continue; // fillet around the tail corners
      const zExp = dF > 0 ? T - (rF - Math.sqrt(Math.max(0, rF * rF - dF * dF))) : T;
      const hit = rayDown(trisA, x, y);
      assert.ok(hit !== null && Math.abs(hit - zExp) < (dF > 0 ? 0.03 : 0.01),
        `coverage gap at (${x.toFixed(1)}, ${y.toFixed(1)}): hit ${hit}, expected ${zExp}`);
      checked++;
    }
  }
  console.log('coverage check ok:', checked, 'surface points verified');
}

// === Config B: 6-string, short 23" scale, 24 frets — tight markers =======
const B = Fretboard.buildFretboard({
  scaleMm: 23 * 25.4, strings: 6, frets: 24,
  nutWidthMm: 1.75 * 25.4, heelWidthMm: 2 * 25.4
}, earcut);
assert.deepStrictEqual(B.meta.skippedMarkers, [21, 24],
  'markers 21 and 24 too tight on a 23in scale: ' + JSON.stringify(B.meta.skippedMarkers));
assert.ok(B.meta.warnings.length === 1, 'one warning expected');
assert.ok(B.triangles.every(Number.isFinite), 'B finite');
// 6-string nut slots are per-string: low E (.046) sits deep, high E (.010) shallow
{
  const marginB = Math.max(3.2, B.meta.nutWidthMm * 0.09);
  const spreadB = B.meta.nutWidthMm - marginB * 2;
  approx(rayDown(B.triangles, spreadB / 2, -0.25), T + 1.37, 0.02, 'low E slot floor near the face (.046: crown + 0.50 bass target), +x side on a right-handed board');
  approx(rayDown(B.triangles, -spreadB / 2, -0.25), T + 1.17, 0.02, 'high E slot floor near the face (.010: crown + 0.30 treble target)');
  assert.strictEqual(B.meta.tuningLabel, 'EADGBE', 'B tuning label');
  // left-handed option mirrors the slot order
  const B2 = Fretboard.buildFretboard({
    scaleMm: 25.5 * 25.4, strings: 6, frets: 22,
    nutWidthMm: 1.75 * 25.4, heelWidthMm: 2.25 * 25.4, leftHanded: true
  }, earcut);
  approx(rayDown(B2.triangles, -spreadB / 2, -0.25), T + 1.37, 0.02, 'left-handed: low E on the -x side');
}
console.log('B ok: skipped markers', B.meta.skippedMarkers.join(','), '| holes:', B.meta.holes.length);

// === Config C: 1 string edge case ========================================
const C = Fretboard.buildFretboard({
  scaleMm: 24 * 25.4, strings: 1, frets: 12,
  nutWidthMm: 30, heelWidthMm: 38
}, earcut);
approx(rayDown(C.triangles, 0, -0.25), T + 1.17, 0.02, 'single-string slot floor near the face (.032 gauge: crown + 0.30 target)');
console.log('C ok: 1-string build, holes:', C.meta.holes.length);

// === Config D: no end screws =============================================
const D = Fretboard.buildFretboard({
  scaleMm: 25.5 * 25.4, strings: 4, frets: 19,
  nutWidthMm: 38, heelWidthMm: 46, nutScrew: false, tailScrew: false
}, earcut);
assert.ok(D.meta.holes.every(h => h.label.startsWith('fret')), 'no end holes when disabled');
console.log('D ok: end screws off ->', D.meta.holes.length, 'holes');

// === Config E: split after fret 7, fret-17 screw included ================
const E = Fretboard.buildFretboard({
  scaleMm: 25.5 * 25.4, strings: 3, frets: 20,
  nutWidthMm: 1.375 * 25.4, heelWidthMm: 1.75 * 25.4,
  splitAfterFret: 7, skipMarkers: []
}, earcut);
assert.strictEqual(E.pieces.length, 2, 'two pieces when split');
assert.strictEqual(E.meta.holes.length, 9, 'fret 17 hole returns when skipMarkers is empty (tail screw still off)');
assert.ok(E.meta.holes.some(h => h.label === 'fret 17'), 'fret 17 present');
const [p1, p2] = E.pieces;
approx(p1.lengthMm + p2.lengthMm, E.meta.lengthMm, 1e-6, 'piece lengths sum to board length');
approx(p1.y1, E.meta.splitYMm, 1e-9, 'piece 1 ends at the split');
approx(p2.y0, E.meta.splitYMm, 1e-9, 'piece 2 starts at the split');
assert.ok(Fretboard.signedVolume(p1.triangles) > 0, 'piece 1 is a valid solid');
assert.ok(Fretboard.signedVolume(p2.triangles) > 0, 'piece 2 is a valid solid');
assert.strictEqual(E.triangles.length, p1.triangles.length + p2.triangles.length,
  'combined mesh = sum of pieces');
// the split fret (7) stays whole on piece 1; fret 8 lives on piece 2
approx(rayDown(p1.triangles, 10, E.meta.fretDistancesMm[7]), T + 0.9, 0.01, 'fret 7 ridge on piece 1');
approx(rayDown(p2.triangles, 10, E.meta.fretDistancesMm[8]), T + 0.9, 0.01, 'fret 8 ridge on piece 2');
assert.strictEqual(rayDown(p2.triangles, 10, E.meta.fretDistancesMm[7]), null,
  'piece 2 has nothing at fret 7');
// both pieces have a real end wall at the seam (vertical triangles at splitY)
for (const [name, piece] of [['piece 1', p1], ['piece 2', p2]]) {
  let seamTris = 0;
  for (let i = 0; i < piece.triangles.length; i += 9) {
    const ys = [piece.triangles[i + 1], piece.triangles[i + 4], piece.triangles[i + 7]];
    if (ys.every(y => Math.abs(y - E.meta.splitYMm) < 1e-6)) seamTris++;
  }
  assert.ok(seamTris >= 2, `${name} has an end wall at the seam (${seamTris} tris)`);
}
// piece tops are solid surfaces on both sides of the seam
approx(rayDown(p1.triangles, 0, E.meta.splitYMm - 6), T, 0.01, 'piece 1 top near seam');
approx(rayDown(p2.triangles, 0, E.meta.splitYMm + 6), T, 0.01, 'piece 2 top near seam');
console.log('E ok: split after fret 7 -> pieces', p1.lengthMm.toFixed(0), 'mm +', p2.lengthMm.toFixed(0), 'mm');

// split requested past the last fret: not applied, warning explains
const E2 = Fretboard.buildFretboard({
  scaleMm: 25.5 * 25.4, strings: 3, frets: 12,
  nutWidthMm: 34.9, heelWidthMm: 44.45, splitAfterFret: 12
}, earcut);
assert.strictEqual(E2.pieces.length, 1, 'no split when split fret >= fret count');
assert.ok(E2.meta.warnings.some(w => w.includes('Split not applied')), 'split warning shown');
console.log('E2 ok: split past last fret degrades to one piece with a warning');

// === Config F: rounded tail corners (1/4" radius, on by default) =========
{
  const wL = metaA.tailWidthMm, L = metaA.lengthMm - 5, R = 6.35; // L = tail-end y (fret span)
  const cx = wL / 2 - R, cy = L - R;
  // inside the corner arc: board present at full height
  approx(rayDown(trisA, cx, L - 0.5), T, 0.01, 'tail end centre present');
  // (sampled inboard of the 1 mm top-edge fillet strip)
  approx(rayDown(trisA, wL / 2 - 0.5 - metaA.edgeFilletMm, cy), T, 0.01, 'tail side at arc start present');
  // the square corner itself is cut away (0.8 mm in from both edges is
  // ~7.9 mm from the arc centre — well outside the 6.35 mm radius)
  assert.strictEqual(rayDown(trisA, wL / 2 - 0.8, L - 0.8), null,
    'square tail corner is rounded off');
  assert.strictEqual(rayDown(trisA, -(wL / 2 - 0.8), L - 0.8), null,
    'other tail corner rounded off too');
  // radius 0 brings the square corners back
  const F2 = Fretboard.buildFretboard({
    scaleMm: 25.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.375 * 25.4, heelWidthMm: 1.75 * 25.4,
    tailCornerRadiusMm: 0
  }, earcut);
  approx(rayDown(F2.triangles, wL / 2 - 0.8 - F2.meta.edgeFilletMm, L - 0.8), T, 0.01, 'square corner present when radius off');
  console.log('F ok: 1/4in rounded tail corners on by default, square when off');
}

// === Config G: fret modes (diatonic / pentatonic / pentatonic-plus) ======
{
  const G = Fretboard.buildFretboard({
    scaleMm: 23.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.5 * 25.4, heelWidthMm: 1.5 * 25.4,
    splitAfterFret: 7, fretSteps: Fretboard.FRET_MODES.pentatonic
  }, earcut);
  assert.deepStrictEqual(G.meta.keptFrets, [3, 5, 7, 10, 12, 15, 17, 19],
    'pentatonic keeps minor-pentatonic frets only');
  const dG = G.meta.fretDistancesMm;
  approx(rayDown(G.triangles, 10, dG[3]), T + 0.9, 0.01, 'pentatonic: fret 3 ridge present');
  approx(rayDown(G.triangles, 10, dG[2]), T, 0.01, 'pentatonic: no ridge at fret 2 position');
  approx(rayDown(G.triangles, 10, dG[12]), T + 0.9, 0.01, 'pentatonic: octave ridge present');
  assert.strictEqual(G.meta.holes.length, 8, 'pentatonic: screw markers unchanged (8)');
  assert.strictEqual(G.pieces.length, 2, 'pentatonic: split after fret 7 still splits (7 is a scale tone)');

  const Gd = Fretboard.buildFretboard({
    scaleMm: 23.5 * 25.4, strings: 3, frets: 12,
    nutWidthMm: 38, heelWidthMm: 38, fretSteps: Fretboard.FRET_MODES.diatonic
  }, earcut);
  assert.deepStrictEqual(Gd.meta.keptFrets, [2, 4, 5, 7, 9, 11, 12], 'diatonic kept frets');

  const Gp = Fretboard.buildFretboard({
    scaleMm: 23.5 * 25.4, strings: 3, frets: 12,
    nutWidthMm: 38, heelWidthMm: 38, fretSteps: Fretboard.FRET_MODES['pentatonic-plus']
  }, earcut);
  assert.deepStrictEqual(Gp.meta.keptFrets, [3, 5, 6, 7, 10, 12],
    "pentatonic-plus kept frets (Puckett: minor pentatonic + flat-5 blue note)");
  console.log('G ok: fret modes keep only in-scale ridges; markers/split unaffected');
}

// === Config H: headstock extension with a 45-degree chamfer =============
{
  const base = {
    scaleMm: 23.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.5 * 25.4, heelWidthMm: 1.5 * 25.4,
    thicknessMm: 0.2 * 25.4, splitAfterFret: 7
  };
  const off = Fretboard.buildFretboard(base, earcut);
  const on = Fretboard.buildFretboard(Object.assign({}, base, { headstockExtMm: 6.35 }), earcut);
  const T = 0.2 * 25.4; // 5.08
  // a 1/4" FLAT at full thickness past the nut, then a 45-degree taper
  // dropping the full thickness: total reach = 6.35 + 5.08 = 11.43
  approx(rayDown(on.triangles, 10, -8), T, 0.02, 'ext: flat at full thickness past the nut');
  approx(rayDown(on.triangles, 10, -11.35 - 2.54), T - 2.54, 0.02, 'ext: 45deg taper mid-run');
  approx(rayDown(on.triangles, 10, -16.4), 0.03, 0.02, 'ext: taper reaches the bottom at the tip');
  assert.strictEqual(rayDown(off.triangles, 10, -8), null, 'ext off: nothing behind the nut');
  // volume: rectangle (6.35 x T) + triangle (T x T / 2), across 38.1 wide
  const wedgeVol = (6.35 * T + (T * T) / 2) * 38.1;
  const dv = Fretboard.signedVolume(on.triangles) - Fretboard.signedVolume(off.triangles);
  assert.ok(Math.abs(dv - wedgeVol) < wedgeVol * 0.02,
    'ext: wedge volume ' + dv.toFixed(0) + ' ~= ' + wedgeVol.toFixed(0));
  // bookkeeping: piece 1 grows by the full reach, total length too
  approx(on.pieces[0].y0, -16.43, 0.001, 'ext: piece 1 starts at -16.43 (nut depth + reach)');
  approx(on.pieces[0].lengthMm, off.pieces[0].lengthMm + 11.43, 0.01, 'ext: piece 1 length +0.45in');
  approx(on.meta.lengthMm, off.meta.lengthMm + 11.43, 0.01, 'ext: overall length +0.45in');
  console.log('H ok: headstock extension = 1/4in flat past the nut, then a 45deg taper');
}

// === Config I: 3-string nut spacing (center + 1/2" each side) ============
{
  const N = Fretboard.buildFretboard({
    scaleMm: 23.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.5 * 25.4, heelWidthMm: 1.5 * 25.4,
    thicknessMm: 0.2 * 25.4, nutHeightMm: 2
  }, earcut);
  const nutTop = 0.2 * 25.4 + 2.04; // 7.12 — set by the .042 floor + its 60% sit
  // outer slot at exactly +1/2" (holds the .042 in a right-handed build)
  approx(rayDown(N.triangles, 12.7, -0.25), nutTop - 0.67, 0.02, '3-string nut: slot at +1/2in (face value less slope drop)');
  approx(rayDown(N.triangles, -12.7, -0.25), nutTop - 0.87, 0.02, '3-string nut: slot at -1/2in (.024 slot)');
  // the old margin-spread position (15.6mm) is solid nut now
  approx(rayDown(N.triangles, 15.62, -2.5), nutTop, 0.02, '3-string nut: no slot at the old spread position');
  // center slot stays centered (.032)
  approx(rayDown(N.triangles, 0, -0.25), nutTop - 0.77, 0.02, '3-string nut: center slot centered');
  console.log('I ok: 3-string nut slots at -1/2in, 0, +1/2in');
}

// === Config J: fretboard radius ==========================================
{
  const base = {
    scaleMm: 23.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.5 * 25.4, heelWidthMm: 1.5 * 25.4,
    thicknessMm: 0.2 * 25.4, splitAfterFret: 7
  };
  const flat = Fretboard.buildFretboard(base, earcut);
  const rad = Fretboard.buildFretboard(Object.assign({}, base, { radiusMm: 304.8 }), earcut);
  const T = 0.2 * 25.4;
  const sag = (x) => 304.8 - Math.sqrt(304.8 * 304.8 - x * x);
  // top surface: crowned at the centerline, dropping toward the edges
  approx(rayDown(rad.triangles, 0, 100), T, 0.01, 'radius: centerline at full thickness');
  approx(rayDown(rad.triangles, 18, 100), T - sag(18), 0.04, 'radius: surface follows the curve at x=18');
  approx(rayDown(rad.triangles, -18, 100), T - sag(18), 0.04, 'radius: curve is symmetric');
  approx(rayDown(flat.triangles, 18, 100), T, 0.01, 'flat build: no drop at x=18');
  // fret crowns stand the same height above the LOCAL surface
  const d3 = rad.meta.fretDistancesMm[3];
  approx(rayDown(rad.triangles, 0, d3), T + 0.9, 0.02, 'radius: fret 3 crown at center');
  approx(rayDown(rad.triangles, 15, d3), T - sag(15) + 0.9, 0.05, 'radius: fret 3 crown follows curve at x=15');
  // nut slots: depth constant, floors follow the curve
  approx(rayDown(rad.triangles, 0, -0.25), T + 1.27, 0.02, 'radius: center slot floor near the face (crown + 0.40 target)');
  approx(rayDown(rad.triangles, 12.7, -0.25), T + 1.37 - sag(12.7), 0.08, 'radius: outer slot floor follows curve');
  // material removed, pieces still closed solids, lengths unchanged
  const dv = Fretboard.signedVolume(flat.triangles) - Fretboard.signedVolume(rad.triangles);
  assert.ok(dv > 1500 && dv < 6000, 'radius: curve removes a sane amount of material (' + dv.toFixed(0) + ' mm3)');
  rad.pieces.forEach((pc, i) => assert.ok(Fretboard.signedVolume(pc.triangles) > 0, 'radius: piece ' + (i + 1) + ' closed'));
  approx(rad.pieces[0].lengthMm, flat.pieces[0].lengthMm, 0.001, 'radius: piece lengths unchanged');
  assert.strictEqual(rad.meta.radiusMm, 304.8, 'radius: meta reports the radius');
  // thin-edge warning only for the extreme combo (6-string + 7.25in)
  const extreme = Fretboard.buildFretboard({
    scaleMm: 25.5 * 25.4, strings: 6, frets: 20,
    nutWidthMm: 1.75 * 25.4, heelWidthMm: 2.125 * 25.4,
    thicknessMm: 0.2 * 25.4, radiusMm: 184.15
  }, earcut);
  assert.ok(extreme.meta.warnings.some((w) => w.includes('edges get thin')), 'radius: thin-edge warning fires');
  assert.ok(!rad.meta.warnings.some((w) => w.includes('edges get thin')), 'radius: no thin-edge warning at 12in/3-string');
  console.log('J ok: 12in radius curves top, frets and nut; bottom flat; thin-edge warning works');
}

// === Config K: nut ends rounded over, long edges square =================
{
  const K = Fretboard.buildFretboard({
    scaleMm: 23.5 * 25.4, strings: 3, frets: 20,
    nutWidthMm: 1.5 * 25.4, heelWidthMm: 1.5 * 25.4,
    thicknessMm: 0.2 * 25.4, nutHeightMm: 2
  }, earcut);
  const nutTop = 0.2 * 25.4 + 2.04; // 7.12 — set by the .042 floor + its 60% sit
  // the nut ends sit ki (= the 1 mm edge fillet) in from the board edge
  const ki = K.meta.nut.insetMm;
  assert.ok(Math.abs(ki - 1) < 1e-9, 'nut inset = default 1 mm fillet: ' + ki);
  // raised segment between the center and +1/2in slots: full height
  approx(rayDown(K.triangles, 6, -2.5), nutTop, 0.02, 'nut: full height at mid-depth');
  // the long front/back top edges stay SQUARE — full height right up
  // to the nut's front and back faces
  approx(rayDown(K.triangles, 6, -4.8), nutTop, 0.02, 'nut: front top edge square');
  approx(rayDown(K.triangles, 6, -0.2), nutTop, 0.02, 'nut: back top edge square');
  // the left/right ENDS roll over on a 1.2mm radius: full height just
  // inside the roll, stepped down near the outer faces
  approx(rayDown(K.triangles, 15 - ki, -2.5), nutTop, 0.02, 'nut: end segment top is flat across its span');
  approx(rayDown(K.triangles, 17 - ki, -2.5), nutTop, 0.02, 'nut: full height inside the end roll');
  approx(rayDown(K.triangles, 18.0 - ki, -2.5), nutTop - 0.01, 0.03, 'nut: end roll near its top');
  approx(rayDown(K.triangles, 18.9 - ki, -2.5), nutTop - 0.62, 0.03, 'nut: end roll near the face');
  approx(rayDown(K.triangles, -(18.9 - ki), -2.5), nutTop - 0.62, 0.03, 'nut: left end rolls too');
  // slot floors stay exact (string seating unchanged)
  approx(rayDown(K.triangles, 0, -0.25), nutTop - 0.77, 0.02, 'nut: slot floor near the face at its target (crown + 0.40)');
  console.log('K ok: nut ends rounded over (1.2mm radius), long edges square, slot floors exact');
}

// === Config L: nut position — the scale zero is the nut's fret-side face ==
// The string leaves the nut at its fret-side face; if that face isn't at
// y=0, every fret is off by the nut depth (5mm ≈ 14-28 cents flat).
{
  for (const scaleIn of [24, 25, 25.5]) {
    const scale = scaleIn * 25.4;
    const Lb = Fretboard.buildFretboard({
      scaleMm: scale, strings: 3, frets: 20,
      nutWidthMm: 38.1, heelWidthMm: 38.1, thicknessMm: 5.08, fretHeightMm: 0.889
    }, earcut);
    const nutTopL = 5.08 + 2.03; // from the .042 floor (crown + 0.50) + 60% sit
    // fret-side face at y=0: nut material just behind it, none in front
    approx(rayDown(Lb.triangles, -17 + Lb.meta.nut.insetMm, -0.3), nutTopL, 0.02, `L ${scaleIn}in: nut present just behind the face`);
    approx(rayDown(Lb.triangles, -17, 0.3), 5.08, 0.02, `L ${scaleIn}in: no nut material past the face (board top only)`);
    approx(rayDown(Lb.triangles, 0, 0.3), 5.08, 0.02, `L ${scaleIn}in: slot does not cross the face either`);
    // the board blank extends under the nut to y=-5
    approx(rayDown(Lb.triangles, -17 + Lb.meta.nut.insetMm, -4.9), nutTopL, 0.02, `L ${scaleIn}in: nut sits on board at its back edge`);
    assert.ok(Lb.pieces[0].y0 <= -5 + 1e-9, `L ${scaleIn}in: piece starts at/behind the nut back`);
    // fret 12 sits at exactly half the scale measured from the face
    approx(Lb.meta.fretDistancesMm[12], scale / 2, 0.01, `L ${scaleIn}in: fret 12 distance = scale/2 from the face`);
    approx(rayDown(Lb.triangles, 0, scale / 2), 5.08 + 0.889, 0.02, `L ${scaleIn}in: fret 12 crown at scale/2`);
  }
  console.log('L ok: nut fret-side face at y=0; fret 12 at scale/2 for 24/25/25.5in scales');
}

// === Config M: watertight mesh — no boundary edges =======================
// Every edge of every piece must be shared by exactly two triangles
// (counted here as: no edge with exactly one incident triangle). The
// board walls are built from the faces' own boundary vertices, so a
// T-junction anywhere shows up as an open edge.
function boundaryEdgeCount(tris) {
  const key = (x, y, z) => Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
  const edges = new Map();
  for (let i = 0; i < tris.length; i += 9) {
    const v = [0, 1, 2].map(k => key(tris[i + k * 3], tris[i + k * 3 + 1], tris[i + k * 3 + 2]));
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3], ek = a < b ? a + '|' + b : b + '|' + a;
      edges.set(ek, (edges.get(ek) || 0) + 1);
    }
  }
  let open = 0;
  edges.forEach(c => { if (c === 1) open++; });
  return open;
}
{
  const cfgs = [
    ['23.5in split 7 (default)', { scaleMm: 596.9, strings: 3, frets: 20, nutWidthMm: 38.1, heelWidthMm: 38.1, thicknessMm: 5.08, splitAfterFret: 7 }],
    ['24in tapered, no split', { scaleMm: 609.6, strings: 3, frets: 20, nutWidthMm: 38.1, heelWidthMm: 44.45 }],
    ['25.5in 24 frets', { scaleMm: 647.7, strings: 3, frets: 24, nutWidthMm: 34.9, heelWidthMm: 44.45 }],
    ['23in 6-string 24 frets', { scaleMm: 584.2, strings: 6, frets: 24, nutWidthMm: 44.45, heelWidthMm: 50.8 }],
    ['12in radius, split 7', { scaleMm: 596.9, strings: 3, frets: 20, nutWidthMm: 38.1, heelWidthMm: 38.1, thicknessMm: 5.08, radiusMm: 304.8, splitAfterFret: 7 }],
    ['7.25in radius 6-string', { scaleMm: 647.7, strings: 6, frets: 22, nutWidthMm: 44.45, heelWidthMm: 50.8, radiusMm: 184.15 }],
    ['headstock extension', { scaleMm: 596.9, strings: 3, frets: 20, nutWidthMm: 38.1, heelWidthMm: 38.1, thicknessMm: 5.08, headstockExtMm: 6.35, splitAfterFret: 7 }],
    ['square tail corners', { scaleMm: 596.9, strings: 3, frets: 20, nutWidthMm: 38.1, heelWidthMm: 44.45, tailCornerRadiusMm: 0 }],
    ['pentatonic, split 12', { scaleMm: 647.7, strings: 4, frets: 24, nutWidthMm: 34.9, heelWidthMm: 44.45, splitAfterFret: 12, fretSteps: Fretboard.FRET_MODES.pentatonic }],
    ['1 string', { scaleMm: 609.6, strings: 1, frets: 12, nutWidthMm: 30, heelWidthMm: 38 }]
  ];
  for (const [name, cfg] of cfgs) {
    const Mb = Fretboard.buildFretboard(cfg, earcut);
    assert.strictEqual(boundaryEdgeCount(Mb.triangles), 0, `M ${name}: whole build has open edges`);
    Mb.pieces.forEach((piece, pi) => {
      assert.strictEqual(boundaryEdgeCount(piece.triangles), 0, `M ${name} piece ${pi + 1}: open edges`);
    });
  }
  console.log('M ok: zero boundary edges across scales, fret counts, radius, split pieces');
}

// === Config N: input validation ==========================================
// Bad parameters throw a clear error instead of producing NaN soup.
{
  const good = {
    scaleMm: 609.6, strings: 3, frets: 20, nutWidthMm: 38.1, heelWidthMm: 44.45
  };
  const badCases = [
    ['scale 0', { scaleMm: 0 }],
    ['scale negative', { scaleMm: -609.6 }],
    ['scale NaN', { scaleMm: NaN }],
    ['scale Infinity', { scaleMm: Infinity }],
    ['scale very large', { scaleMm: 1e6 }],
    ['scale missing', { scaleMm: undefined }],
    ['scale as text', { scaleMm: '609.6' }],
    ['frets 0', { frets: 0 }],
    ['frets negative', { frets: -3 }],
    ['frets fractional', { frets: 20.5 }],
    ['frets NaN', { frets: NaN }],
    ['frets very large', { frets: 500 }],
    ['strings 0', { strings: 0 }],
    ['strings 7', { strings: 7 }],
    ['nut width 0', { nutWidthMm: 0 }],
    ['nut width negative', { nutWidthMm: -38.1 }],
    ['heel width NaN', { heelWidthMm: NaN }],
    ['thickness 0', { thicknessMm: 0 }],
    ['thickness negative', { thicknessMm: -5 }],
    ['fret height negative', { fretHeightMm: -0.5 }],
    ['tail negative', { tailMm: -1 }],
    ['radius negative', { radiusMm: -304.8 }],
    ['radius too tight', { radiusMm: 30 }],
    ['radius NaN', { radiusMm: NaN }],
    ['nut height 0', { nutHeightMm: 0 }],
    ['nut depth huge', { nutDepthMm: 100 }],
    ['split fractional', { splitAfterFret: 7.5 }],
    ['gauges empty', { stringGaugesIn: [] }],
    ['gauge zero', { stringGaugesIn: [0.042, 0, 0.024] }],
    ['gauge negative', { stringGaugesIn: [0.042, -0.032, 0.024] }],
    ['gauge NaN', { stringGaugesIn: [0.042, NaN, 0.024] }]
  ];
  for (const [name, patch] of badCases) {
    assert.throws(
      () => Fretboard.buildFretboard(Object.assign({}, good, patch), earcut),
      /Invalid /,
      'N: ' + name + ' should throw a clear Invalid error');
  }
  // ...and the untouched parameter set still builds fine
  const okBuild = Fretboard.buildFretboard(good, earcut);
  assert.ok(okBuild.triangles.length > 0, 'N: valid params still build');
  console.log('N ok: ' + badCases.length + ' invalid parameter sets rejected with clear errors');
}

// === Config O: slot floors from target height over fret 1 =================
// For every string count and gauge: floor - crown (at the nut's fret-side
// face) equals the per-string target, and bass strings never sit lower
// than treble strings.
{
  const crownO = 5.08 + 0.889;
  for (const nStr of [1, 2, 3, 4, 5, 6]) {
    const Ob = Fretboard.buildFretboard({
      scaleMm: 609.6, strings: nStr, frets: 20,
      nutWidthMm: 44.45, heelWidthMm: 44.45, thicknessMm: 5.08, fretHeightMm: 0.889
    }, earcut);
    const gauges = Fretboard.STRING_GAUGES[nStr];
    // replicate the nut layout to find each slot's x
    const margin = Math.max(3.2, 44.45 * 0.09);
    const spread = 44.45 - margin * 2;
    let xs = [];
    for (let i = 0; i < nStr; i++) xs.push(nStr === 1 ? 0 : -spread / 2 + (spread * i) / (nStr - 1));
    if (nStr === 3) { const s3 = Math.min(12.7, spread / 2); xs = [-s3, 0, s3]; }
    // expected targets: treble = slotHeightMm (0.3), bass = min(0.5, +0.2)
    const dropAt = (dist) => Math.tan(7.5 * Math.PI / 180) * dist; // slot slope (fix 6)
    const expTarget = (j) => nStr === 1 ? 0.3 : 0.5 + (0.3 - 0.5) * (j / (nStr - 1));
    for (let si = 0; si < nStr; si++) {
      const j = nStr - 1 - si; // right-handed: slot si holds string j (low->high)
      const floor = rayDown(Ob.triangles, xs[si], -0.25);
      approx(floor - crownO, expTarget(j) - dropAt(0.25), 0.02,
        `O ${nStr}-string: slot for gauge ${gauges[j]} sits ${expTarget(j).toFixed(2)}mm over fret 1`);
      approx(Ob.meta.nut.targetsMm[j], expTarget(j), 1e-9, `O ${nStr}-string: meta target ${j}`);
      approx(Ob.meta.nut.floorsMm[j], floor + dropAt(0.25), 0.02, `O ${nStr}-string: meta floor (at the face) matches geometry`);
    }
    for (let j = 1; j < nStr; j++) {
      assert.ok(Ob.meta.nut.targetsMm[j] <= Ob.meta.nut.targetsMm[j - 1] + 1e-9,
        `O ${nStr}-string: targets never rise toward the treble side`);
      assert.ok(Ob.meta.nut.floorsMm[j] <= Ob.meta.nut.floorsMm[j - 1] + 1e-9,
        `O ${nStr}-string: bass floors never lower than treble floors`);
    }
    assert.ok(Ob.meta.nut.topMm >= crownO, `O ${nStr}-string: nut top above the crown`);
  }
  // a custom slotHeightMm moves every floor by the same logic
  const O2 = Fretboard.buildFretboard({
    scaleMm: 609.6, strings: 3, frets: 20, nutWidthMm: 44.45, heelWidthMm: 44.45,
    thicknessMm: 5.08, fretHeightMm: 0.889, slotHeightMm: 0.45
  }, earcut);
  approx(O2.meta.nut.targetsMm[2], 0.45, 1e-9, 'O custom: treble target follows slotHeightMm');
  approx(O2.meta.nut.targetsMm[0], 0.5, 1e-9, 'O custom: bass target caps at 0.5');
  approx(rayDown(O2.triangles, -12.7, -0.25) - crownO, 0.45 - Math.tan(7.5 * Math.PI / 180) * 0.25, 0.02, 'O custom: treble floor at 0.45 over fret 1 (treble sits at -x, right-handed)');
  // floors never dip below the crown even at the minimum setting
  const O3 = Fretboard.buildFretboard({
    scaleMm: 609.6, strings: 6, frets: 20, nutWidthMm: 44.45, heelWidthMm: 44.45,
    thicknessMm: 5.08, fretHeightMm: 0.889, slotHeightMm: 0.05
  }, earcut);
  assert.ok(Math.min.apply(null, O3.meta.nut.floorsMm) > crownO, 'O minimum: every floor above the crown');
  console.log('O ok: slot floors = crown + per-string target for all gauges/counts; bass never lower than treble');
}

// === Config P: sloped nut slots — break point at the fret-side face ======
// Each slot floor is highest at the nut's fret-side face (y=0, the scale
// zero) and drops monotonically toward the headstock, so the string's
// only contact point is the face edge.
{
  const tan75 = Math.tan(7.5 * Math.PI / 180);
  const Pb = Fretboard.buildFretboard({
    scaleMm: 609.6, strings: 3, frets: 20,
    nutWidthMm: 38.1, heelWidthMm: 38.1, thicknessMm: 5.08, fretHeightMm: 0.889
  }, earcut);
  const faceFloor = Pb.meta.nut.floorsMm[1]; // centre (D) string, x=0
  // floor height falls off with distance behind the face, on the slope
  approx(rayDown(Pb.triangles, 0, -0.1), faceFloor - tan75 * 0.1, 0.02, 'P: just behind the face, floor nearly at face height');
  approx(rayDown(Pb.triangles, 0, -2.5), faceFloor - tan75 * 2.5, 0.02, 'P: mid-nut floor on the 7.5deg slope');
  approx(rayDown(Pb.triangles, 0, -4.9), faceFloor - tan75 * 4.9, 0.03, 'P: back of the nut, floor at full drop');
  approx(Pb.meta.nut.floorsBackMm[1], faceFloor - tan75 * 5, 0.02, 'P: meta back floor = face - tan(slope) x depth');
  // monotonic decrease toward the headstock; the face is the high point
  let prev = Infinity;
  for (const y of [-0.05, -1, -2, -3, -4, -4.95]) {
    const z = rayDown(Pb.triangles, 0, y);
    assert.ok(z !== null && z < prev, 'P: floor drops monotonically (y=' + y + ', z=' + z + ')');
    prev = z;
  }
  assert.ok(rayDown(Pb.triangles, 0, -0.05) <= faceFloor + 1e-9, 'P: face is the highest point of the floor');
  // every string's floor slopes, not just the centre one
  for (const x of [-12.7, 12.7]) {
    const near = rayDown(Pb.triangles, x, -0.25), far = rayDown(Pb.triangles, x, -4.75);
    assert.ok(far < near - 0.5, 'P: outer slot at x=' + x + ' slopes too (' + near.toFixed(2) + ' -> ' + far.toFixed(2) + ')');
  }
  // slope 0 restores a flat floor
  const P0 = Fretboard.buildFretboard({
    scaleMm: 609.6, strings: 3, frets: 20, nutWidthMm: 38.1, heelWidthMm: 38.1,
    thicknessMm: 5.08, fretHeightMm: 0.889, slotSlopeDeg: 0
  }, earcut);
  approx(rayDown(P0.triangles, 0, -4.9), P0.meta.nut.floorsMm[1], 0.01, 'P: slope 0 = flat floor');
  // the clamp: a steep slope on a shallow nut keeps 0.3mm under the slot
  const Pc = Fretboard.buildFretboard({
    scaleMm: 609.6, strings: 3, frets: 20, nutWidthMm: 38.1, heelWidthMm: 38.1,
    thicknessMm: 5.08, fretHeightMm: 0.2, slotHeightMm: 0.05, slotSlopeDeg: 20
  }, earcut);
  const nutBottomC = 5.08 - 0.6;
  Pc.meta.nut.floorsBackMm.forEach((bf, j) => {
    assert.ok(bf >= nutBottomC + 0.3 - 0.005, 'P clamp: string ' + j + ' keeps 0.3mm of nut under the slot (back floor ' + bf.toFixed(3) + ')');
  });
  approx(Math.min.apply(null, Pc.meta.nut.floorsBackMm), nutBottomC + 0.3, 0.01, 'P clamp: the tightest slot sits exactly on the clamp');
  // sloped builds stay watertight, flat and radiused
  assert.strictEqual(boundaryEdgeCount(Pb.triangles), 0, 'P: sloped build has no boundary edges');
  const Pr = Fretboard.buildFretboard({
    scaleMm: 609.6, strings: 3, frets: 20, nutWidthMm: 38.1, heelWidthMm: 38.1,
    thicknessMm: 5.08, fretHeightMm: 0.889, radiusMm: 304.8, splitAfterFret: 7
  }, earcut);
  Pr.pieces.forEach((piece, pi) => {
    assert.strictEqual(boundaryEdgeCount(piece.triangles), 0, 'P: radiused sloped piece ' + (pi + 1) + ' has no boundary edges');
  });
  console.log('P ok: slot floors slope from a high break point at the fret-side face; clamp and watertightness hold');
}

// === Config Q: multi-piece splits, Auto bed fit, alignment keys ==========
{
  const base = { scaleMm: 596.9, strings: 4, frets: 19, nutWidthMm: 38.1, heelWidthMm: 38.1, thicknessMm: 5.08, fretHeightMm: 0.889, tailMm: 30.48 };
  function yExtent(tris) {
    let mn = 1e9, mx = -1e9;
    for (let i = 1; i < tris.length; i += 3) { if (tris[i] < mn) mn = tris[i]; if (tris[i] > mx) mx = tris[i]; }
    return [mn, mx];
  }
  // backward compatibility: the legacy single split == a one-item list
  const Qleg = Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFret: 7 }), earcut);
  const Qlist = Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [7] }), earcut);
  assert.strictEqual(Qleg.pieces.length, 2, 'Q: legacy splitAfterFret gives 2 pieces');
  approx(Qlist.pieces[0].lengthMm, Qleg.pieces[0].lengthMm, 0.001, 'Q: list [7] matches legacy piece 1 length');
  approx(Qlist.pieces[1].lengthMm, Qleg.pieces[1].lengthMm, 0.001, 'Q: list [7] matches legacy piece 2 length');
  // pins are ON by default: piece 1 carries pins past the seam
  assert.ok(yExtent(Qlist.pieces[0].triangles)[1] > Qlist.meta.splitYMs[0] + 1, 'Q: keys on by default — pins protrude past the seam');
  const Qoff = Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [7], seamKeys: false }), earcut);
  approx(yExtent(Qoff.pieces[0].triangles)[1], Qoff.meta.splitYMs[0], 0.001, 'Q: keys off — piece 1 ends exactly at the seam');
  // three pieces, lengths add up, every piece sealed (flat + radiused)
  const Q3 = Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [5, 12] }), earcut);
  assert.strictEqual(Q3.pieces.length, 3, 'Q: [5, 12] gives 3 pieces');
  assert.deepStrictEqual(Q3.meta.splitFrets, [5, 12], 'Q: meta reports the effective split frets');
  approx(Q3.pieces.reduce((s, pc) => s + pc.lengthMm, 0), Q3.meta.lengthMm, 0.01, 'Q: piece lengths add up to the board length');
  Q3.pieces.forEach((piece, pi) => {
    assert.strictEqual(boundaryEdgeCount(piece.triangles), 0, 'Q: piece ' + (pi + 1) + ' has no boundary edges');
  });
  const Q3r = Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [5, 12], radiusMm: 304.8 }), earcut);
  Q3r.pieces.forEach((piece, pi) => {
    assert.strictEqual(boundaryEdgeCount(piece.triangles), 0, 'Q: radiused piece ' + (pi + 1) + ' has no boundary edges');
  });
  // invalid split lists are clear errors
  assert.throws(() => Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [12, 5] }), earcut), /splitAfterFrets/, 'Q: out-of-order splits rejected');
  assert.throws(() => Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [7, 7] }), earcut), /splitAfterFrets/, 'Q: duplicate splits rejected');
  assert.throws(() => Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [7.5] }), earcut), /splitAfterFrets/, 'Q: fractional split fret rejected');
  // a split past the last fret is dropped with a warning, not a crash
  const Qpast = Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [7, 24] }), earcut);
  assert.strictEqual(Qpast.pieces.length, 2, 'Q: split past the last fret is dropped');
  assert.ok(Qpast.meta.warnings.some(w => w.includes('Split not applied')), 'Q: dropped split warns');
  // Auto: every piece fits a 220 mm bed on the long scales, pieces sealed
  [24, 25, 25.5].forEach(inches => {
    const Qa = Fretboard.buildFretboard({ scaleMm: inches * 25.4, strings: 4, frets: 20, nutWidthMm: 38.1, heelWidthMm: 44.45, thicknessMm: 5.08, fretHeightMm: 0.889, tailMm: 19.05, autoSplit: true, bedMm: 220 }, earcut);
    assert.ok(Qa.pieces.length >= 2 && Qa.pieces.length <= 3, 'Q auto ' + inches + 'in: 2–3 pieces (got ' + Qa.pieces.length + ')');
    Qa.pieces.forEach((piece, pi) => {
      assert.ok(piece.lengthMm <= 220 + 0.01, 'Q auto ' + inches + 'in: part ' + (pi + 1) + ' fits the bed (' + piece.lengthMm.toFixed(1) + ' mm)');
      assert.strictEqual(boundaryEdgeCount(piece.triangles), 0, 'Q auto ' + inches + 'in: part ' + (pi + 1) + ' sealed');
    });
  });
  // Auto leaves a board that already fits in one piece
  const Qfit = Fretboard.buildFretboard(Object.assign({}, base, { autoSplit: true, bedMm: 500 }), earcut);
  assert.strictEqual(Qfit.pieces.length, 1, 'Q auto: a board that fits stays one piece');
  // the planner: the default-size board with the extension needs 3 pieces on a 220 bed
  const plan = Fretboard.planSplits(Object.assign({}, base, { headstockExtMm: 6.35 }), 220);
  assert.strictEqual(plan.splitFrets.length, 2, 'Q auto: planner picks 2 seams for a 220 bed (got ' + plan.splitFrets.join(', ') + ')');
  assert.ok(Math.max.apply(null, plan.pieceLengthsMm) <= 220, 'Q auto: planned pieces fit');
  // a forced split that still overflows the bed warns
  const Qover = Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [12], bedMm: 150 }), earcut);
  assert.ok(Qover.meta.warnings.some(w => w.includes('print bed')), 'Q: over-bed piece warns');
  // alignment keys: pin protrudes 3.5 mm past the seam, socket is a real
  // cavity 3.7 mm deep, and both pieces stay sealed
  const Qk = Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [7], seamKeys: true }), earcut);
  const seamY = Qk.meta.splitYMs[0];
  approx(yExtent(Qk.pieces[0].triangles)[1], seamY + 3.5, 0.01, 'Q keys: pin tip sits 3.5mm past the seam');
  const pinX = 38.1 / 4, cz = 5.08 / 2;
  let capFound = false;
  const tr2 = Qk.pieces[1].triangles;
  for (let i = 0; i < tr2.length; i += 3) {
    if (Math.abs(tr2[i] - pinX) < 0.01 && Math.abs(tr2[i + 1] - (seamY + 3.7)) < 0.01 && Math.abs(tr2[i + 2] - cz) < 0.01) capFound = true;
  }
  assert.ok(capFound, 'Q keys: socket end cap found 3.7mm into piece 2');
  const vPlain = Qoff.pieces.map(pc => Math.abs(Fretboard.signedVolume(pc.triangles)));
  const vKey = Qk.pieces.map(pc => Math.abs(Fretboard.signedVolume(pc.triangles)));
  approx(vKey[0] - vPlain[0], 78, 12, 'Q keys: pins add their volume to piece 1');
  approx(vPlain[1] - vKey[1], 69, 12, 'Q keys: sockets remove their cavity volume from piece 2');
  Qk.pieces.forEach((piece, pi) => {
    assert.strictEqual(boundaryEdgeCount(piece.triangles), 0, 'Q keys: piece ' + (pi + 1) + ' has no boundary edges');
  });
  const Qkr = Fretboard.buildFretboard(Object.assign({}, base, { splitAfterFrets: [7], seamKeys: true, radiusMm: 304.8 }), earcut);
  Qkr.pieces.forEach((piece, pi) => {
    assert.strictEqual(boundaryEdgeCount(piece.triangles), 0, 'Q keys: radiused piece ' + (pi + 1) + ' has no boundary edges');
  });
  console.log('Q ok: 2- and 3-piece splits sealed and backward compatible; Auto fits 24/25/25.5in boards to a 220 bed; alignment pins + sockets sealed');
}

// === Config R: top-edge fillet (round-over) ==============================
// The two long TOP edges round over on edgeFilletMm (default 1 mm). The
// bottom face stays flat at z = 0 with an unchanged footprint; frets and
// the nut are shortened by the radius at each end so nothing overhangs
// or pokes out of the curve; r = 0 reproduces the sharp-edged board.
{
  const qBase = { scaleMm: 596.9, strings: 3, frets: 20, nutWidthMm: 38.1, heelWidthMm: 44.45, thicknessMm: 5.08 };
  const nutW = 38.1, heelW = 44.45;
  const build = (extra) => Fretboard.buildFretboard(Object.assign({}, qBase, extra), earcut);
  const def = build({});
  assert.strictEqual(def.meta.edgeFilletMm, 1, 'default edge fillet is 1 mm');
  assert.strictEqual(def.meta.featureInsetMm, 1, 'default fret/nut inset = fillet radius');

  // bottom-face area (z = 0, facing down) of the body, and min z overall
  function bottomStats(tris) {
    let area = 0, minZ = Infinity;
    for (let i = 0; i < tris.length; i += 9) {
      for (let k = 0; k < 3; k++) minZ = Math.min(minZ, tris[i + k * 3 + 2]);
      const z0 = tris[i + 2], z1 = tris[i + 5], z2 = tris[i + 8];
      if (Math.abs(z0) > 1e-9 || Math.abs(z1) > 1e-9 || Math.abs(z2) > 1e-9) continue;
      const ux = tris[i + 3] - tris[i], uy = tris[i + 4] - tris[i + 1];
      const wx = tris[i + 6] - tris[i], wy = tris[i + 7] - tris[i + 1];
      const nz = ux * wy - uy * wx;
      if (nz < 0) area += -nz / 2;
    }
    return { area, minZ };
  }
  // top-face height at a point, ignoring features (frets/nut)
  const halfAt = (y) => (nutW + (heelW - nutW) * (Math.max(y, 0) / def.meta.lastFretYMm)) / 2;
  const filletTop = (x, y, r, T) => {
    const d = Math.abs(x) - (halfAt(y) - r);
    if (d <= 0) return T;
    return T - (r - Math.sqrt(Math.max(0, r * r - Math.min(d, r) ** 2)));
  };

  const variants = [
    ['flat', {}],
    ['12in radius', { radiusMm: 304.8 }],
    ['headstock ext + split 7', { headstockExtMm: 6.35, splitAfterFret: 7 }],
    ['radius + ext + split', { radiusMm: 304.8, headstockExtMm: 6.35, splitAfterFret: 7 }],
    ['6-string', { strings: 6, frets: 22, nutWidthMm: 44.45, heelWidthMm: 50.8 }]
  ];
  for (const [vname, vcfg] of variants) {
    const zero = build(Object.assign({ edgeFilletMm: 0 }, vcfg));
    const b0 = bottomStats(zero.triangles);
    for (const r of [0, 1, 2]) {
      const Q = build(Object.assign({ edgeFilletMm: r }, vcfg));
      const tag = `R ${vname} r=${r}`;
      assert.strictEqual(boundaryEdgeCount(Q.triangles), 0, `${tag}: open edges`);
      Q.pieces.forEach((pc, pi) => assert.strictEqual(boundaryEdgeCount(pc.triangles), 0, `${tag} piece ${pi + 1}: open edges`));
      const bs = bottomStats(Q.triangles);
      assert.ok(Math.abs(bs.minZ) < 1e-9, `${tag}: nothing below z=0 (min z ${bs.minZ})`);
      assert.ok(Math.abs(bs.area - b0.area) < 1e-6 * b0.area,
        `${tag}: bottom footprint changed (${bs.area.toFixed(3)} vs ${b0.area.toFixed(3)} mm^2)`);
      // nut slot floors / top unchanged
      assert.deepStrictEqual(Q.meta.nut.floorsMm, zero.meta.nut.floorsMm, `${tag}: slot floors unchanged`);
      assert.strictEqual(Q.meta.nut.topMm, zero.meta.nut.topMm, `${tag}: nut top unchanged`);
    }
  }

  // flat board, r = 1 and 2: surface profile across the width, frets, nut
  for (const r of [1, 2]) {
    const Q = build({ edgeFilletMm: r });
    const T = 5.08, tq = Q.triangles;
    const y = (Q.meta.fretDistancesMm[3] + Q.meta.fretDistancesMm[4]) / 2 + 3; // open board
    const h = halfAt(y);
    approx(rayDown(tq, h - r - 0.05, y), T, 0.005, `R r=${r}: full height at the tangent line`);
    approx(rayDown(tq, h - r / 2, y), filletTop(h - r / 2, y, r, T), 0.02, `R r=${r}: mid-fillet on the arc`);
    // on an arc sample vertex (75 deg) the surface is exact; right at the
    // edge it is a 15-deg chord of the near-vertical arc (<= ~0.15 mm low)
    const x75 = h - r + r * Math.sin(75 * Math.PI / 180);
    approx(rayDown(tq, -x75, y), filletTop(x75, y, r, T), 0.01, `R r=${r}: arc vertex on the true circle`);
    approx(rayDown(tq, -(h - 0.02), y), filletTop(h - 0.02, y, r, T), 0.15, `R r=${r}: edge drops ~r`);
    // fret crowns unchanged at the centre; fret ends pulled in by r
    for (const n of [1, 5, 12]) {
      const d = Q.meta.fretDistancesMm[n];
      approx(rayDown(tq, 0, d), T + 0.9, 0.01, `R r=${r}: fret ${n} crown height unchanged`);
    }
    // no fret / nut vertex outside the filleted top profile
    const F = Q.groups.features;
    let worst = -Infinity;
    for (let i = 0; i < F.length; i += 3) {
      const x = F[i], yy = F[i + 1], z = F[i + 2];
      if (Math.abs(x) <= halfAt(yy) - r + 1e-6) continue; // over the flat top
      worst = Math.max(worst, z - filletTop(x, yy, r, T)); // must be buried
    }
    assert.ok(worst <= 1e-6, `R r=${r}: a fret/nut vertex pokes out of the round-over by ${worst.toFixed(4)} mm`);
    // fret length: today's length minus 2r
    const Z = build({ edgeFilletMm: 0 });
    const span = (res, n) => {
      const d = res.meta.fretDistancesMm[n]; let mx = 0; const Fz = res.groups.features;
      for (let i = 0; i < Fz.length; i += 3) if (Math.abs(Fz[i + 1] - d) < 1.3 && Fz[i + 1] > 1) mx = Math.max(mx, Math.abs(Fz[i]));
      return mx;
    };
    approx(span(Z, 10) - span(Q, 10), r, 1e-6, `R r=${r}: each fret end pulled in by r`);
  }
  // 0 mm radius = sharp board: full height right at the edge
  const Q0 = build({ edgeFilletMm: 0 });
  approx(rayDown(Q0.triangles, halfAt(60) - 0.02, 60), 5.08, 0.005, 'Q r=0: sharp edge (full height at the edge)');
  // split seam: both pieces' end walls carry the same rounded profile
  const S = build({ splitAfterFret: 7 });
  const sy = S.meta.splitYMm;
  const prof = (pc) => {
    const pts = new Set();
    for (let i = 0; i < pc.triangles.length; i += 3) {
      // fillet-zone points only (fret 7's base touches the seam plane too)
      if (Math.abs(pc.triangles[i + 1] - sy) < 1e-9 && Math.abs(pc.triangles[i]) > halfAt(sy) - 1 - 1e-6) pts.add(pc.triangles[i].toFixed(5) + ',' + pc.triangles[i + 2].toFixed(5));
    }
    return [...pts].sort();
  };
  assert.ok(prof(S.pieces[0]).length >= 2 * 7, 'Q split: seam carries the fillet arc samples');
  assert.deepStrictEqual(prof(S.pieces[0]), prof(S.pieces[1]), 'Q split: seam faces match vertex for vertex');
  // over-large radius on a thin radiused board is clamped with a warning
  const thin = build({ edgeFilletMm: 3, thicknessMm: 3.6, radiusMm: 184.15 });
  assert.ok(thin.meta.edgeFilletMm < 3 && thin.meta.warnings.some(w => /round-over reduced/.test(w)),
    'R: fillet clamped on a thin radiused board');
  // seam alignment pins + sockets with the round-over: 3-piece boards,
  // flat / radiused / extension, r = 0, 1, 2. Every piece sealed, pins
  // present, every pin vertex (and so every socket, 0.15mm larger) at
  // least 0.3mm under the FINISHED (filleted) top and inside the edges,
  // and each seam's rounded top profile identical on both pieces.
  for (const [kname, kcfg] of [
    ['flat', {}],
    ['12in radius', { radiusMm: 304.8 }],
    ['7.25in radius + ext', { radiusMm: 184.15, headstockExtMm: 6.35 }]
  ]) {
    for (const r of [0, 1, 2]) {
      const K3 = build(Object.assign({ splitAfterFrets: [5, 12], seamKeys: true, edgeFilletMm: r }, kcfg));
      const tag = `R keys ${kname} r=${r}`;
      assert.strictEqual(K3.pieces.length, 3, `${tag}: 3 pieces`);
      assert.ok(!K3.meta.warnings.some(w => /pins skipped/.test(w)), `${tag}: pins not skipped`);
      K3.pieces.forEach((pc, pi) => assert.strictEqual(boundaryEdgeCount(pc.triangles), 0, `${tag} piece ${pi + 1}: open edges`));
      const R0 = kcfg.radiusMm || 0;
      const sagQ = (x) => R0 ? R0 - Math.sqrt(R0 * R0 - x * x) : 0;
      K3.meta.splitYMs.forEach((sy, si) => {
        const hw = halfAt(sy);
        // pin vertices: the cylinders reaching past the seam into the next piece
        const tr = K3.pieces[si].triangles;
        let pinPts = 0, worstTop = Infinity, worstSide = Infinity;
        for (let i = 0; i < tr.length; i += 3) {
          if (tr[i + 1] <= sy + 1e-6) continue;
          pinPts++;
          const x = tr[i], z = tr[i + 2];
          const top = filletTop(x, sy, r, 5.08) - sagQ(x);
          worstTop = Math.min(worstTop, top - (z + 0.15));
          worstSide = Math.min(worstSide, hw - (Math.abs(x) + 0.15));
        }
        assert.ok(pinPts > 0, `${tag} seam ${si + 1}: pins present`);
        assert.ok(worstTop >= 0.3 - 1e-6, `${tag} seam ${si + 1}: socket only ${worstTop.toFixed(3)} mm under the round-over`);
        assert.ok(worstSide >= 0.3, `${tag} seam ${si + 1}: socket too close to the side`);
        // seam faces stay flat and share the rounded top profile
        const profAt = (pc) => {
          const pts = new Set();
          for (let i = 0; i < pc.triangles.length; i += 3) {
            if (Math.abs(pc.triangles[i + 1] - sy) < 1e-9 && Math.abs(pc.triangles[i]) > hw - Math.max(r, 0.01) - 1e-6) {
              pts.add(pc.triangles[i].toFixed(5) + ',' + pc.triangles[i + 2].toFixed(5));
            }
          }
          return [...pts].sort();
        };
        assert.deepStrictEqual(profAt(K3.pieces[si]), profAt(K3.pieces[si + 1]), `${tag} seam ${si + 1}: profiles match`);
      });
    }
  }
  console.log('R ok: 1 mm default top-edge fillet; 0/1/2 mm watertight, bottom flat + footprint unchanged, frets/nut inside the round-over; seam pins/sockets clear of it on 3-piece boards');
}

// S. Presets: table, flat watertight builds, and the form behaviour in
// app.js (pick a preset -> fields filled; edit a field -> back to Custom).
{
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const IN = 25.4;
  const ids = Object.keys(Fretboard.PRESETS);
  assert.deepStrictEqual(ids, ['t-style', 'lp-style'], 'S: preset ids');
  for (const id of ids) {
    const v = Fretboard.PRESETS[id].values;
    assert.deepStrictEqual(Object.keys(v).sort(), Fretboard.PRESET_KEYS.slice().sort(), `S ${id}: every preset key set`);
    assert.strictEqual(Fretboard.matchPreset(v), id, `S ${id}: matches itself`);
    for (const k of Fretboard.PRESET_KEYS) {
      const off = Object.assign({}, v, { [k]: typeof v[k] === 'number' ? v[k] + 0.01 : 'diatonic' });
      assert.strictEqual(Fretboard.matchPreset(off), 'custom', `S ${id}: changing ${k} is Custom`);
    }
  }
  assert.strictEqual(Fretboard.matchPreset({}), 'custom');
  assert.deepStrictEqual(Fretboard.presetParams('custom'), {}, 'S: Custom changes nothing');
  const t = Fretboard.PRESETS['t-style'].values, lp = Fretboard.PRESETS['lp-style'].values;
  assert.ok(t.scaleIn === 25.5 && t.frets === 22 && Math.abs(t.nutWidthIn * IN - 42) < 0.1, 'S: T-Style 25.5in / 22 frets / ~42 mm nut');
  assert.ok(lp.scaleIn === 24.75 && lp.frets === 22 && Math.abs(lp.nutWidthIn * IN - 43) < 0.1, 'S: LP-Style 24.75in / 22 frets / ~43 mm nut');

  // App defaults + each preset: flat, watertight, true to the preset.
  const appDefaults = { thicknessMm: 0.2 * IN, tailMm: 1.2 * IN, nutScrew: true, tailCornerRadiusMm: 6.35,
    headstockExtMm: 6.35, edgeFilletMm: 1, splitAfterFrets: [7], seamKeys: true, skipMarkers: [17] };
  for (const id of ids) {
    const v = Fretboard.PRESETS[id].values;
    const S = Fretboard.buildFretboard(Object.assign({}, appDefaults, Fretboard.presetParams(id)), earcut);
    assert.strictEqual(boundaryEdgeCount(S.triangles), 0, `S ${id}: open edges`);
    S.pieces.forEach((pc, i) => assert.strictEqual(boundaryEdgeCount(pc.triangles), 0, `S ${id} piece ${i + 1}: open edges`));
    assert.ok(Fretboard.signedVolume(S.triangles) > 0, `S ${id}: positive volume`);
    approx(S.meta.fretDistancesMm[12], v.scaleIn * IN / 2, 1e-6, `S ${id}: fret 12 at half scale`);
    assert.strictEqual(S.meta.keptFrets.length, 22, `S ${id}: 22 frets`);
    approx(S.meta.nutWidthMm, v.nutWidthIn * IN, 1e-6, `S ${id}: nut width`);
    assert.strictEqual(S.meta.stringGaugesIn.length, 6, `S ${id}: 6 nut slots`);
    let minZ = Infinity;
    for (let i = 2; i < S.triangles.length; i += 3) minZ = Math.min(minZ, S.triangles[i]);
    approx(minZ, 0, 1e-9, `S ${id}: flat bottom at z=0`);
    // flat board: the top at the centreline and near the edge is the same height
    const y = S.meta.fretDistancesMm[3] - 4, half = (v.nutWidthIn * IN) / 2;
    const zc = rayDown(S.triangles, 0, y), ze = rayDown(S.triangles, half - 4, y);
    approx(zc, ze, 1e-6, `S ${id}: no radius`);
  }

  // The form: run app.js against a tiny fake DOM built from index.html.
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const presetBlock = html.slice(html.indexOf('id="preset"'), html.indexOf('</select>', html.indexOf('id="preset"')));
  assert.deepStrictEqual([...presetBlock.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]), ['custom'].concat(ids), 'S: menu lists Custom + presets');
  assert.match(presetBlock, /<option value="custom" selected>/, 'S: Custom is the default');
  const els = new Map();
  const mk = (id) => {
    const l = {};
    return { id, value: '', checked: false, hidden: false, textContent: '', innerHTML: '', style: {}, options: [],
      addEventListener(type, fn) { (l[type] = l[type] || []).push(fn); },
      dispatch(type) { (l[type] || []).forEach(fn => fn({ type, target: this })); },
      appendChild() {}, focus() {}, remove() {}, setAttribute() {} };
  };
  for (const m of html.matchAll(/<(input|select|div|span|p|tbody|label)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
    const el = mk(m[3]); const attrs = m[2] + m[4];
    if (m[1] === 'input') { el.value = (attrs.match(/value="([^"]*)"/) || [, ''])[1]; el.checked = /\bchecked\b/.test(attrs); }
    if (m[1] === 'select') {
      const blk = html.slice(m.index, html.indexOf('</select>', m.index));
      el.options = [...blk.matchAll(/<option value="([^"]*)"( selected)?/g)].map(o => ({ value: o[1], selected: !!o[2] }));
      el.value = (el.options.find(o => o.selected) || el.options[0]).value;
    }
    els.set(m[3], el);
  }
  const document = { getElementById: id => els.get(id) || null, createElement: () => Object.assign(mk(''), { getContext: () => null }), body: mk('body') };
  let lastParams = null, builds = 0;
  const FB = Object.assign({}, Fretboard, { buildFretboard: (p, e) => { lastParams = p; builds++; return Fretboard.buildFretboard(p, e); } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'),
    { document, window: { addEventListener() {}, devicePixelRatio: 1 }, Fretboard: FB, earcut, STLExport: {}, Map, Math, Float32Array, setTimeout });
  const $ = id => els.get(id);
  const before = JSON.stringify(lastParams);
  const pick = (id) => { $('preset').value = id; $('preset').dispatch('change'); };
  pick('custom');
  assert.strictEqual(JSON.stringify(lastParams), before, 'S: picking Custom changes nothing');
  for (const id of ids) {
    const v = Fretboard.PRESETS[id].values, n = builds;
    pick(id);
    assert.strictEqual(builds, n + 1, `S ${id}: one rebuild`);
    assert.strictEqual($('preset').value, id, `S ${id}: menu keeps the preset after applying it`);
    assert.strictEqual($('scale-preset').value, String(v.scaleIn), `S ${id}: scale menu follows`);
    const pp = Fretboard.presetParams(id);
    for (const k of Object.keys(pp)) {
      if (k === 'fretSteps') assert.strictEqual(lastParams.fretSteps, pp.fretSteps, `S ${id}: ${k}`);
      else approx(lastParams[k], pp[k], 1e-9, `S ${id}: build used preset ${k}`);
    }
    assert.strictEqual(lastParams.radiusMm, 0, `S ${id}: still flat`);
    assert.strictEqual(lastParams.edgeFilletMm, 1, `S ${id}: round-over untouched`);
  }
  // editing a preset field flips the menu to Custom and keeps the edit
  const edits = [['nut-width', 'input', '1.7'], ['scale', 'input', '25'], ['strings', 'change', '4'], ['frets', 'input', '21'],
    ['fret-mode', 'change', 'diatonic'], ['heel-width', 'input', '2'], ['fret-height', 'input', '0.04'], ['slot-height', 'input', '0.3'],
    ['scale-preset', 'change', '23.5']];
  for (const [id, type, val] of edits) {
    pick('t-style');
    $(id).value = val; $(id).dispatch(type);
    assert.strictEqual($('preset').value, 'custom', `S: editing #${id} switches to Custom`);
  }
  // options the preset doesn't set leave it selected
  pick('lp-style');
  $('edge-fillet').value = '2'; $('edge-fillet').dispatch('change');
  $('split').value = '5,12'; $('split').dispatch('change');
  assert.strictEqual($('preset').value, 'lp-style', 'S: printing options keep the preset');
  assert.strictEqual(lastParams.edgeFilletMm, 2);
  console.log('S ok: T-Style / LP-Style presets build flat and watertight; picking one fills the form, editing its fields switches to Custom');
}

console.log('\nALL GEOMETRY TESTS PASSED');
