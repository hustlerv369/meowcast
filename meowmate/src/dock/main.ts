import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BotEngine, hexToRGB } from "../mochi/engine";

const canvas = document.querySelector<HTMLCanvasElement>("#bot")!;
const dock = document.querySelector<HTMLButtonElement>("#dock")!;
const activity = document.querySelector<HTMLElement>("#activity")!;
const ctx = canvas.getContext("2d")!;
const engine = new BotEngine();
engine.isMini = true;
engine.fullBody = true;
engine.bodyColor = hexToRGB("#D0D0D0");
engine.setState("idle", true);
dock.title = "Hover to preview · drag to move to a screen edge";
dock.addEventListener("pointerdown", (event) => {
  if (event.button === 0) { event.preventDefault(); void invoke("dock_press"); }
});
// Mouse clicks are completed by the native press/drag controller, keyboard here.
dock.addEventListener("click", (event) => { if (event.detail === 0) void invoke("dock_open"); });
if ("__TAURI_INTERNALS__" in window) {
  void listen<boolean>("dock-drop-state", ({payload}) => {
    dock.classList.toggle("drop-over",payload);
    dock.querySelector(".name")!.textContent=payload ? "Attach files" : "Meowmate";
  });
  void listen<{color:string;working:number}>("taskbar-status", ({payload}) => {
    engine.setState(payload.working > 0 ? "working" : "idle", true);
    activity.textContent = payload.working > 0 ? String(payload.working) : "";
  });
}
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let previous = 0;
function frame(now:number) {
  requestAnimationFrame(frame);
  if (document.hidden || now-previous < (reduced.matches ? 500 : 100)) return;
  const dt = Math.min(.15,(now-previous)/1000); previous=now;
  const dpr=Math.min(2,devicePixelRatio||1);
  const light = matchMedia("(prefers-color-scheme: light)").matches;
  engine.bodyColor = hexToRGB(light ? "#505050" : "#D0D0D0");
  engine.faceColor = light ? "#F5F5F5" : "#202020";
  if (canvas.width!==Math.round(44*dpr)) { canvas.width=Math.round(44*dpr);canvas.height=canvas.width; }
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,44,44);
  if (!reduced.matches) engine.update(dt);
  engine.draw(ctx,44,44);
}
requestAnimationFrame(frame);
