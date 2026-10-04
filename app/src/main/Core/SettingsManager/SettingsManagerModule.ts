import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import { SettingsManager } from "./SettingsManager";

export class SettingsManagerModule {
    public static bootstrap(moduleRegistry: UeliModuleRegistry) {
        const app = moduleRegistry.get("App");
        const ipcMain = moduleRegistry.get("IpcMain");
        const settingsReader = moduleRegistry.get("SettingsReader");
        const settingsWriter = moduleRegistry.get("SettingsWriter");
        const eventEmitter = moduleRegistry.get("EventEmitter");
        const safeStorageEncryption = moduleRegistry.get("SafeStorageEncryption");

        const settingsManager = new SettingsManager(
            settingsReader,
            settingsWriter,
            eventEmitter,
            safeStorageEncryption,
        );

        moduleRegistry.register("SettingsManager", settingsManager);

        ipcMain.handle(
            "updateSettingValue",
            (_, { key, value, isSensitive }: { key: string; value: unknown; isSensitive?: boolean }) =>
                settingsManager.updateValue(key, value, isSensitive),
        );

        ipcMain.on(
            "getSettingValue",
            (
                event,
                { key, defaultValue, isSensitive }: { key: string; defaultValue: unknown; isSensitive?: boolean },
            ) => {
                // Renderer can replace keys but never reads decrypted stored credentials.
                const secret = isSensitive || /api.?key|token|password|secret|credential/i.test(key);
                event.returnValue = secret ? "" : settingsManager.getValue(key, defaultValue, false);
            },
        );

        ipcMain.on("hasSecret", (event, { key }: { key: unknown }) => {
            event.returnValue =
                typeof key === "string" &&
                /^extension\[[A-Za-z0-9]+\]\.(apiKey|token|password|secret|credential)$/.test(key) &&
                !!settingsManager.getValue(key, "", true);
        });

        ipcMain.handle("resetAllSettings", async () => {
            await settingsManager.resetAllSettings();

            // Because it's the easiest way to reset all settings to their default values in all places, we simply
            // restart the app.
            app.relaunch();
            app.exit();
        });

        ipcMain.handle("exportSettings", async (_, { filePath }) => {
            await settingsManager.exportSettings(filePath);
        });

        ipcMain.handle("importSettings", async (_, { filePath }) => {
            await settingsManager.importSettings(filePath);

            // Because it's the easiest way to reset all settings to their default values in all places, we simply
            // restart the app.
            app.relaunch();
            app.exit();
        });
    }
}
