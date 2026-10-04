import { ActivityState, phaseLabel, type ActivityPanel } from "../core/activity";
import { Bridge, onEvent } from "../core/bridge";
import { State } from "../core/state";
import { Sound } from "../core/sound";
import type { Island } from "./island";

const ids: Partial<Record<ActivityPanel, string>> = { codex: "integration_codex", harness: "integration_harness", cursor: "integration_cursor", gemini: "integration_gemini" };
const last = new Map<string, { phase: string; at: number }>();

export function syncActivities(island: Island, live = false) {
  if (State.paused) return;
  const visible = new Set(ActivityState.rows.map(row => row.id));
  for (const id of last.keys()) if (!visible.has(id)) last.delete(id);
  for (const source of ["codex", "harness", "cursor", "gemini"] as const) {
    const task = State.tasks.find(t => t.id === ids[source]);
    if (!task) continue;
    const row = ActivityState.currentPanel(source);
    if (!row) {
      task.activityId = null;
      task.state = "idle"; task.steps = []; task.name = source === "codex" ? "Codex" : source === "harness" ? "Antigravity" : source === "cursor" ? "Cursor" : "Gemini"; task.pillBadge = null;
      continue;
    }
    task.activityId = row.id;
    task.name = row.project;
    task.state = row.phase === "waiting" || row.phase === "review" ? "question" : row.phase === "cancelled" ? "idle" : row.phase;
    task.steps = [row.host, row.provider, ...(row.tool && row.phase === "working" ? [`Tool: ${row.tool}`] : []), phaseLabel(row)];
    task.stepIndex = task.steps.length - 1;
    const previous = last.get(row.id);
    const changed = previous?.phase !== row.phase || previous.at !== row.updatedMs;
    if (changed) {
      task.pillBadge = row.stale ? null : row.phase === "finished" ? "finished" : row.phase === "error" ? "error" : null;
      if (live && !row.restored && !row.stale && previous && row.updatedMs > previous.at && previous.phase !== row.phase) {
        if (row.phase === "finished") Sound.play("finish");
        if (row.phase === "error") Sound.play("error");
        if (row.phase === "waiting" || row.phase === "review") { State.setFocus(task.id); island.alert("overview"); }
      }
      last.set(row.id, { phase: row.phase, at: row.updatedMs });
    }
    if (live && changed && !row.stale && !row.restored && State.mode === "hidden" && ["working", "thinking"].includes(row.phase)) island.reveal();
  }
  State.notify();
}

export async function registerActivityHandlers(island: Island) {
  await onEvent<unknown>("local-activity", rows => { ActivityState.apply(rows); syncActivities(island, true); });
  ActivityState.apply(await Bridge.activitySnapshot());
  syncActivities(island);
}
