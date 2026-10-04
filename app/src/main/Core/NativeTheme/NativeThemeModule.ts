import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import { join } from "node:path";
import type { NativeThemeSource } from "./NativeThemeSource";
import { canShareTheme, startSharedTheme, writeSharedTheme } from "./SharedCompanionTheme";

export class NativeThemeModule {
    public static bootstrap(moduleRegistry: UeliModuleRegistry) {
        const nativeTheme = moduleRegistry.get("NativeTheme");
        const settingsManager = moduleRegistry.get("SettingsManager");
        const eventSubscriber = moduleRegistry.get("EventSubscriber");

        const getNativeThemeSource = (): NativeThemeSource =>
            settingsManager.getValue<NativeThemeSource>("appearance.themeSource", "system");

        nativeTheme.themeSource = getNativeThemeSource();

        const app = moduleRegistry.get("App");
        const shared =
            process.platform === "win32" && canShareTheme(app, moduleRegistry.get("SettingsFile").path)
                ? startSharedTheme(nativeTheme, getNativeThemeSource, (value) => {
                      try {
                          writeSharedTheme(join(app.getPath("userData"), "meowmate-theme.json"), value);
                      } catch {
                          moduleRegistry.get("Logger").warn("Companion appearance could not be synchronized.");
                      }
                  })
                : undefined;
        app.once("will-quit", () => shared?.dispose());
        eventSubscriber.subscribe("settingUpdated[appearance.themeSource]", () => {
            nativeTheme.themeSource = getNativeThemeSource();
            shared?.update();
        });
    }
}
