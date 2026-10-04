import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityModel, phaseLabel } from '../src/core/activity.ts';

const row = (id, phase, extra = {}) => ({ id, phase, source: 'codex', provider: 'Codex', host: 'Codex Desktop', project: 'Demo', tool: 'exec_command', updatedMs: 100, revision: 1, stale: false, restored: false, ...extra });

test('parallel sessions stay separate, running outranks old errors', () => {
  const model = new ActivityModel(); model.apply([row('a', 'error'), row('b', 'working', { updatedMs: 200 })]);
  assert.equal(model.rows.length, 2); assert.equal(model.current('codex').id, 'b');
});
test('explicit session selection survives subsequent snapshots', () => {
  const model = new ActivityModel(); model.apply([row('a', 'finished'), row('b', 'working')]); model.choose('codex', 'a');
  model.apply([row('a', 'finished'), row('b', 'working', { revision: 2 })]); assert.equal(model.current('codex').id, 'a');
});
test('removed selected session falls back to a real existing one', () => {
  const model = new ActivityModel(); model.apply([row('a', 'working')]); model.choose('codex', 'a'); model.apply([row('b', 'working')]); assert.equal(model.current('codex').id, 'b');
});
test('stale waiting never outranks fresh work', () => {
  const model = new ActivityModel(); model.apply([row('a', 'waiting', { stale: true }), row('b', 'working')]); assert.equal(model.current('codex').id, 'b');
});
test('review remains separate from accepted completion', () => {
  const model = new ActivityModel(); model.apply([row('j', 'review', { source: 'harness', provider: 'MiniMax' })]);
  assert.equal(model.current('harness').phase, 'review'); assert.match(phaseLabel(model.current('harness')), /awaiting review/);
});
test('extra raw content never enters the UI model', () => {
  const model = new ActivityModel(); model.apply([row('a', 'working', { prompt: 'secret-canary', arguments: 'secret-canary' })]);
  assert.equal(JSON.stringify(model.rows).includes('secret-canary'), false);
});
test('bad payloads, unknown states and negative revisions are dropped', () => {
  const model = new ActivityModel(); model.apply([null, row('a', 'done'), row('b', 'working', { revision: -1 }), row('c', 'working', { provider: 'x'.repeat(200) })]); assert.equal(model.rows.length, 0);
});
test('models are bounded and do not confuse sources', () => {
  const model = new ActivityModel(); model.apply(Array.from({ length: 200 }, (_, i) => row(String(i), 'working'))); assert.equal(model.rows.length, 24); assert.equal(model.current('harness'), null);
});
