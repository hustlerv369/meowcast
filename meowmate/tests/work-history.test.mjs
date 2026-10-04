import test from "node:test";
import assert from "node:assert/strict";
import { mergeWorkJob, mergeWorkSnapshot } from "../src/core/work-history.ts";

const job = (id, status, updatedMs, startedMs = updatedMs) => ({
  id, status, updatedMs, startedMs, project: "D:\\Fixture", projectName: "Fixture",
  provider: "codex", model: "fixture", prompt: "Fixture task", text: "", step: null, error: null,
});

test("late start acknowledgment cannot replace terminal event", () => {
  const jobs = new Map();
  mergeWorkJob(jobs, job("a", "completed", 20));
  mergeWorkJob(jobs, job("a", "running", 10));
  mergeWorkJob(jobs, job("a", "running", 20));
  assert.equal(jobs.get("a").status, "completed");
});

test("old snapshot preserves newer stream and removes expired history", () => {
  const jobs = new Map([["a", job("a", "completed", 30)], ["old", job("old", "completed", 5)], ["new", job("new", "running", 35)]]);
  mergeWorkSnapshot(jobs, [job("a", "running", 10)], 20);
  assert.equal(jobs.get("a").status, "completed");
  assert.equal(jobs.has("old"), false);
  assert.equal(jobs.has("new"), true);
});

test("history retains active jobs and newest results within forty slots", () => {
  const jobs = new Map([["active", job("active", "running", 1)]]);
  for (let n = 2; n < 52; n++) mergeWorkJob(jobs, job(`j${n}`, "completed", n));
  assert.equal(jobs.size, 40);
  assert.equal(jobs.has("active"), true);
  assert.equal(jobs.has("j2"), false);
  assert.equal(jobs.has("j51"), true);
});
