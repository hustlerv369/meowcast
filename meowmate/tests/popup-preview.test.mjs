import test from "node:test";
import assert from "node:assert/strict";
import { PopupPreview, popupShape } from "../src/core/popup-preview.ts";

test("an accidental hover can close without ever entering the popup", () => {
  const preview = new PopupPreview();
  preview.open(true);
  preview.inside = false;
  assert.equal(preview.shouldClose(false), true);
});

test("dock/popup seam and active interaction hold the preview, explicit use ends preview", () => {
  const preview = new PopupPreview();
  preview.open(true);
  assert.equal(preview.shouldClose(false), false);
  preview.inside = false;
  assert.equal(preview.shouldClose(true), false);
  preview.engage();
  assert.equal(preview.shouldClose(false), false);
  preview.open(false);
  preview.inside = false;
  assert.equal(preview.shouldClose(false), false);
});

test("the visible popup touches each dock edge and shares native hit-test coordinates", () => {
  assert.deepEqual(popupShape("bottom", 720, 320, 640, 160), { x: 40, y: 160, w: 640, h: 160 });
  assert.deepEqual(popupShape("top", 720, 320, 640, 160), { x: 40, y: 0, w: 640, h: 160 });
  assert.deepEqual(popupShape("left", 720, 320, 640, 160), { x: 0, y: 160, w: 640, h: 160 });
  assert.deepEqual(popupShape("right", 720, 320, 640, 160), { x: 80, y: 160, w: 640, h: 160 });
});

test("oversized animated panels stay inside small high-DPI native viewports", () => {
  for (const edge of ["bottom", "top", "left", "right"]) {
    for (const [width, height] of [[360, 260], [700, 480], [720, 520]]) {
      const shape = popupShape(edge, width, height, 740, 550);
      assert.ok(shape.x >= 0 && shape.y >= 0);
      assert.ok(shape.x + shape.w <= width && shape.y + shape.h <= height);
    }
  }
});
