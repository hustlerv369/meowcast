import type { App } from "electron";
import { join, normalize } from "node:path";

export const LEGACY_USER_DATA_DIRECTORY = "HustleCMD";
export const configureAppIdentity = (
    app: Pick<App, "getPath" | "setPath" | "getName" | "setName" | "commandLine">,
): void => {
    const current = app.getPath("userData");
    const defaultPath = join(app.getPath("appData"), app.getName());
    const canonical = (value: string) =>
        process.platform === "win32" ? normalize(value).toLowerCase() : normalize(value);
    // Keep explicit CLI and programmatic QA/custom profiles. Only Electron's derived default is pinned.
    const custom = app.commandLine.hasSwitch("user-data-dir") || canonical(current) !== canonical(defaultPath);
    app.setPath("userData", custom ? current : join(app.getPath("appData"), LEGACY_USER_DATA_DIRECTORY));
    app.setName("Meowcast");
};
