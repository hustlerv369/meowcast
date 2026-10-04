import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { selectionScript } from "./NativeSelection";
vi.mock("electron", () => ({ BrowserWindow: {} }));
describe.skipIf(process.platform !== "win32")("Windows selection helper assembly smoke test", () => {
    it("compiles the native helper and resolves every referenced UI Automation type", () => {
        const types = [...new Set(selectionScript.match(/\[System\.Windows\.Automation\.[A-Za-z.]+\]/g))];
        const script =
            selectionScript.split("$stage='input'")[0] +
            "\n" +
            types.map((type) => `[void]${type}`).join("\n") +
            "\n[Console]::Write('READY')";
        const result = spawnSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-Sta",
                "-EncodedCommand",
                Buffer.from(script, "utf16le").toString("base64"),
            ],
            { windowsHide: true, encoding: "utf8", timeout: 15000 },
        );
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe("READY");
    });
});
