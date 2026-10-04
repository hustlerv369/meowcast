import type { App, NativeTheme } from "electron";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { canShareTheme, startSharedTheme, writeSharedTheme } from "./SharedCompanionTheme";

describe("explicit companion appearance bridge", () => {
    it("excludes custom, development and isolated profiles", () => {
        const base = join("fixture", "roaming");
        const profile = join(base, "HustleCMD");
        const app = {
            isPackaged: true,
            commandLine: { hasSwitch: () => false },
            getPath: (key: string) => (key === "appData" ? base : profile),
        } as unknown as App;
        expect(canShareTheme(app, join(profile, "ueli9.settings.json"))).toBe(true);
        expect(canShareTheme(app, join(base, "other.json"))).toBe(false);
        expect(canShareTheme({ ...app, isPackaged: false }, join(profile, "ueli9.settings.json"))).toBe(false);
        expect(
            canShareTheme(
                { ...app, commandLine: { hasSwitch: () => true } as unknown as App["commandLine"] },
                join(profile, "ueli9.settings.json"),
            ),
        ).toBe(false);
        expect(
            canShareTheme(
                { ...app, getPath: (key: string) => (key === "appData" ? base : "qa") },
                join(profile, "ueli9.settings.json"),
            ),
        ).toBe(false);
    });
    it("publishes settings and native system changes, then removes listener", () => {
        const theme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false });
        const publish = vi.fn();
        let source: "system" | "dark" = "system";
        const bridge = startSharedTheme(theme as NativeTheme, () => source, publish);
        expect(publish).toHaveBeenLastCalledWith({ version: 1, source: "system", resolved: "light" });
        theme.shouldUseDarkColors = true;
        theme.emit("updated");
        expect(publish).toHaveBeenLastCalledWith({ version: 1, source: "system", resolved: "dark" });
        source = "dark";
        bridge.update();
        expect(publish).toHaveBeenLastCalledWith({ version: 1, source: "dark", resolved: "dark" });
        bridge.dispose();
        expect(theme.listenerCount("updated")).toBe(0);
    });
    it("writes only the bounded appearance object and replaces a prior value", () => {
        const folder = mkdtempSync(join(tmpdir(), "meowcast-theme-test-"));

        try {
            const file = join(folder, "theme.json");
            writeSharedTheme(file, { version: 1, source: "light", resolved: "light" });
            writeSharedTheme(file, { version: 1, source: "dark", resolved: "dark" });
            expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, source: "dark", resolved: "dark" });
        } finally {
            rmSync(folder, { recursive: true });
        }
    });
});
