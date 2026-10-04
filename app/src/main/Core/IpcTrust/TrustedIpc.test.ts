import type { BrowserWindow, IpcMain, IpcMainEvent } from "electron";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createSenderValidator, protectIpcMain } from "./TrustedIpc";
const directory = join(process.cwd(), "dist-renderer");
const url = pathToFileURL(join(directory, "search.html")).href;
const fixture = (value = url) => {
    const frame = { url: value };
    const sender = { mainFrame: frame, getURL: () => value, isDestroyed: () => false };
    const event = { sender, senderFrame: frame } as unknown as IpcMainEvent;
    const window = { webContents: sender, isDestroyed: () => false } as unknown as BrowserWindow;
    return { event, window };
};
describe("IPC sender boundary", () => {
    it.each(["search.html", "settings.html"])("accepts exact bundled %s with route/query", (file) => {
        const f = fixture(`${pathToFileURL(join(directory, file)).href}?mode=1#/route`);
        expect(
            createSenderValidator({ windows: () => [f.window], rendererDirectory: directory, isPackaged: true })(
                f.event,
            ),
        ).toBe(true);
    });
    it("rejects child frames, foreign windows, missing or destroyed sender", () => {
        const f = fixture();
        const validate = createSenderValidator({
            windows: () => [f.window],
            rendererDirectory: directory,
            isPackaged: true,
        });
        expect(validate({ ...f.event, senderFrame: { url } } as IpcMainEvent)).toBe(false);
        expect(validate(fixture().event)).toBe(false);
        expect(validate({} as IpcMainEvent)).toBe(false);
        expect(validate(null as unknown as IpcMainEvent)).toBe(false);
        f.event.sender.isDestroyed = () => true;
        expect(validate(f.event)).toBe(false);
    });
    it.each([
        "https://evil.example/search.html",
        "file:///other/search.html",
        "not a URL",
        `${url}.evil`,
        "about:blank",
    ])("rejects URL %s", (value) => {
        const f = fixture(value);
        expect(
            createSenderValidator({ windows: () => [f.window], rendererDirectory: directory, isPackaged: true })(
                f.event,
            ),
        ).toBe(false);
    });
    it("allows only exact configured dev page when unpackaged", () => {
        for (const [value, packaged, expected] of [
            ["http://localhost:5173/search.html#/home", false, true],
            ["http://localhost:5173/search.html", true, false],
            ["http://localhost:5174/search.html", false, false],
            ["http://localhost:5173/remote.html", false, false],
        ] as const) {
            const f = fixture(value);
            expect(
                createSenderValidator({
                    windows: () => [f.window],
                    rendererDirectory: directory,
                    isPackaged: packaged,
                    devServerUrl: "http://localhost:5173",
                })(f.event),
            ).toBe(expected);
        }
    });
});
const ipcFixture = () => {
    const emitter = new EventEmitter();
    const handlers = new Map<string, (event: IpcMainEvent) => unknown>();
    const raw = Object.assign(emitter, {
        handle: (channel: string, handler: (event: IpcMainEvent) => unknown) => handlers.set(channel, handler),
        removeHandler: (channel: string) => handlers.delete(channel),
    });
    const trusted = fixture().event;
    const ipc = protectIpcMain(raw as unknown as IpcMain, (event) => event === trusted);
    return { raw, handlers, trusted, ipc };
};
describe("IPC guarded dispatch", () => {
    it("finishes denied sync calls without invoking listener", () => {
        const f = ipcFixture(),
            handler = vi.fn(),
            denied = {} as IpcMainEvent;
        f.ipc.on("sync", handler);
        f.raw.emit("sync", denied);
        expect(handler).not.toHaveBeenCalled();
        expect(denied.returnValue).toBeNull();
        f.raw.emit("sync", f.trusted);
        expect(handler).toHaveBeenCalledOnce();
    });
    it("does not consume once listener on an untrusted call", () => {
        const f = ipcFixture(),
            handler = vi.fn();
        f.ipc.once("once", handler);
        f.raw.emit("once", {});
        f.raw.emit("once", f.trusted);
        f.raw.emit("once", f.trusted);
        expect(handler).toHaveBeenCalledOnce();
    });
    it("preserves listener removal and duplicate registration semantics", () => {
        const f = ipcFixture(),
            handler = vi.fn();
        f.ipc.on("a", handler).on("a", handler).on("b", handler);
        f.ipc.removeListener("a", handler);
        f.raw.emit("a", f.trusted);
        expect(handler).toHaveBeenCalledOnce();
        f.ipc.off("a", handler);
        f.ipc.removeAllListeners("b");
        expect(f.raw.listenerCount("a") + f.raw.listenerCount("b")).toBe(0);
    });
    it("rejects invoke and keeps handleOnce available for trusted caller", () => {
        const f = ipcFixture(),
            handler = vi.fn(() => "ok");
        f.ipc.handleOnce("invoke", handler);
        expect(() => f.handlers.get("invoke")!({} as IpcMainEvent)).toThrow("IPC sender is not trusted");
        expect(handler).not.toHaveBeenCalled();
        expect(f.handlers.get("invoke")!(f.trusted)).toBe("ok");
        expect(f.handlers.has("invoke")).toBe(false);
    });
});
