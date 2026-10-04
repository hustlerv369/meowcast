import type { App, NativeTheme } from "electron";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { LEGACY_USER_DATA_DIRECTORY } from "../App/configureAppIdentity";
import type { NativeThemeSource } from "./NativeThemeSource";

export const canShareTheme = (app: Pick<App, "isPackaged" | "getPath" | "commandLine">, settingsPath: string) => {
    const canonical = (path: string) => normalize(path).toLowerCase();
    const profile = join(app.getPath("appData"), LEGACY_USER_DATA_DIRECTORY);
    return (
        app.isPackaged &&
        !app.commandLine.hasSwitch("user-data-dir") &&
        canonical(app.getPath("userData")) === canonical(profile) &&
        canonical(settingsPath) === canonical(join(profile, "ueli9.settings.json"))
    );
};

export const sharedThemeValue = (source: NativeThemeSource, dark: boolean) => ({
    version: 1,
    source: ["light", "dark"].includes(source) ? source : "system",
    resolved: dark ? "dark" : "light",
});

export const startSharedTheme = (
    nativeTheme: Pick<NativeTheme, "shouldUseDarkColors" | "on" | "removeListener">,
    source: () => NativeThemeSource,
    publish: (value: ReturnType<typeof sharedThemeValue>) => void,
) => {
    const update = () => publish(sharedThemeValue(source(), nativeTheme.shouldUseDarkColors));
    nativeTheme.on("updated", update);
    update();
    return { update, dispose: () => nativeTheme.removeListener("updated", update) };
};

export const writeSharedTheme = (file: string, value: ReturnType<typeof sharedThemeValue>) => {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, file);
};
