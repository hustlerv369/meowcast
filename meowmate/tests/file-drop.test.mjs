import test from "node:test";
import assert from "node:assert/strict";
import { FileDropTransaction } from "../src/core/file-drop.ts";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("a slow drop exposes no source path or ready attachment until copy completes", async () => {
  const drop = new FileDropTransaction();
  const copy = deferred();
  let attachment = { name: "existing.txt", path: "inbox/existing.txt" };
  const pending = drop.run(["D:/new.txt"], () => copy.promise, file => { attachment = file; });
  assert.equal(drop.busy, true);
  assert.equal(drop.pendingName, "new.txt");
  assert.equal(attachment.path, "inbox/existing.txt");
  copy.resolve({ name: "new.txt", path: "inbox/new-unique.txt" });
  assert.equal(await pending, true);
  assert.equal(attachment.path, "inbox/new-unique.txt");
  assert.equal(drop.busy, false);
});

test("failed copying preserves the existing attachment and releases the drop slot", async () => {
  const drop = new FileDropTransaction();
  let committed = false;
  await assert.rejects(drop.run(["D:/missing.txt"], async () => { throw new Error("missing"); }, () => { committed = true; }), /missing/);
  assert.equal(committed, false);
  assert.equal(drop.busy, false);
  assert.equal(drop.pendingName, "");
});

test("multi-file and overlapping drops are rejected without silently consuming files", async () => {
  const drop = new FileDropTransaction();
  let copies = 0;
  const copy = deferred();
  const pending = drop.run(["D:/first.txt"], () => { copies++; return copy.promise; }, () => {});
  await assert.rejects(drop.run(["D:/second.txt"], async () => { copies++; return {}; }, () => {}), /still being prepared/);
  assert.equal(drop.busy, true);
  copy.resolve({ name: "first.txt", path: "inbox/first.txt" });
  await pending;
  await assert.rejects(drop.run(["D:/a.txt", "D:/b.txt"], async () => { copies++; return {}; }, () => {}), /Drop one file/);
  assert.equal(copies, 1);
});

test("an invalidated slow result cannot replace a newer user choice", async () => {
  const drop = new FileDropTransaction();
  const copy = deferred();
  let committed = false;
  const pending = drop.run(["D:/old.txt"], () => copy.promise, () => { committed = true; });
  drop.invalidate();
  assert.equal(drop.busy, true);
  copy.resolve({ name: "old.txt", path: "inbox/old.txt" });
  assert.equal(await pending, false);
  assert.equal(committed, false);
  assert.equal(drop.busy, false);
});
