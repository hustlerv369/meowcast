export const SURFACES = [
  { id: "codex", taskId: "integration_codex", name: "Codex", color: "#34D399", source: "codex", button: "Open Codex", detail: "Waiting for a local Codex session" },
  { id: "antigravity", taskId: "integration_harness", name: "Antigravity", color: "#22D3EE", source: "harness", button: "Open IDE", detail: "VS Code sessions and local harness jobs" },
  { id: "claudeDesktop", taskId: "integration_claude_desktop", name: "Claude Desktop", color: "#F5A06A", source: "claudeDesktop", button: "Open Claude", detail: "Desktop app · activity monitoring unavailable" },
  { id: "gemini", taskId: "integration_gemini", name: "Gemini", color: "#60A5FA", source: "gemini", button: "Open Gemini", detail: "Web chat through your subscription" },
  { id: "cursor", taskId: "integration_cursor", name: "Cursor", color: "#C4B5FD", source: "cursor", button: "Open Cursor", detail: "Composer jobs through the local harness" },
] as const;

export type SurfaceId = typeof SURFACES[number]["id"];
export function surfaceForTask(id: string) { return SURFACES.find(surface => surface.taskId === id); }
