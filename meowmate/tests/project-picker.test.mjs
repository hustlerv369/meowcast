import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterProjectOptions, projectPickerBounds } from '../src/components/project-picker.ts';

test('project search matches Czech names and distinguishing folder paths', () => {
  const options = [
    { value: 'a', label: 'Červený projekt', detail: 'D:\\Client A\\website' },
    { value: 'b', label: 'Červený projekt', detail: 'D:\\Client B\\website' },
  ];
  assert.deepEqual(filterProjectOptions(options, 'cerveny b\\').map(x => x.value), ['b']);
  assert.deepEqual(filterProjectOptions(options, 'NEEXISTUJE'), []);
  assert.deepEqual(filterProjectOptions(options, '  '), options);
});

test('history menu near popup bottom opens upward inside native 720 by 320 viewport', () => {
  const bounds = projectPickerBounds({ left: 102, top: 230, bottom: 258, width: 595 }, { width: 720, height: 320 }, 264);
  assert.equal(bounds.top, 8);
  assert.equal(bounds.top + bounds.height, 225);
  assert.ok(bounds.left + bounds.width <= 712);
});

test('top project menu opens downward and remains inside narrow viewport', () => {
  const bounds = projectPickerBounds({ left: 270, top: 12, bottom: 40, width: 110 }, { width: 360, height: 320 }, 120);
  assert.equal(bounds.top, 45);
  assert.equal(bounds.height, 120);
  assert.equal(bounds.width, 270);
  assert.equal(bounds.left, 82);
});

test('picker width is clamped for increased text scaling in a narrow viewport', () => {
  const bounds = projectPickerBounds({ left: 8, top: 12, bottom: 40, width: 230 }, { width: 250, height: 200 }, 264);
  assert.equal(bounds.width, 234);
  assert.equal(bounds.left, 8);
  assert.ok(bounds.top + bounds.height <= 192);
});
