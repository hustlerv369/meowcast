// Original Týpek cat artwork. SVG paths are shared by Canvas and SVG export;
// no upstream character geometry or expression assets are used here.
export const CAT_HEAD = "M-24-4 L-26-27 Q-25-31-22-28 L-10-18 Q0-22 10-18 L22-28 Q25-31 26-27 L24-4 Q29 5 23 17 Q16 28 0 28 Q-16 28-23 17 Q-29 5-24-4Z";
export const CAT_MARKS = "M-22 12 L-12 13 M22 12 L12 13";
export const CAT_NOSE = "M-3 10 L3 10 L0 14Z M0 14 Q-4 20-8 16 M0 14 Q4 20 8 16";
export const CAT_BODY = "M-10 1 Q-18 12-14 27 Q-10 32 0 27 Q10 32 14 27 Q18 12 10 1Z";
export type CatExpression = "calm" | "alert" | "happy" | "sleepy";
export const CAT_EYES: Record<CatExpression, string> = {
  calm: "M-13 1 L-8 3 M8 3 L13 1",
  alert: "M-11-1 L-11 6 M11-1 L11 6",
  happy: "M-15 5 Q-11-3-7 5 M7 5 Q11-3 15 5",
  sleepy: "M-15 4 L-7 4 M7 4 L15 4",
};
export const catExpression = (state: string): CatExpression =>
  state === "finished" || state === "happy" ? "happy" :
  state === "sleeping" || state === "closed" || state === "tired" ? "sleepy" :
  ["approval", "question", "error", "wide"].includes(state) ? "alert" : "calm";

export function catSvg(expression: CatExpression = "calm"): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-34 -34 68 68" fill="none"><path d="${CAT_HEAD}" fill="#D0D0D0"/><g stroke="#202020" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="${CAT_MARKS}"/><path d="${CAT_EYES[expression]}"/><path d="${CAT_NOSE}"/></g></svg>`;
}

export function drawCat(context: CanvasRenderingContext2D, radius: number, expression: CatExpression, color = "#D0D0D0", ink = "#202020") {
  context.save();
  context.scale(radius / 30, radius / 30);
  context.fillStyle = color;
  context.fill(new Path2D(CAT_HEAD));
  context.strokeStyle = ink;
  context.lineWidth = 2.5;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const path of [CAT_MARKS, CAT_EYES[expression], CAT_NOSE]) context.stroke(new Path2D(path));
  context.restore();
}

export function drawCatCompanion(context: CanvasRenderingContext2D, radius: number, expression: CatExpression, color = "#D0D0D0", ink = "#202020") {
  context.save();
  context.scale(radius / 30, radius / 30);
  context.strokeStyle = color;
  context.lineWidth = 5;
  context.lineCap = "round";
  context.stroke(new Path2D("M12 23 Q29 27 26 11"));
  context.fillStyle = color;
  context.fill(new Path2D(CAT_BODY));
  context.strokeStyle = ink;
  context.lineWidth = 1.5;
  context.stroke(new Path2D("M-6 15 L-6 26 M6 15 L6 26"));
  context.translate(0, -10);
  drawCat(context, 20, expression, color, ink);
  context.restore();
}
