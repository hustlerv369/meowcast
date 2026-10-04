import type { WebContents } from "electron";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeSelection } from "./NativeSelection";
const state = vi.hoisted(() => ({
    responses: [] as Record<string, unknown>[],
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    calls: 0,
}));
vi.mock("electron", () => ({
    BrowserWindow: { fromWebContents: () => ({ show: state.show, hide: state.hide, focus: state.focus }) },
}));
vi.mock("node:child_process", () => ({
    spawn: () => {
        state.calls++;
        const process = new EventEmitter() as EventEmitter & {
            stdout: EventEmitter;
            stderr: { resume: () => void };
            stdin: EventEmitter & { end: (text: string) => void };
            kill: () => void;
        };
        process.stdout = new EventEmitter();
        process.stderr = { resume: () => undefined };
        process.kill = () => undefined;
        process.stdin = new EventEmitter() as typeof process.stdin;
        process.stdin.end = () =>
            queueMicrotask(() => {
                process.stdout.emit(
                    "data",
                    Buffer.from(JSON.stringify(state.responses.shift() ?? { error: "Unavailable" })),
                );
                process.emit("close");
            });
        return process;
    },
}));
const target = () => Object.assign(new EventEmitter(), { id: 1 }) as unknown as WebContents;
const captureResult = { text: "sample", hwnd: "17", pid: 77, identity: "1,2", rangeStart: 4, editable: true };
beforeEach(() => {
    state.responses = [];
    state.calls = 0;
    vi.clearAllMocks();
    vi.restoreAllMocks();
});
describe.skipIf(process.platform !== "win32")("Native selection lifecycle", () => {
    it("rejects another renderer's token without running a helper", async () => {
        const selection = new NativeSelection();
        const owner = target();
        state.responses.push(captureResult);
        const result = await selection.capture(owner, false);
        await expect(selection.insert({ id: 2 } as WebContents, result!.token, "replacement")).rejects.toThrow(
            "expired",
        );
        expect(state.calls).toBe(1);
    });
    it("expires captures after five minutes without native dispatch", async () => {
        const now = vi.spyOn(Date, "now").mockReturnValue(1000);
        const selection = new NativeSelection();
        const owner = target();
        state.responses.push(captureResult);
        const result = await selection.capture(owner, false);
        now.mockReturnValue(302000);
        await expect(selection.insert(owner, result!.token, "replacement")).rejects.toThrow("expired");
        expect(selection.latest(owner)).toBeNull();
        expect(state.calls).toBe(1);
    });
    it("consumes a failed insertion and restores launcher", async () => {
        const selection = new NativeSelection();
        const owner = target();
        state.responses.push(captureResult, { error: "Selection changed" });
        const result = await selection.capture(owner, false);
        state.show.mockClear();
        await expect(selection.insert(owner, result!.token, "replacement")).rejects.toThrow("Selection changed");
        expect(state.show).toHaveBeenCalledOnce();
        await expect(selection.insert(owner, result!.token, "replacement")).rejects.toThrow("expired");
        expect(state.calls).toBe(2);
    });
    it("drops captured content when renderer is destroyed", async () => {
        const selection = new NativeSelection();
        const owner = target();
        state.responses.push(captureResult);
        await selection.capture(owner, false);
        owner.emit("destroyed");
        expect(selection.latest(owner)).toBeNull();
    });
    it("does not dispatch a read-only selection", async () => {
        const selection = new NativeSelection();
        const owner = target();
        state.responses.push({ ...captureResult, editable: false });
        const result = await selection.capture(owner, false);
        await expect(selection.insert(owner, result!.token, "replacement")).rejects.toThrow("cannot be edited");
        expect(state.calls).toBe(1);
    });
});
