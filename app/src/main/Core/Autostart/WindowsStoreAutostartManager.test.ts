import type { FileSystemUtility } from "@Core/FileSystemUtility";
import type { Logger } from "@Core/Logger";
import type { App, Shell } from "electron";
import { describe, expect, it, vi } from "vitest";
import { WindowsStoreAutostartManager } from "./WindowsStoreAutostartManager";
describe("Store shortcut identity", () => {
    it("targets this reserved package, never the upstream Ueli package", () => {
        const writeShortcutLink = vi.fn();
        const manager = new WindowsStoreAutostartManager(
            { getPath: () => "profile" } as unknown as App,
            { writeShortcutLink } as unknown as Shell,
            { existsSync: () => false } as unknown as FileSystemUtility,
            {} as Logger,
        );
        manager.setAutostartOptions(true);
        expect(writeShortcutLink).toHaveBeenCalledWith(expect.any(String), "create", {
            target: "shell:AppsFolder\\VojtaCode.Meowcast_kxn7qcvvd196g!Meowcast",
        });
    });
});
