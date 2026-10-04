import type { WorkJob } from "./bridge";

export function mergeWorkJob(jobs: Map<string, WorkJob>, next: WorkJob): void {
  const previous = jobs.get(next.id);
  if (previous && (previous.updatedMs > next.updatedMs ||
    previous.updatedMs === next.updatedMs && previous.status !== "running" && next.status === "running")) return;
  jobs.set(next.id, next);
  const terminal = [...jobs.values()].filter(j => j.status !== "running").sort((a, b) => a.startedMs - b.startedMs);
  while (jobs.size > 40 && terminal.length) jobs.delete(terminal.shift()!.id);
}

export function mergeWorkSnapshot(jobs: Map<string, WorkJob>, rows: WorkJob[], requestedMs: number): void {
  const ids = new Set(rows.map(j => j.id));
  for (const [id, job] of jobs) if (!ids.has(id) && job.updatedMs <= requestedMs) jobs.delete(id);
  for (const row of rows) mergeWorkJob(jobs, row);
}
