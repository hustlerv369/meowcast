// Pure metadata model. No browser globals or approval commands.
export type ActivitySource = "codex" | "claudeCode" | "harness";
export type ActivityPanel = ActivitySource | "cursor" | "gemini";
export type ActivityPhase = "thinking" | "working" | "waiting" | "review" | "finished" | "error" | "cancelled" | "idle";
export interface Activity {
  id: string;
  source: ActivitySource;
  provider: string;
  host: string;
  project: string;
  phase: ActivityPhase;
  tool: string;
  updatedMs: number;
  stale: boolean;
  restored: boolean;
  revision: number;
}

const sources = new Set(["codex", "claudeCode", "harness"]);
const phases = new Set(["thinking", "working", "waiting", "review", "finished", "error", "cancelled", "idle"]);
const priority: Record<ActivityPhase, number> = { waiting: 7, review: 6, working: 5, thinking: 4, error: 3, finished: 2, cancelled: 1, idle: 0 };

function valid(value: unknown): value is Activity {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && row.id.length <= 160 && sources.has(String(row.source)) && phases.has(String(row.phase))
    && [row.provider, row.host, row.project, row.tool].every(v => typeof v === "string" && v.length <= 96)
    && Number.isSafeInteger(row.updatedMs) && Number(row.updatedMs) >= 0 && Number.isSafeInteger(row.revision) && Number(row.revision) >= 0
    && typeof row.stale === "boolean" && typeof row.restored === "boolean";
}

export class ActivityModel {
  rows: Activity[] = [];
  private selected = new Map<ActivityPanel, string>();
  apply(input: unknown): void {
    this.rows = Array.isArray(input) ? input.filter(valid).slice(0, 24).map(r => ({
      id: r.id, source: r.source, provider: r.provider, host: r.host, project: r.project, phase: r.phase,
      tool: r.tool, updatedMs: r.updatedMs, stale: r.stale, restored: r.restored, revision: r.revision,
    })) : [];
  }
  forSource(source: ActivitySource): Activity[] {
    return this.rows.filter(r => r.source === source).sort((a, b) => b.updatedMs - a.updatedMs);
  }
  choose(source: ActivitySource, id: string): void {
    if (this.rows.some(r => r.source === source && r.id === id)) this.selected.set(source, id);
  }
  forPanel(panel: ActivityPanel): Activity[] {
    return this.rows.filter(row => panel === "cursor" ? row.source === "harness" && row.provider.startsWith("Cursor ")
      : panel === "gemini" ? row.source === "harness" && row.provider === "Gemini"
      : panel === "harness" ? row.source === "claudeCode" || row.source === "harness" && !row.provider.startsWith("Cursor ") && row.provider !== "Gemini"
      : row.source === panel).sort((a, b) => b.updatedMs - a.updatedMs);
  }
  choosePanel(panel: ActivityPanel, id: string): void {
    if (this.forPanel(panel).some(row => row.id === id)) this.selected.set(panel, id);
  }
  currentPanel(panel: ActivityPanel): Activity | null {
    const rows = this.forPanel(panel);
    return rows.find(row => row.id === this.selected.get(panel)) ?? rows.sort((a, b) => (b.stale ? 0 : priority[b.phase]) - (a.stale ? 0 : priority[a.phase]) || b.updatedMs - a.updatedMs)[0] ?? null;
  }
  current(source: ActivitySource): Activity | null {
    const rows = this.forSource(source);
    const selected = rows.find(r => r.id === this.selected.get(source));
    return selected ?? rows.sort((a, b) => (b.stale ? 0 : priority[b.phase]) - (a.stale ? 0 : priority[a.phase]) || b.updatedMs - a.updatedMs)[0] ?? null;
  }
}

export const ActivityState = new ActivityModel();
export function sourceLabel(source: string): string {
  const labels: Record<string, string> = { codex: "Codex", harness: "VS Code / harness", claudeCode: "Claude Code", claudeDesktop: "Claude Desktop", gemini: "Gemini", cursor: "Cursor" };
  return labels[source] ?? "n8n";
}
export function phaseLabel(row: Activity): string {
  if (row.stale) return "No recent activity";
  const labels: Record<ActivityPhase, string> = { thinking: "Thinking", working: "Working", waiting: "Action needed in source app", review: "Worker awaiting review", finished: "Completed", error: "Error in source app", cancelled: "Cancelled", idle: "Idle" };
  return labels[row.phase];
}
