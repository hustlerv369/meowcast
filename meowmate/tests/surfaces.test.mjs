import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SURFACES } from '../src/core/surfaces.ts';
import { ActivityModel } from '../src/core/activity.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = fileURLToPath(new URL('../target/qa/state.mjs', import.meta.url));
execFileSync(process.execPath, ['node_modules/esbuild/bin/esbuild', 'src/core/state.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`], { cwd: root, stdio: 'pipe' });
const { State } = await import(pathToFileURL(bundle).href);

test('Codex is the default and four personal surfaces keep their requested order', () => {
  State.tasks = []; State.focusId = null; State.settings.activeIntegrations = []; State.loadIntegrationTasks();
  assert.equal(State.focusTask.id, 'integration_codex');
  assert.deepEqual(State.otherTasks.map(task => task.id), ['integration_harness', 'integration_claude_desktop', 'integration_gemini', 'integration_cursor']);
  assert.equal(new Set(SURFACES.map(surface => surface.color)).size, 5);
});

test('turning off an observer keeps its app shortcut and preserves a chosen surface', () => {
  State.setFocus('integration_gemini'); State.settings.monitorCodex = false; State.settings.monitorHarness = false; State.loadIntegrationTasks();
  assert.equal(State.focusTask.id, 'integration_gemini');
  assert.equal(State.tasks.filter(task => SURFACES.some(surface => surface.taskId === task.id)).length, 5);
});

const row = (id, source, provider) => ({ id, source, provider, host: 'Host', project: 'Demo', phase: 'working', tool: '', updatedMs: 100, revision: 1, stale: false, restored: false });
test('Cursor and Gemini jobs do not masquerade as general IDE activity', () => {
  const model = new ActivityModel();
  model.apply([row('c', 'harness', 'Cursor Composer'), row('g', 'harness', 'Gemini'), row('m', 'harness', 'MiniMax'), row('cc', 'claudeCode', 'Claude Code')]);
  assert.deepEqual(model.forPanel('cursor').map(row => row.id), ['c']);
  assert.deepEqual(model.forPanel('gemini').map(row => row.id), ['g']);
  assert.deepEqual(model.forPanel('harness').map(row => row.id).sort(), ['cc', 'm']);
  assert.equal(model.forPanel('codex').length, 0);
});

test('IDE selection can choose Claude Code and cannot select a different provider panel', () => {
  const model = new ActivityModel(); model.apply([row('c', 'harness', 'Cursor Composer'), row('m', 'harness', 'MiniMax'), row('cc', 'claudeCode', 'Claude Code')]);
  model.choosePanel('harness', 'cc'); assert.equal(model.currentPanel('harness').id, 'cc');
  model.choosePanel('harness', 'c'); assert.equal(model.currentPanel('harness').id, 'cc');
  model.apply([row('m', 'harness', 'MiniMax')]); assert.equal(model.currentPanel('harness').id, 'm');
});
