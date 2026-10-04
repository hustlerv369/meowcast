import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import { EnvironmentVariableProvider } from "./EnvironmentVariableProvider";

export class EnvironmentVariableProviderModule {
    public static bootstrap(moduleRegistry: UeliModuleRegistry): void {
        const ipcMain = moduleRegistry.get("IpcMain");

        const environmentVariableProvider = new EnvironmentVariableProvider(<Record<string, string>>process.env);

        moduleRegistry.register("EnvironmentVariableProvider", environmentVariableProvider);

        ipcMain.on("getEnvironmentVariable", (event, { environmentVariable }) => {
            // Only the non-sensitive platform hint used by renderer settings is exposed.
            event.returnValue =
                environmentVariable === "XDG_SESSION_TYPE"
                    ? environmentVariableProvider.get(environmentVariable)
                    : undefined;
        });
    }
}
