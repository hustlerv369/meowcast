import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhiteboardExtension } from "./WhiteboardExtension";
const state = vi.hoisted(() => ({
    data: "",
    size: 0,
    unreadable: false,
    missing: true,
    write: vi.fn(),
    rename: vi.fn(),
    dialog: vi.fn(),
    copy: vi.fn(),
    open: vi.fn(),
    unlink: vi.fn(),
    exportWrite: vi.fn(),
    close: vi.fn(),
}));
vi.mock("electron", () => ({
    app: { getPath: () => "/test-profile" },
    BrowserWindow: { fromWebContents: () => ({}) },
    dialog: { showSaveDialog: state.dialog },
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, toPNG: () => Buffer.alloc(0) }) },
}));
vi.mock("node:fs/promises", () => ({
    mkdir: vi.fn(),
    copyFile: state.copy,
    open: state.open,
    unlink: state.unlink,
    writeFile: state.write,
    rename: state.rename,
    stat: async () => {
        if (state.missing) {
            throw Object.assign(new Error(), { code: "ENOENT" });
        }

        return { size: state.size };
    },
    readFile: async () => {
        if (state.unreadable) {
            throw Object.assign(new Error("denied"), { code: "EACCES" });
        }

        return state.data;
    },
}));
beforeEach(() => {
    vi.resetAllMocks();
    state.open.mockResolvedValue({ writeFile: state.exportWrite, close: state.close });
    state.unlink.mockResolvedValue(undefined);
    state.unreadable = false;
    state.missing = true;
    state.data = "";
    state.size = 0;
});
describe("Whiteboard persistence boundary", () => {
    it("starts empty only when no saved board exists", async () => {
        expect(await new WhiteboardExtension().invoke({ command: "load" })).toEqual({
            board: { version: 1, elements: [] },
            recovered: false,
        });
    });
    it("reports corrupt or oversized persistence without overwriting it", async () => {
        state.missing = false;
        state.data = "not JSON";
        expect(await new WhiteboardExtension().invoke({ command: "load" })).toMatchObject({ recovered: true });
        state.size = 256001;
        expect(await new WhiteboardExtension().invoke({ command: "load" })).toMatchObject({ recovered: true });
        expect(state.write).not.toHaveBeenCalled();
    });
    it("rejects invalid saves before touching storage", async () => {
        await expect(
            new WhiteboardExtension().invoke({ command: "save", board: { version: 9, elements: [] } }),
        ).rejects.toThrow();
        expect(state.write).not.toHaveBeenCalled();
    });
    it("writes a validated snapshot through a temporary file before rename", async () => {
        await expect(
            new WhiteboardExtension().invoke({ command: "save", board: { version: 1, elements: [] } }),
        ).resolves.toEqual({ saved: true });
        expect(state.write.mock.calls[0][0]).toContain("whiteboard.json.tmp");
        expect(state.rename).toHaveBeenCalledOnce();
    });
    it("loads the latest snapshot after all already requested saves finish", async () => {
        const extension = new WhiteboardExtension();
        let releaseFirst!: () => void;
        const firstWrite = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        state.write
            .mockImplementationOnce(async (_path, json) => {
                await firstWrite;
                state.data = json;
                state.missing = false;
            })
            .mockImplementationOnce(async (_path, json) => {
                state.data = json;
            });
        const first = extension.invoke({ command: "save", board: { version: 1, elements: [] } });
        const latest = {
            version: 1,
            elements: [{ id: "note-1", kind: "note", color: "#fff0bb", x: 20, y: 20, text: "Latest note" }],
        };
        const second = extension.invoke({ command: "save", board: latest });
        const reopening = extension.invoke({ command: "load" });
        releaseFirst();
        await Promise.all([first, second]);
        expect(await reopening).toEqual({ board: latest, recovered: false });
        expect(state.rename).toHaveBeenCalledTimes(2);
    });
    it("preserves a corrupt original before replacing it, only once after preservation succeeds", async () => {
        state.missing = false;
        state.data = "corrupt original";
        const extension = new WhiteboardExtension();
        await extension.invoke({ command: "load" });
        await extension.invoke({ command: "load" });
        await extension.invoke({ command: "save", board: { version: 1, elements: [] } });
        expect(state.copy).toHaveBeenCalledOnce();
        expect(state.copy.mock.calls[0][1]).toContain("whiteboard.json.recovery-");
        expect(state.copy.mock.invocationCallOrder[0]).toBeLessThan(state.write.mock.invocationCallOrder[0]);
        await extension.invoke({ command: "save", board: { version: 1, elements: [] } });
        expect(state.copy).toHaveBeenCalledOnce();
    });
    it("keeps recovery pending and never writes a replacement when preservation fails", async () => {
        state.missing = false;
        state.size = 256001;
        const extension = new WhiteboardExtension();
        await extension.invoke({ command: "load" });
        state.copy.mockRejectedValueOnce(new Error("backup denied"));
        await expect(extension.invoke({ command: "save", board: { version: 1, elements: [] } })).rejects.toThrow(
            "backup denied",
        );
        expect(state.write).not.toHaveBeenCalled();
        expect(state.rename).not.toHaveBeenCalled();
        await extension.invoke({ command: "save", board: { version: 1, elements: [] } });
        expect(state.copy).toHaveBeenCalledTimes(2);
        expect(state.write).toHaveBeenCalledOnce();
    });
    it("preserves an unreadable board before replacement", async () => {
        state.missing = false;
        state.unreadable = true;
        const extension = new WhiteboardExtension();
        expect(await extension.invoke({ command: "load" })).toMatchObject({ recovered: true });
        await extension.invoke({ command: "save", board: { version: 1, elements: [] } });
        expect(state.copy).toHaveBeenCalledOnce();
        expect(state.copy.mock.invocationCallOrder[0]).toBeLessThan(state.write.mock.invocationCallOrder[0]);
    });
    it("does not back up a missing board", async () => {
        const extension = new WhiteboardExtension();
        await extension.invoke({ command: "load" });
        await extension.invoke({ command: "save", board: { version: 1, elements: [] } });
        expect(state.copy).not.toHaveBeenCalled();
    });
    const png = () => {
        const bytes = Buffer.alloc(24);
        Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
        bytes.writeUInt32BE(1200, 16);
        bytes.writeUInt32BE(760, 20);
        return "data:image/png;base64," + bytes.toString("base64");
    };
    it("keeps an existing export untouched if writing its sibling fails", async () => {
        state.dialog.mockResolvedValue({ canceled: false, filePath: "/chosen/existing.png" });
        state.exportWrite.mockRejectedValue(new Error("disk full"));
        await expect(new WhiteboardExtension().invoke({ command: "export", png: png() }, {} as never)).rejects.toThrow(
            "disk full",
        );
        expect(state.open).toHaveBeenCalledWith(expect.stringContaining("/chosen/existing.png.tmp-"), "wx", 0o600);
        expect(state.write).not.toHaveBeenCalled();
        expect(state.rename).not.toHaveBeenCalled();
        expect(state.close).toHaveBeenCalledOnce();
        expect(state.unlink).toHaveBeenCalledWith(state.open.mock.calls[0][0]);
    });
    it("replaces the chosen export only after a successful sibling write and close", async () => {
        state.dialog.mockResolvedValue({ canceled: false, filePath: "/chosen/existing.png" });
        await expect(new WhiteboardExtension().invoke({ command: "export", png: png() }, {} as never)).resolves.toEqual(
            { exported: true },
        );
        expect(state.rename).toHaveBeenCalledWith(state.open.mock.calls[0][0], "/chosen/existing.png");
        expect(state.close.mock.invocationCallOrder[0]).toBeLessThan(state.rename.mock.invocationCallOrder[0]);
        expect(state.unlink).not.toHaveBeenCalled();
    });
    it("rejects malformed PNG without opening a save dialog", async () => {
        await expect(
            new WhiteboardExtension().invoke({ command: "export", png: "data:image/png;base64,AAAA" }, {} as never),
        ).rejects.toThrow();
        expect(state.dialog).not.toHaveBeenCalled();
    });
});
