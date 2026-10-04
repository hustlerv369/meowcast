import { h, dot } from "./dom";
import { State, type AgentTask } from "../core/state";
import { surfaceForTask, type SurfaceId } from "../core/surfaces";

export function renderSurfaceCard(task: AgentTask, launch: (id: SurfaceId) => Promise<boolean>, work?:()=>void): HTMLElement {
  const surface = surfaceForTask(task.id)!;
  const disabled = task.source === "codex" && !State.settings.monitorCodex
    || task.source === "harness" && !State.settings.monitorHarness && !State.settings.monitorClaude
    || task.source === "cursor" && !State.settings.monitorHarness;
  const note = h("div", { class: "surface-note", text: disabled ? "Local activity monitoring is off" : surface.detail });
  const button = h("button", { class: "surface-open", text: surface.button, style: `--surface-color:${surface.color}` }) as HTMLButtonElement;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (!await launch(surface.id)) note.textContent = "Could not open the application";
    } finally { button.disabled = false; }
  });
  const workButton=work && ["codex","claudeDesktop","antigravity"].includes(surface.id) ? h("button",{class:"surface-open",text:"New task",onclick:work,style:`--surface-color:${surface.color}`}) : null;
  return h("div", { class: "surface-card" }, h("div", { class: "int-head" }, dot(surface.color, 7), h("b", { text: surface.name })), note, h("div",{class:"surface-controls"},workButton,button));
}
