import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const site = readFileSync(new URL('js/site.js', root), 'utf8');
const css = readFileSync(new URL('css/style.css', root), 'utf8');

test('buy form markup: full-width qty stepper with explicit up/down controls (1–10)', () => {
  assert.match(site, /class="qty-stepper"/);
  assert.match(site, /data-qty-step="1"/);
  assert.match(site, /data-qty-step="-1"/);
  assert.match(site, /aria-label="Increase quantity"/);
  assert.match(site, /aria-label="Decrease quantity"/);
  assert.match(site, /name="qty" min="1" max="10"/);
  assert.match(site, /wireBuyQtyStepper\(formEl\)/);
  assert.match(site, /Math\.min\(10, \+fd\.get\('qty'\)\|\|1\)/);
  // No half-width two-column buy row with bare number input as sole control
  assert.doesNotMatch(site, /<label>Quantity<input type="number" name="qty" min="1" max="20"/);
});

test('buy-form CSS: stepper and Add to cart share full width; native spinners hidden', () => {
  assert.match(css, /\.buy-form \.btn\{[^}]*width:100%/);
  assert.match(css, /\.buy-form \.qty-stepper\{[^}]*width:100%/);
  assert.match(css, /-webkit-appearance:none/);
  assert.match(css, /-moz-appearance:textfield/);
  assert.match(css, /\.buy-form \.qty-stepper-btns\{/);
  // Legacy two-column buy row no longer splits qty to half width
  assert.match(css, /\.buy-form \.row\{display:block\}/);
  assert.doesNotMatch(css, /\.buy-form \.row\{display:grid;grid-template-columns:1fr 1fr/);
});

/** Minimal DOM so we can exercise wireBuyQtyStepper without a browser. */
function loadStepperFn() {
  const m = site.match(/function wireBuyQtyStepper\(formEl\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'wireBuyQtyStepper present');
  // eslint-disable-next-line no-new-func
  return new Function(`${m[0]}; return wireBuyQtyStepper;`)();
}

function fakeForm(initial = '1') {
  const listeners = new Map();
  const el = (tag, attrs = {}) => {
    const node = {
      tagName: tag.toUpperCase(),
      attrs: { ...attrs },
      disabled: false,
      value: attrs.value || '',
      min: attrs.min,
      max: attrs.max,
      name: attrs.name,
      getAttribute(k) { return this.attrs[k]; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      addEventListener(type, fn) {
        const list = listeners.get(this) || [];
        list.push({ type, fn });
        listeners.set(this, list);
      },
      click() {
        for (const { type, fn } of listeners.get(this) || []) if (type === 'click') fn();
      },
      dispatch(type) {
        for (const { type: t, fn } of listeners.get(this) || []) if (t === type) fn();
      },
    };
    return node;
  };
  const inp = el('input', { name: 'qty', min: '1', max: '10', value: initial, type: 'number' });
  inp.value = initial;
  const up = el('button', { 'data-qty-step': '1' });
  up.getAttribute = (k) => (k === 'data-qty-step' ? '1' : up.attrs[k]);
  const down = el('button', { 'data-qty-step': '-1' });
  down.getAttribute = (k) => (k === 'data-qty-step' ? '-1' : down.attrs[k]);
  const form = {
    querySelector(sel) {
      if (sel === 'input[name="qty"]') return inp;
      if (sel === '[data-qty-step="1"]') return up;
      if (sel === '[data-qty-step="-1"]') return down;
      return null;
    },
  };
  return { form, inp, up, down };
}

test('qty stepper: typing clamp, arrows step, disable at 1 and 10', () => {
  const wire = loadStepperFn();
  const { form, inp, up, down } = fakeForm('1');
  wire(form);
  assert.equal(inp.value, '1');
  assert.equal(down.disabled, true);
  assert.equal(up.disabled, false);

  up.click();
  assert.equal(inp.value, '2');
  assert.equal(down.disabled, false);

  inp.value = '10';
  inp.dispatch('input');
  assert.equal(inp.value, '10');
  assert.equal(up.disabled, true);
  assert.equal(down.disabled, false);

  up.click(); // no-op while disabled handler still steps? our click always fires step — disabled buttons shouldn't fire in real DOM; simulate by not clicking when disabled
  // Real browsers don't fire click on disabled buttons; our fake still would — re-sync after manual overshoot:
  inp.value = '10';
  inp.dispatch('change');
  assert.equal(up.disabled, true);

  down.click();
  assert.equal(inp.value, '9');
  assert.equal(up.disabled, false);

  inp.value = '0';
  inp.dispatch('change');
  assert.equal(inp.value, '1');
  assert.equal(down.disabled, true);

  inp.value = '99';
  inp.dispatch('input');
  assert.equal(inp.value, '10');
  assert.equal(up.disabled, true);

  inp.value = 'abc';
  inp.dispatch('change');
  assert.equal(inp.value, '1');
});
