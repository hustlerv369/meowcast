import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./AppModule";
afterEach(() => vi.unstubAllGlobals());
describe("packaged Windows identity", () => {
    it.each([false, true])("preserves Store-assigned identity when Store=%s", (windowsStore) => {
        vi.stubGlobal("process", { platform: "win32", windowsStore });
        const app = { setAppUserModelId: vi.fn() };
        const registry = { get: (id: string) => (id === "App" ? app : { on: vi.fn() }) };
        App.bootstrap(registry as unknown as UeliModuleRegistry);

        if (windowsStore) {
            expect(app.setAppUserModelId).not.toHaveBeenCalled();
        } else {
            expect(app.setAppUserModelId).toHaveBeenCalledWith("Hustler.HustleCMD");
        }
    });
});
