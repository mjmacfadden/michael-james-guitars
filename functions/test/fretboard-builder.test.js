// Fretboard Builder page (fretboard-builder.html + fretboard-builder/). Static, client-side only;
// this file lives here so CI's `npm --prefix functions test` covers it. No Functions code involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const rootPath = fileURLToPath(root);
const require = createRequire(import.meta.url);
const enginePath = (f) => fileURLToPath(new URL(`fretboard-builder/engine/${f}`, root));
const D = require(fileURLToPath(new URL('fretboard-builder/design-config.js', root)));
const earcut = require(enginePath('vendor/earcut.min.js'));
const Fretboard = require(enginePath('geometry.js'));
const page = readFileSync(new URL('fretboard-builder.html', root), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('fretboard-builder/UPSTREAM.json', root), 'utf8'));
const appSrc = readFileSync(enginePath('app.js'), 'utf8');

test('engine files are byte-identical to the recorded upstream commit (edit upstream, then sync)', () => {
  const r = spawnSync(process.execPath, ['scripts/sync-fretboard-builder.mjs', '--check'], { cwd: rootPath, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(page, new RegExp(`data-engine-version="${manifest.engineVersion}"`));
});

test('upstream geometry test suite passes in its new home', () => {
  const r = spawnSync(process.execPath, ['test.js'], { cwd: enginePath(''), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr.slice(-2000));
  assert.match(r.stdout, /ALL GEOMETRY TESTS PASSED/);
});

test('page has every element id engine/app.js uses, and store chrome', () => {
  const ids = [...appSrc.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]);
  const listed = (appSrc.match(/\[('frets'[^\]]+)\]\.forEach/) || [, ''])[1].match(/'([a-z0-9-]+)'/g)?.map((s) => s.slice(1, -1)) || [];
  for (const id of new Set([...ids, ...listed])) assert.match(page, new RegExp(`id="${id}"`), `missing #${id}`);
  for (const f of D.FIELDS) assert.match(page, new RegExp(`id="${f.id}"`), `design field ${f.key} has no control`);
  assert.match(page, /<link rel="stylesheet" href="css\/style.css">/);
  assert.match(page, /<script src="js\/site.js"><\/script>/);
  assert.match(page, /id="cart-drawer"/);
  assert.match(page, /<a href="fretboard-builder.html" aria-current="page">Fretboard Builder<\/a>/);
  // design-config must load before app.js (shared links are applied before the first build)
  assert.ok(page.indexOf('design-config.js') < page.indexOf('engine/app.js'));
});

test('every store page links to the builder in the nav', () => {
  for (const f of ['index.html', 'about.html', 'faq.html', 'contact.html', 'product.html', 'success.html', 'cancel.html', '404.html']) {
    assert.match(readFileSync(new URL(f, root), 'utf8'), /<nav id="site-nav"><div class="nav-inner"><a href="fretboard-builder.html">Fretboard Builder<\/a>/, f);
  }
});

test('design defaults match the page control defaults', () => {
  for (const f of D.FIELDS) {
    const tag = page.match(new RegExp(`<(input|select)[^>]*id="${f.id}"[^>]*>`))[0];
    let v;
    if (f.type === 'bool') v = / checked/.test(tag);
    else if (tag.startsWith('<input')) v = Number(tag.match(/value="([^"]*)"/)[1]);
    else {
      const block = page.slice(page.indexOf(tag), page.indexOf('</select>', page.indexOf(tag)));
      const opts = [...block.matchAll(/<option value="([^"]*)"( selected)?/g)];
      v = (opts.find((o) => o[2]) || opts[0])[1];
      assert.deepEqual(opts.map((o) => o[1]).sort(), f.values.map(String).sort(), `${f.key} options`);
    }
    assert.equal(String(v), String(f.def), f.key);
  }
});

test('design config: versioned, canonical, URL round-trip, lenient normalize with warnings', () => {
  const c = D.create({ strings: 3, split: 'auto', bedLengthMm: 250, radiusMm: 304.8, fretMode: 'diatonic' }, 'fretboard-builder@test');
  assert.equal(c.schema, 'mjg.fretboard-design');
  assert.equal(c.version, 1);
  assert.deepEqual(Object.keys(c.params), D.FIELDS.map((f) => f.key));
  const enc = D.encode(c);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(D.decode(enc), { config: c, warnings: [] });
  assert.deepEqual(D.fromHash(`#design=${enc}`).config, c);
  assert.equal(D.shareUrl(c, 'https://x.test/fretboard-builder.html#old'), `https://x.test/fretboard-builder.html#design=${enc}`);
  assert.equal(D.decode('not-base64!'), null);
  assert.equal(D.fromHash('#other=1'), null);
  const n = D.normalize({ schema: 'mjg.fretboard-design', version: 1, params: { frets: 99, strings: 7, bogus: 1, nutScrew: 'yes', scaleIn: '24' } });
  assert.equal(n.config.params.frets, 24);
  assert.equal(n.config.params.strings, 4);
  assert.equal(n.config.params.nutScrew, true);
  assert.equal(n.config.params.scaleIn, 24);
  assert.equal(n.warnings.length, 4);
  assert.ok(D.normalize({ schema: 'mjg.fretboard-design', version: 2, params: {} }).warnings.length > 0);
});

// Minimal fake DOM so engine/app.js can run headless: proves toBuildParams() == app.js readParams().
function fakeDom(html) {
  const els = new Map();
  const mk = (id) => ({ id, value: '', checked: false, hidden: false, textContent: '', innerHTML: '', style: {}, options: [],
    clientWidth: 0, clientHeight: 0, addEventListener() {}, appendChild() {}, focus() {}, remove() {}, setAttribute() {} });
  for (const m of html.matchAll(/<(input|select|div|span|p|tbody|label)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)) {
    const el = mk(m[3]); const attrs = m[2] + m[4];
    if (m[1] === 'input') { el.value = (attrs.match(/value="([^"]*)"/) || [, ''])[1]; el.checked = /\bchecked\b/.test(attrs); }
    if (m[1] === 'select') {
      const block = html.slice(m.index, html.indexOf('</select>', m.index));
      el.options = [...block.matchAll(/<option value="([^"]*)"( selected)?/g)].map((o) => ({ value: o[1], selected: !!o[2] }));
      el.value = (el.options.find((o) => o.selected) || el.options[0]).value;
    }
    els.set(m[3], el);
  }
  return { getElementById: (id) => els.get(id) || null, createElement: () => ({ ...mk(''), getContext: () => null }), body: mk('body') };
}

function appReadParams(config) {
  const document = fakeDom(page);
  D.applyToForm(document, config);
  let captured = null;
  const FB = { ...Fretboard, buildFretboard: (p, e) => { captured = p; return Fretboard.buildFretboard(p, e); } };
  vm.runInNewContext(appSrc, { document, window: { addEventListener() {}, devicePixelRatio: 1 }, Fretboard: FB, earcut, STLExport: {}, Map, Math, Float32Array, setTimeout });
  return { params: captured, document };
}

test('toBuildParams() mirrors engine/app.js for a spread of designs, and the form round-trips', () => {
  const designs = [
    {},
    { strings: 3, frets: 17, fretMode: 'pentatonic-plus', split: '5,12', leftHanded: true, fret17Screw: true },
    { strings: 6, nutWidthIn: 1.75, heelWidthIn: 2.125, scaleIn: 25.5, radiusMm: 241.3, edgeFilletMm: 0, headstockExt: false },
    { split: 'auto', bedLengthMm: 180, seamKeys: false, roundTail: false, tailScrew: true, nutScrew: false, thicknessIn: 0.25 },
    { split: '0', scaleIn: 24.1, slotHeightMm: 0.5, slotSlopeDeg: 3, fretHeightIn: 0.04, tailIn: 2 },
  ];
  for (const p of designs) {
    const c = D.create(p, manifest.engineVersion);
    const { params, document } = appReadParams(c);
    assert.ok(params, 'app.js built a board');
    assert.deepEqual(D.toBuildParams(c.params, Fretboard), JSON.parse(JSON.stringify(params)), JSON.stringify(p)); // JSON: app.js ran in another realm
    assert.deepEqual(D.readForm(document, manifest.engineVersion), c);
    const r = Fretboard.buildFretboard(D.toBuildParams(c.params, Fretboard), earcut);
    assert.ok(r.triangles.length > 0 && r.pieces.length >= 1);
  }
  const custom = appReadParams(D.create({ scaleIn: 24.1 })).document.getElementById('scale-preset');
  assert.equal(custom.value, 'custom');
});

test('custom ordering is scaffolded but OFF: no cart/network, button hidden + disabled', async () => {
  assert.equal(D.ORDERING_ENABLED, false);
  assert.match(page, /<button type="button" class="btn" id="fb-order" hidden disabled data-ordering="off">/);
  assert.deepEqual(await D.requestOrder(D.create({})), { ok: false, reason: 'ordering_disabled' });
  const line = await D.proposedCartLine(D.create({ strings: 3 }, 'e'));
  assert.equal(line.id, 'custom-fretboard');
  assert.match(line.designId, /^[0-9a-f]{64}$/);
  assert.equal(line.designId, await D.designId(D.create({ strings: 3 }, 'e')));
  assert.notEqual(line.designId, await D.designId(D.create({ strings: 4 }, 'e')));
  const store = readFileSync(new URL('fretboard-builder/store-page.js', root), 'utf8') + readFileSync(new URL('fretboard-builder/design-config.js', root), 'utf8');
  assert.doesNotMatch(store, /fetch\(|\/api\/|Cart\.add\(/);
});

test('Hosting staging ships the builder but not its tests or docs; /fretboard-builder redirects to the page', () => {
  execFileSync(process.execPath, ['scripts/stage-public.mjs'], { cwd: rootPath });
  try {
    const pub = (p) => existsSync(new URL(`public/${p}`, root));
    for (const p of ['fretboard-builder.html', 'fretboard-builder/design-config.js', 'fretboard-builder/store-page.js', 'fretboard-builder/builder.css',
      'fretboard-builder/engine/app.js', 'fretboard-builder/engine/geometry.js', 'fretboard-builder/engine/stl.js', 'fretboard-builder/engine/vendor/earcut.min.js']) assert.ok(pub(p), p);
    for (const p of ['fretboard-builder/engine/test.js', 'fretboard-builder/README.md', 'fretboard-builder/ORDERING.md']) assert.ok(!pub(p), p);
  } finally { rmSync(new URL('public/', root), { recursive: true, force: true }); }
  const f = JSON.parse(readFileSync(new URL('firebase.json', root), 'utf8'));
  assert.deepEqual(f.hosting.redirects.map((r) => [r.source, r.destination]), [['/fretboard-builder', '/fretboard-builder.html'], ['/fretboard-builder/', '/fretboard-builder.html']]);
});
