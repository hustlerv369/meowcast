import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAT_HEAD, CAT_BODY, CAT_EYES, catExpression, catSvg, drawCat, drawCatCompanion } from '../src/mochi/cat.ts';

test('original cat exports distinct calm, alert, happy and sleepy SVG faces', () => {
  const variants = Object.keys(CAT_EYES).map(catSvg);
  assert.equal(new Set(variants).size, 4);
  for (const svg of variants) {
    assert.ok(svg.includes(CAT_HEAD));
    assert.match(svg, /viewBox="-34 -34 68 68"/);
    assert.doesNotMatch(svg, /<image|href=|script|foreignObject/);
  }
});

test('actual task states map to recognizable cat variants', () => {
  assert.equal(catExpression('finished'), 'happy');
  assert.equal(catExpression('approval'), 'alert');
  assert.equal(catExpression('error'), 'alert');
  assert.equal(catExpression('sleeping'), 'sleepy');
  assert.equal(catExpression('working'), 'calm');
});

test('every canvas avatar path uses the original cat including file uploads', () => {
  for (const file of ['mochi/engine.ts', 'mochi/greeting.ts', 'upload/canvas.ts']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /drawCat\(/);
    assert.doesNotMatch(source, /function mochiPath|function bodyPath|private bodyPath/);
  }
});

test('Meowmate branding retains the existing application identity', () => {
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(config.productName, 'Meowmate');
  assert.equal(config.app.windows[0].title, 'Meowmate');
  assert.equal(config.identifier, 'fr.louisraille.coucou');
  for (const file of ['index.html', 'settings.html', 'dock.html']) {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(html, /Meowmate/);
    assert.doesNotMatch(html, /Coucou|Týpek|Mochi/);
  }
});

test('canvas uses the original SVG geometry and balances context state', () => {
  const paths = [];
  let saves = 0;
  const previous = globalThis.Path2D;
  globalThis.Path2D = class { constructor(path) { paths.push(path); } };
  try {
    drawCat({ save() { saves++; }, restore() { saves--; }, scale() {}, fill() {}, stroke() {} }, 30, 'alert');
    assert.equal(saves, 0);
    assert.equal(paths[0], CAT_HEAD);
    assert.ok(paths.includes(CAT_EYES.alert));
  } finally {
    globalThis.Path2D = previous;
  }
});

test('dock companion renders a full body while retaining the original head and state expression', () => {
  const paths = [];
  let saves = 0;
  const previous = globalThis.Path2D;
  globalThis.Path2D = class { constructor(path) { paths.push(path); } };
  try {
    drawCatCompanion({ save() { saves++; }, restore() { saves--; }, scale() {}, translate() {}, fill() {}, stroke() {} }, 30, 'happy');
    assert.equal(saves, 0);
    assert.ok(paths.includes(CAT_BODY));
    assert.ok(paths.includes(CAT_HEAD));
    assert.ok(paths.includes(CAT_EYES.happy));
  } finally {
    globalThis.Path2D = previous;
  }
});

test('island, settings and dock share system-aware neutral appearance tokens', () => {
  for (const file of ['style.css', 'settings/settings.css', 'dock/style.css']) {
    assert.match(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), /@import "\.\.?\/meowcast.css"/);
  }
  const css = readFileSync(new URL('../src/meowcast.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-color-scheme: light/);
  for (const value of ['#202020', '#282828', '#eeeeee', '#f5f5f5', '#bfbfbf']) assert.ok(css.includes(value));
});

test('both neutral palettes keep primary and secondary text at 4.5:1 on all control surfaces', () => {
  const luminance = (hex) => hex.match(/[\da-f]{2}/gi).map((value) => {
    const channel = parseInt(value, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
  for (const [text, surfaces] of [
    [['f5f5f5', 'bfbfbf'], ['202020', '282828', '404040', '484848']],
    [['242424', '505050'], ['eeeeee', 'f5f5f5', 'cacaca', 'dddddd']],
  ]) for (const foreground of text) for (const background of surfaces) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, `${foreground} on ${background}`);
  }
});
