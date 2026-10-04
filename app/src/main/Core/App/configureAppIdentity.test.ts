import type { App } from "electron";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { configureAppIdentity } from "./configureAppIdentity";
const fixture = (name: string, userData: string, explicit = false) => {
    const appData = join("root", "profile");
    const setPath = vi.fn(),
        setName = vi.fn();
    const app = {
        getPath: (key: string) => (key === "appData" ? appData : userData),
        getName: () => name,
        setPath,
        setName,
        commandLine: { hasSwitch: () => explicit },
    } as unknown as App;
    return { app, appData, setPath, setName };
};
describe("Meowcast persistent identity", () => {
    it("pins the newly branded Electron default to the existing HustleCMD directory", () => {
        const f = fixture("Meowcast", join("root", "profile", "Meowcast"));
        configureAppIdentity(f.app);
        expect(f.setPath).toHaveBeenCalledWith("userData", join(f.appData, "HustleCMD"));
        expect(f.setName).toHaveBeenCalledWith("Meowcast");
        expect(f.setPath.mock.invocationCallOrder[0]).toBeLessThan(f.setName.mock.invocationCallOrder[0]);
    });
    it("keeps the old Electron default unchanged", () => {
        const f = fixture("HustleCMD", join("root", "profile", "HustleCMD"));
        configureAppIdentity(f.app);
        expect(f.setPath).toHaveBeenCalledWith("userData", join(f.appData, "HustleCMD"));
    });
    it("respects an explicit command-line user-data-dir even if it matches the new default", () => {
        const current = join("root", "profile", "Meowcast");
        const f = fixture("Meowcast", current, true);
        configureAppIdentity(f.app);
        expect(f.setPath).toHaveBeenCalledWith("userData", current);
    });
    it("preserves programmatic isolated QA profiles", () => {
        const current = join("root", "qa", "isolated");
        const f = fixture("Meowcast", current);
        configureAppIdentity(f.app);
        expect(f.setPath).toHaveBeenCalledWith("userData", current);
    });
});
