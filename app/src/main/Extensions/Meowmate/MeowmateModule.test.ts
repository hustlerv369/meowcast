import type { SearchResultItemAction } from "@common/Core";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companionPath, MeowmateExtension } from "./MeowmateModule";

const mocks = vi.hoisted(() => ({ access: vi.fn(), openPath: vi.fn() }));
vi.mock("electron", () => ({
    app: { isPackaged: false, getAppPath: () => "source" },
    shell: { openPath: mocks.openPath },
}));
vi.mock("node:fs/promises", () => ({ access: mocks.access }));

describe("Meowmate companion boundary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(MeowmateExtension.prototype, "isSupported").mockReturnValue(true);
        mocks.access.mockResolvedValue(undefined);
        mocks.openPath.mockResolvedValue("");
    });
    it("rejects invocation on unsupported platforms", async () => {
        vi.spyOn(MeowmateExtension.prototype, "isSupported").mockReturnValue(false);
        await expect(
            new MeowmateExtension().invokeAction({ argument: "open" } as SearchResultItemAction),
        ).rejects.toThrow("Windows companion edition");
        expect(mocks.openPath).not.toHaveBeenCalled();
    });
    it("resolves only the bundled executable", () => {
        expect(companionPath(true, "resources", "source")).toBe(join("resources", "meowmate", "coucou.exe"));
        expect(companionPath(false, "resources", "source")).toBe(join("source", "companion", "meowmate", "coucou.exe"));
    });
    it("rejects arbitrary launch arguments", async () => {
        await expect(
            new MeowmateExtension().invokeAction({ argument: "calc.exe" } as SearchResultItemAction),
        ).rejects.toThrow("Unknown");
        expect(mocks.openPath).not.toHaveBeenCalled();
    });
    it("reports missing payload without launching", async () => {
        mocks.access.mockRejectedValueOnce(new Error("missing"));
        await expect(
            new MeowmateExtension().invokeAction({ argument: "open" } as SearchResultItemAction),
        ).rejects.toThrow("not included");
        expect(mocks.openPath).not.toHaveBeenCalled();
    });
    it("opens the bundled companion and handles OS launch errors", async () => {
        const extension = new MeowmateExtension();
        await extension.invokeAction({ argument: "open" } as SearchResultItemAction);
        expect(mocks.openPath).toHaveBeenCalledWith(join("source", "companion", "meowmate", "coucou.exe"));
        mocks.openPath.mockResolvedValueOnce("OS path details");
        await expect(extension.invokeAction({ argument: "open" } as SearchResultItemAction)).rejects.toThrow(
            "could not be opened",
        );
    });
});
