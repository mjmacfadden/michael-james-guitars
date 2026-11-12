/*
 * app.js — UI wiring, 3D preview, STL download.
 * Geometry lives in geometry.js, STL encoding in stl.js.
 * The preview is a small hand-rolled canvas renderer: no libraries,
 * no CDN, works offline straight from file://.
 */
(function () {
  'use strict';

  var IN = 25.4;
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    strings: $('strings'), frets: $('frets'), fretsValue: $('frets-value'),
    scalePreset: $('scale-preset'), scale: $('scale'),
    nutWidth: $('nut-width'), heelWidth: $('heel-width'),
    split: $('split'), bedRow: $('bed-row'), bedLength: $('bed-length'),
    seamKeys: $('seam-keys'), fret17: $('fret-17'), fretMode: $('fret-mode'),
    thickness: $('thickness'), fretHeight: $('fret-height'), tail: $('tail'),
    slotHeight: $('slot-height'), slotSlope: $('slot-slope'),
    nutScrew: $('nut-screw'), tailScrew: $('tail-screw'), roundTail: $('round-tail'),
    leftHanded: $('left-handed'),
    headstockExt: $('headstock-ext'),
    fbRadius: $('fb-radius'),
    edgeFillet: $('edge-fillet'),
    preset: $('preset'),
    downloads: $('downloads'), filename: $('filename'),
    sizeOut: $('size-out'), holesOut: $('holes-out'), slotsOut: $('slots-out'),
    warnings: $('warnings'),
    fretRows: $('fret-rows'), preview: $('preview'), previewFallback: $('preview-fallback')
  };

  // Sensible nut widths per string count (inches); heel = nut + 3/8".
  var NUT_DEFAULTS = { 2: 1.5, 3: 1.5, 4: 1.5, 5: 1.625, 6: 1.75 };

  var current = null; // { triangles, meta, filename }
  var preview = null;

  function num(el, fallback) {
    var v = parseFloat(el.value);
    return isFinite(v) ? v : fallback;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // The split select encodes: '0' = one piece, '7' = one seam after
  // fret 7, '5,12' = two seams (three pieces), 'auto' = let the
  // geometry planner fit the pieces to the print bed.
  function splitSelection() {
    var v = els.split.value;
    if (v === 'auto') return { frets: null, auto: true };
    if (v.indexOf(',') !== -1) {
      return { frets: v.split(',').map(function (s) { return parseInt(s, 10); }), auto: false };
    }
    var n = parseInt(v, 10) || 0;
    return { frets: n > 0 ? [n] : null, auto: false };
  }

  function readParams() {
    var sel = splitSelection();
    return {
      scaleMm: clamp(num(els.scale, 23.5), 18, 30) * IN,
      strings: parseInt(els.strings.value, 10),
      frets: parseInt(els.frets.value, 10),
      nutWidthMm: clamp(num(els.nutWidth, 1.5), 1, 2.5) * IN,
      heelWidthMm: clamp(num(els.heelWidth, 1.5), 1.1, 3) * IN,
      thicknessMm: clamp(num(els.thickness, 0.2), 0.14, 0.31) * IN,
      fretHeightMm: clamp(num(els.fretHeight, 0.035), 0.02, 0.06) * IN,
      tailMm: clamp(num(els.tail, 1.2), 0.4, 2.36) * IN,
      slotHeightMm: clamp(num(els.slotHeight, 0.3), 0.1, 0.8),
      slotSlopeDeg: clamp(num(els.slotSlope, 7.5), 0, 20),
      nutScrew: els.nutScrew.checked,
      tailScrew: els.tailScrew.checked,
      tailCornerRadiusMm: els.roundTail.checked ? 6.35 : 0,
      leftHanded: els.leftHanded.checked,
      headstockExtMm: els.headstockExt.checked ? 6.35 : 0,
      radiusMm: parseFloat(els.fbRadius.value) || 0,
      edgeFilletMm: clamp(num(els.edgeFillet, 1), 0, 2),
      splitAfterFrets: sel.frets,
      autoSplit: sel.auto,
      bedMm: sel.auto ? clamp(num(els.bedLength, 220), 100, 400) : 0,
      seamKeys: els.seamKeys.checked,
      fretSteps: Fretboard.FRET_MODES[els.fretMode.value] || null,
      skipMarkers: els.fret17.checked ? [] : [17]
    };
  }

  function fmtIn(mm) { return (mm / IN).toFixed(2) + '″'; }

  // Pieces are built in whole-board coordinates (part 2 starts where
  // part 1 ends). For the STL, shift each piece to its own origin so
  // both parts can be dropped onto one slicer plate and arranged.
  function rebasePiece(piece) {
    var src = piece.triangles;
    if (!piece.y0) return src;
    var out = new Float32Array(src.length);
    for (var i = 0; i < src.length; i++) {
      out[i] = (i % 9 === 1 || i % 9 === 4 || i % 9 === 7) ? src[i] - piece.y0 : src[i];
    }
    return out;
  }

  function downloadSTL(triangles, filename) {
    var blob = STLExport.trianglesToSTL(triangles);
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function rebuild() {
    var params = readParams();
    var result;
    try {
      result = Fretboard.buildFretboard(params, earcut);
    } catch (err) {
      // The geometry validates its inputs and throws a readable error:
      // show it and offer no downloads, rather than exporting a
      // broken STL or dying silently.
      els.warnings.textContent = '✖ ' + err.message;
      els.warnings.hidden = false;
      els.downloads.innerHTML = '';
      els.filename.textContent = '';
      return;
    }
    var meta = result.meta;
    var scaleIn = (params.scaleMm / IN).toFixed(2).replace(/\.?0+$/, '');
    var base = 'fretboard_' + params.strings + 'string_' + params.frets +
      'fret_' + scaleIn + 'in' +
      (params.radiusMm ? '_r' + (Math.round((params.radiusMm / IN) * 100) / 100) : '');
    var multi = result.pieces.length > 1;
    current = { triangles: result.triangles, meta: meta, filename: base + '.stl' };

    els.fretsValue.textContent = params.frets;

    // one download button per printable piece
    els.downloads.innerHTML = '';
    var names = [];
    result.pieces.forEach(function (piece, i) {
      var fname = base + (multi ? '_part' + (i + 1) : '') + '.stl';
      names.push(fname);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = multi
        ? '⬇ Part ' + (i + 1) + ' — ' +
          (i === 0 ? 'nut end' : i === result.pieces.length - 1 ? 'tail end' : 'middle') +
          ' (' + fmtIn(piece.lengthMm) + ')'
        : '⬇ Download STL';
      btn.addEventListener('click', function () { downloadSTL(rebasePiece(piece), fname); });
      els.downloads.appendChild(btn);
    });
    els.filename.textContent = names.join('  +  ');

    els.sizeOut.textContent =
      fmtIn(meta.lengthMm) + ' long × ' + fmtIn(meta.nutWidthMm) + ' → ' +
      fmtIn(meta.tailWidthMm) + ' wide' +
      (multi
        ? ' · ' + result.pieces.map(function (piece, i) {
            return 'Part ' + (i + 1) + ': ' + fmtIn(piece.lengthMm);
          }).join(' · ') + ' — check they fit your print bed'
        : '');
    els.holesOut.textContent = meta.holes.length + ' — ' +
      meta.holes.map(function (h) { return h.label; }).join(', ');
    els.slotsOut.textContent = 'sized per string' +
      (meta.tuningLabel ? ' for ' + meta.tuningLabel : '') + ': ' +
      meta.stringGaugesIn.map(function (g) { return g.toFixed(3).replace('0.', '.') + '″'; }).join(' · ') +
      (meta.nut ? ' — string undersides sit ' +
        meta.nut.targetsMm.map(function (t) { return t.toFixed(2); }).join('/') +
        ' mm over fret 1 (low→high)' : '') +
      (params.leftHanded ? ' — left-handed layout' : '');

    if (meta.warnings.length) {
      els.warnings.textContent = '⚠ ' + meta.warnings.join(' ');
      els.warnings.hidden = false;
    } else {
      els.warnings.hidden = true;
    }

    var rows = '';
    meta.keptFrets.forEach(function (n) {
      var d = meta.fretDistancesMm[n];
      rows += '<tr><td>' + n + '</td><td>' + (d / IN).toFixed(3) + '</td><td>' +
        d.toFixed(1) + '</td></tr>';
    });
    els.fretRows.innerHTML = rows;

    if (preview) preview.setScene(result.groups);
  }

  // ------------------------------------------------------------------
  // 3D preview — dependency-free canvas renderer.
  // Drag to orbit (all the way under), right-drag or shift-drag to
  // pan, scroll to zoom, double-click to reset the view.
  // ------------------------------------------------------------------
  function createPreview(container, fallbackEl) {
    var canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.cursor = 'grab';
    canvas.title = 'Drag to spin · right-drag to pan · scroll to zoom · double-click to reset';
    container.appendChild(canvas);
    var ctx = null;
    try { ctx = canvas.getContext && canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) {
      fallbackEl.hidden = false;
      container.style.display = 'none';
      return null;
    }

    var tris = null; // scene groups { body, recess, features }
    var groupNormals = {}; // per-group smoothed vertex normals
    var center = [0, 0, 0], radius = 1;
    var MIN_ZOOM = 0.5, MAX_ZOOM = 64;
    var az = -0.6, el = 0.62, zoom = 1;
    var panX = 0, panY = 0; // screen-space pan offset, canvas pixels

    // Smooth (per-vertex) normals for shading: at each vertex, average
    // the normals of the faces meeting there that point within ~30
    // degrees of each other. Curved surfaces (fret crowns, countersink
    // cones, nut round-overs, the radius) shade smoothly, while sharp
    // edges (board edges, slot walls) stay crisp.
    function computeNormals(t) {
      var fn = new Float32Array(t.length);
      var i, j;
      for (i = 0; i < t.length; i += 9) {
        var ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2];
        var wx = t[i + 6] - t[i], wy = t[i + 7] - t[i + 1], wz = t[i + 8] - t[i + 2];
        var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        for (j = 0; j < 3; j++) {
          fn[i + j * 3] = nx / nl; fn[i + j * 3 + 1] = ny / nl; fn[i + j * 3 + 2] = nz / nl;
        }
      }
      var byVertex = new Map();
      for (i = 0; i < t.length; i += 3) {
        var key = t[i].toFixed(3) + ',' + t[i + 1].toFixed(3) + ',' + t[i + 2].toFixed(3);
        if (!byVertex.has(key)) byVertex.set(key, []);
        byVertex.get(key).push(i);
      }
      var out = new Float32Array(t.length);
      byVertex.forEach(function (slots) {
        slots.forEach(function (s) {
          var fx = fn[s], fy = fn[s + 1], fz = fn[s + 2];
          var sx = 0, sy = 0, sz = 0;
          slots.forEach(function (o) {
            if (fn[o] * fx + fn[o + 1] * fy + fn[o + 2] * fz > 0.86) {
              sx += fn[o]; sy += fn[o + 1]; sz += fn[o + 2];
            }
          });
          var l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
          out[s] = sx / l; out[s + 1] = sy / l; out[s + 2] = sz / l;
        });
      });
      return out;
    }

    function resize() {
      var w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      draw();
    }

    function setScene(groups) {
      tris = groups;
      groupNormals = {
        endWalls: computeNormals(groups.endWalls),
        body: computeNormals(groups.body),
        recess: computeNormals(groups.recess),
        features: computeNormals(groups.features)
      };
      var all = groups.endWalls.concat(groups.body, groups.recess, groups.features);
      var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (var i = 0; i < all.length; i += 3) {
        for (var k = 0; k < 3; k++) {
          if (all[i + k] < min[k]) min[k] = all[i + k];
          if (all[i + k] > max[k]) max[k] = all[i + k];
        }
      }
      center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
      draw();
    }

    function colorFor(s) {
      return 'rgb(' + Math.round(208 * s) + ',' + Math.round(170 * s) + ',' + Math.round(112 * s) + ')';
    }

    function draw() {
      var W = canvas.width, H = canvas.height;
      if (!W || !H) return;
      ctx.clearRect(0, 0, W, H);
      if (!tris) return;

      var cosA = Math.cos(az), sinA = Math.sin(az);
      var cosE = Math.cos(el), sinE = Math.sin(el);
      var scale = (Math.max(W, H) * 0.46 / radius) * zoom;
      // Light direction in view space: from the upper left, on the
      // viewer's side of the board. View axes: x = right, y = away
      // from the viewer, z = up.
      var lx = -0.45, ly = -0.35, lz = 0.82;
      var ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
      lx /= ll; ly /= ll; lz /= ll;

      // Paint in layers — board body, then the recessed hole walls,
      // then the raised features (frets, nut, extension). Within a layer
      // nothing overlaps in plan, so the painter sort is reliable; a
      // single mixed sort is NOT (a fret and the face beneath it have no
      // consistent order, which drew frets as broken dashes). Viewed
      // from underneath (el < 0) the order reverses, so the far side
      // paints first there too.
      var layerNames = el >= 0
        ? ['endWalls', 'body', 'recess', 'features']
        : ['features', 'recess', 'body', 'endWalls'];
      for (var li = 0; li < layerNames.length; li++) {
        var t = tris[layerNames[li]];
        var vn = groupNormals[layerNames[li]];
        if (!t) continue;
        var faces = [];
        var i, j;
        for (i = 0; i < t.length; i += 9) {
          var X = [], Y = [], Z = [];
          for (j = 0; j < 3; j++) {
            var x = t[i + j * 3] - center[0];
            var y = t[i + j * 3 + 1] - center[1];
            var z = t[i + j * 3 + 2] - center[2];
            // spin in the board's plane, then tilt the top toward the viewer
            var rx = x * cosA - y * sinA;
            var ry = x * sinA + y * cosA;
            X.push(rx);                        // view x (screen right)
            Y.push(ry * cosE - z * sinE);      // view y (away from viewer)
            Z.push(ry * sinE + z * cosE);      // view z (screen up)
          }
          // Face normal in view space (rotations preserve winding).
          var ux = X[1] - X[0], uy = Y[1] - Y[0], uz = Z[1] - Z[0];
          var wx = X[2] - X[0], wy = Y[2] - Y[0], wz = Z[2] - Z[0];
          var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
          var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (nl === 0 || ny >= 0) continue; // backface (viewer sits at -y)
          nx /= nl; ny /= nl; nz /= nl;
          var shade = 0.42 + 0.58 * Math.max(0, nx * lx + ny * ly + nz * lz);
          var px = [], py = [], depth = 0, vsh = [];
          for (j = 0; j < 3; j++) {
            px.push(W / 2 + X[j] * scale + panX);
            py.push(H / 2 - Z[j] * scale + panY);
            depth += -Y[j]; // toward the viewer
            if (vn) {
              var mx = vn[i + j * 3], my = vn[i + j * 3 + 1], mz = vn[i + j * 3 + 2];
              var mrx = mx * cosA - my * sinA, mry = mx * sinA + my * cosA;
              var vnx = mrx, vny = mry * cosE - mz * sinE, vnz = mry * sinE + mz * cosE;
              vsh.push(0.42 + 0.58 * Math.max(0, vnx * lx + vny * ly + vnz * lz));
            }
          }
          // skip faces entirely off-canvas (matters when zoomed in close)
          if (Math.max(px[0], px[1], px[2]) < -2 || Math.min(px[0], px[1], px[2]) > W + 2 ||
              Math.max(py[0], py[1], py[2]) < -2 || Math.min(py[0], py[1], py[2]) > H + 2) continue;
          faces.push({ px: px, py: py, depth: depth / 3, shade: shade, vsh: vsh });
        }
        faces.sort(function (a, b) { return a.depth - b.depth; }); // far first

        for (i = 0; i < faces.length; i++) {
          var f = faces[i], s = f.shade;
          ctx.beginPath();
          ctx.moveTo(f.px[0], f.py[0]);
          ctx.lineTo(f.px[1], f.py[1]);
          ctx.lineTo(f.px[2], f.py[2]);
          ctx.closePath();
          if (f.vsh.length === 3 && (f.vsh[0] !== f.vsh[1] || f.vsh[1] !== f.vsh[2])) {
            // Exact linear (Gouraud) interpolation of the vertex shades:
            // fit shade = a*x + b*y + c through the three vertices and
            // run the gradient along (a, b). Cheaper darkest-to-lightest
            // gradients flip direction per triangle and weave a diamond
            // pattern into long thin faces like the fret lofts.
            var det = (f.px[1] - f.px[0]) * (f.py[2] - f.py[0]) -
                      (f.px[2] - f.px[0]) * (f.py[1] - f.py[0]);
            var ga = det !== 0 ? ((f.vsh[1] - f.vsh[0]) * (f.py[2] - f.py[0]) -
                                  (f.vsh[2] - f.vsh[0]) * (f.py[1] - f.py[0])) / det : 0;
            var gb = det !== 0 ? ((f.px[1] - f.px[0]) * (f.vsh[2] - f.vsh[0]) -
                                  (f.px[2] - f.px[0]) * (f.vsh[1] - f.vsh[0])) / det : 0;
            var gl2 = ga * ga + gb * gb;
            if (gl2 > 1e-12) {
              var sMin = Math.min(f.vsh[0], f.vsh[1], f.vsh[2]);
              var sMax = Math.max(f.vsh[0], f.vsh[1], f.vsh[2]);
              var start = f.vsh.indexOf(sMin);
              var gLen = (sMax - sMin) / Math.sqrt(gl2); // distance along the (ga, gb) direction covering the full shade range
              var ux = ga / Math.sqrt(gl2), uy = gb / Math.sqrt(gl2);
              var grad = ctx.createLinearGradient(
                f.px[start], f.py[start],
                f.px[start] + ux * gLen, f.py[start] + uy * gLen);
              grad.addColorStop(0, colorFor(sMin));
              for (var q = 0; q < 3; q++) {
                if (q === start) continue;
                var frac = ((f.px[q] - f.px[start]) * ux + (f.py[q] - f.py[start]) * uy) / gLen;
                grad.addColorStop(Math.max(0, Math.min(1, frac)), colorFor(f.vsh[q]));
              }
              grad.addColorStop(1, colorFor(sMax));
              ctx.fillStyle = grad;
            } else {
              ctx.fillStyle = colorFor(s);
            }
          } else {
            ctx.fillStyle = colorFor(s);
          }
          ctx.fill();
          // stroke with the flat fill color: seals hairline seams between
          // faces without drawing the triangulation as a dark web
          ctx.strokeStyle = colorFor(s);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    var dragMode = null, lastX = 0, lastY = 0; // 'orbit' | 'pan'
    canvas.addEventListener('pointerdown', function (e) {
      // right button (or shift+drag) pans; left button orbits
      dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
      lastX = e.clientX; lastY = e.clientY;
      canvas.style.cursor = dragMode === 'pan' ? 'move' : 'grabbing';
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragMode) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (dragMode === 'pan') {
        // pointer deltas are CSS pixels; pan offsets are canvas pixels
        var k = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;
        panX += dx * k;
        panY += dy * k;
      } else {
        az += dx * 0.008;
        // nearly pole to pole (±86°), so the underside is fully reachable
        el = clamp(el + dy * 0.008, -1.5, 1.5);
      }
      draw();
    });
    function endDrag() { dragMode = null; canvas.style.cursor = 'grab'; }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      // Zoom toward the cursor: adjust the pan by the same factor so
      // the board point under the mouse stays under the mouse.
      var rect = canvas.getBoundingClientRect();
      var k = rect.width ? canvas.width / rect.width : 1;
      var mx = (e.clientX - rect.left) * k, my = (e.clientY - rect.top) * k;
      // Scale the step by the wheel delta so trackpads zoom smoothly and a
      // mouse notch is ~15%. Max 64x shows ~8 mm across the view, close
      // enough to inspect the edge round-over and fret ends. The view is
      // orthographic, so there is no near plane to clip through.
      var dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      var step = clamp(Math.pow(1.0015, -dy), 0.8, 1.25);
      var newZoom = clamp(zoom * step, MIN_ZOOM, MAX_ZOOM);
      var r = newZoom / zoom;
      if (r !== 1) {
        panX = mx - canvas.width / 2 - (mx - canvas.width / 2 - panX) * r;
        panY = my - canvas.height / 2 + (canvas.height / 2 + panY - my) * r;
        zoom = newZoom;
      }
      draw();
    }, { passive: false });
    canvas.addEventListener('dblclick', function () {
      az = -0.6; el = 0.62; zoom = 1; panX = 0; panY = 0;
      draw();
    });
    window.addEventListener('resize', resize);

    resize();
    return { setScene: setScene, draw: draw, canvas: canvas };
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  // Presets fill in a standard set of values (see Fretboard.PRESETS).
  // 'custom' changes nothing. Values are written straight into the
  // controls (no input events fire), then the board rebuilds once.
  // Editing any of those controls afterwards flips the menu to Custom.
  var PRESET_CONTROLS = {
    strings: 'strings', frets: 'frets', fretMode: 'fret-mode', scaleIn: 'scale',
    nutWidthIn: 'nut-width', heelWidthIn: 'heel-width',
    fretHeightIn: 'fret-height', slotHeightMm: 'slot-height'
  };
  function applyPreset(id) {
    var preset = Fretboard.PRESETS[id];
    if (!preset) return;
    Object.keys(PRESET_CONTROLS).forEach(function (key) {
      $(PRESET_CONTROLS[key]).value = String(preset.values[key]);
    });
    // keep the scale-length menu in step with the new scale
    var match = 'custom';
    var opts = els.scalePreset.options || [];
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].value !== 'custom' && Number(opts[i].value) === preset.values.scaleIn) match = opts[i].value;
    }
    els.scalePreset.value = match;
    rebuild();
  }
  function presetToCustom() { els.preset.value = 'custom'; }
  els.preset.addEventListener('change', function () { applyPreset(els.preset.value); });
  Object.keys(PRESET_CONTROLS).map(function (k) { return PRESET_CONTROLS[k]; })
    .concat(['scale-preset']).forEach(function (id) {
      $(id).addEventListener('input', presetToCustom);
      $(id).addEventListener('change', presetToCustom);
    });

  els.strings.addEventListener('change', function () {
    var nut = NUT_DEFAULTS[els.strings.value] || 1.5;
    els.nutWidth.value = nut;
    els.heelWidth.value = nut + 0.375;
    rebuild();
  });
  els.scalePreset.addEventListener('change', function () {
    if (els.scalePreset.value !== 'custom') {
      els.scale.value = els.scalePreset.value;
      rebuild();
    } else {
      els.scale.focus();
    }
  });
  els.scale.addEventListener('input', function () {
    els.scalePreset.value = 'custom';
    rebuild();
  });
  ['frets', 'nut-width', 'heel-width', 'thickness', 'fret-height', 'tail', 'slot-height', 'slot-slope'].forEach(function (id) {
    $(id).addEventListener('input', rebuild);
  });
  els.nutScrew.addEventListener('change', rebuild);
  els.tailScrew.addEventListener('change', rebuild);
  els.roundTail.addEventListener('change', rebuild);
  els.leftHanded.addEventListener('change', rebuild);
  els.headstockExt.addEventListener('change', rebuild);
  els.fbRadius.addEventListener('change', rebuild);
  function syncBedRow() { els.bedRow.hidden = els.split.value !== 'auto'; }
  els.split.addEventListener('change', function () { syncBedRow(); rebuild(); });
  els.bedLength.addEventListener('input', rebuild);
  els.seamKeys.addEventListener('change', rebuild);
  els.edgeFillet.addEventListener('change', rebuild);
  els.fret17.addEventListener('change', rebuild);
  els.fretMode.addEventListener('change', rebuild);

  syncBedRow();
  preview = createPreview(els.preview, els.previewFallback);
  rebuild();
})();
