import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IslandStateMachine } from '../src/island/fsm.ts';

function fixture() {
  let id = 0;
  const timers = new Map();
  globalThis.window = {
    setTimeout(fn) { timers.set(++id, fn); return id; },
    clearTimeout(key) { timers.delete(key); },
  };
  const fsm = new IslandStateMachine();
  const tick = () => {
    const due = [...timers.entries()];
    for (const [key, fn] of due) if (timers.delete(key)) fn();
  };
  return { fsm, tick };
}

test('startup stays closed until explicit opening; close can reopen', () => {
  const { fsm, tick } = fixture();
  tick(); assert.equal(fsm.state, 'hidden');
  fsm.forceHome(); assert.equal(fsm.state, 'home');
  fsm.forcePetit(); fsm.forceHidden(); assert.equal(fsm.state, 'hidden');
  fsm.forceHome(); assert.equal(fsm.state, 'home');
});

test('editing or streaming holds open past a previously scheduled timer', () => {
  const { fsm, tick } = fixture();
  let editing = false;
  fsm.keepOpen = () => editing;
  fsm.forceHome(); fsm.mouseLeft(); editing = true;
  tick(); tick(); assert.equal(fsm.state, 'home');
  editing = false; tick(); assert.equal(fsm.state, 'petit');
});

test('explicit close cancels timers even while chat holds open', () => {
  const { fsm, tick } = fixture();
  fsm.keepOpen = () => true;
  fsm.forceHome(); fsm.mouseLeft(); fsm.forceHidden();
  tick(); assert.equal(fsm.state, 'hidden');
});

test('approval pin set after scheduling cannot be closed by the old timer', () => {
  const { fsm, tick } = fixture();
  fsm.forceHome(); fsm.mouseLeft(); fsm.pinned = true;
  tick(); assert.equal(fsm.state, 'home');
  fsm.pinned = false; fsm.mouseLeft(); tick(); assert.equal(fsm.state, 'petit');
});
