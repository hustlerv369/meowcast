import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import type { UeliCommandInvokedEvent } from "@Core/UeliCommand";
import { SettingsWindowManager } from "./SettingsWindowManager";

export class SettingsWindowModule {
    public static async bootstrap(moduleRegistry: UeliModuleRegistry) {
        const app = moduleRegistry.get("App");
        const appIconFilePathResolver = moduleRegistry.get("AppIconFilePathResolver");
        const eventSubscriber = moduleRegistry.get("EventSubscriber");
        const htmlLoader = moduleRegistry.get("BrowserWindowHtmlLoader");
        const ipcMain = moduleRegistry.get("IpcMain");
        const nativeTheme = moduleRegistry.get("NativeTheme");
        const translator = moduleRegistry.get("Translator");
        const browserWindowNotifier = moduleRegistry.get("BrowserWindowNotifier");
        const browserWindowRegistry = moduleRegistry.get("BrowserWindowRegistry");
        const eventEmitter = moduleRegistry.get("EventEmitter");
        const settingsManager = moduleRegistry.get("SettingsManager");

        const settingsWindowManager = new SettingsWindowManager(
            appIconFilePathResolver,
            translator,
            app,
            browserWindowRegistry,
            eventEmitter,
            htmlLoader,
            settingsManager,
            nativeTheme,
        );

        ipcMain.on("openSettings", async (_, pathname?: unknown) => {
            const settingsWindow = await settingsWindowManager.getWindow();
            settingsWindow.focus();
            settingsWindow.show();

            // Only the onboarding AI destination is supported; ordinary calls keep the current settings page.
            if (pathname === "/extension/Ai") {
                browserWindowNotifier.notify({
                    browserWindowId: "settings",
                    channel: "navigateTo",
                    data: { pathname },
                });
            }
        });

        eventSubscriber.subscribe("settingUpdated", async ({ key, value }: { key: string; value: unknown }) => {
            const settingsWindow = await settingsWindowManager.getWindow();
            settingsWindow.webContents.send(`settingUpdated[${key}]`, { value });

            if (key === "appearance.themeSource" || key === "studio.theme") {
                settingsWindowManager.updateAppearance();
            }
        });

        eventSubscriber.subscribe("settingUpdated[general.language]", async () => {
            const settingsWindow = await settingsWindowManager.getWindow();
            settingsWindow.setTitle(settingsWindowManager.getWindowTitle());
        });

        eventSubscriber.subscribe(
            "ueliCommandInvoked",
            async ({ ueliCommand, argument }: UeliCommandInvokedEvent<{ pathname: string }>) => {
                if (["openAbout", "openExtensions", "openSettings"].includes(ueliCommand)) {
                    const settingsWindow = await settingsWindowManager.getWindow();

                    settingsWindow.show();
                    settingsWindow.focus();

                    const { pathname } = argument;

                    browserWindowNotifier.notify({
                        browserWindowId: "settings",
                        channel: "navigateTo",
                        data: { pathname },
                    });
                }
            },
        );

        nativeTheme.on("updated", () => {
            const settingsWindow = browserWindowRegistry.getById("settings");

            if (settingsWindow && !settingsWindow.isDestroyed()) {
                settingsWindow.setIcon(appIconFilePathResolver.resolve());
            }

            settingsWindowManager.updateAppearance();
        });
    }
}
