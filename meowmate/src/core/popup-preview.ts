export type DockEdge = "bottom" | "top" | "left" | "right";

/** Keeps hover intent separate from an explicitly opened or edited popup. */
export class PopupPreview {
  active = false;
  inside = true;

  open(preview: boolean) {
    this.active = preview;
    this.inside = true;
  }

  engage() { this.active = false; }

  shouldClose(held: boolean) {
    return this.active && !this.inside && !held;
  }
}

/** Native hit testing and the visible shape must share exactly this origin. */
export function popupShape(edge: DockEdge, viewportWidth: number, viewportHeight: number, w: number, h: number) {
  w = Math.min(w, Math.max(0, viewportWidth));
  h = Math.min(h, Math.max(0, viewportHeight));
  return {
    x: edge === "left" ? 0 : edge === "right" ? viewportWidth - w : (viewportWidth - w) / 2,
    y: edge === "top" ? 0 : viewportHeight - h,
    w,
    h,
  };
}
