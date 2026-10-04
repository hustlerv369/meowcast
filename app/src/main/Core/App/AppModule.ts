import type { UeliModuleRegistry } from "@Core/ModuleRegistry";

export class App {
    public static bootstrap(moduleRegistry: UeliModuleRegistry) {
        const app = moduleRegistry.get("App");
        const ipcMain = moduleRegistry.get("IpcMain");

        if (process.platform === "win32") {
            // Must match the electron-builder appId so Windows groups the taskbar entry and
            // keeps the existing installer/taskbar identity across the Meowcast rename.
            app.setAppUserModelId("Hustler.HustleCMD");
        }

        ipcMain.on("restartApp", () => {
            app.relaunch();
            app.exit();
        });
    }
}
