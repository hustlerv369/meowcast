import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import type { UeliCommandInvokedEvent } from "@Core/UeliCommand";
import type { OperatingSystem, SearchResultItemAction } from "@common/Core";
import { BrowserWindow } from "electron";
import type { BrowserWindowConstructorOptionsProvider } from "./BrowserWindowConstructorOptionsProvider";
import {
    DefaultBrowserWindowConstructorOptionsProvider,
    LinuxBrowserWindowConstructorOptionsProvider,
    MacOsBrowserWindowConstructorOptionsProvider,
    WindowsBrowserWindowConstructorOptionsProvider,
} from "./BrowserWindowConstructorOptionsProvider";
import { updateWindowsLauncherMaterial } from "./BrowserWindowConstructorOptionsProvider/WindowsBrowserWindowConstructorOptionsProvider";
import { BrowserWindowToggler } from "./BrowserWindowToggler";
import { applyRoundedWindowRegion } from "./roundedWindowRegion";

export class SearchWindowModule {
    private static readonly DefaultHideWindowOnOptions = ["blur", "afterInvocation", "escapePressed"];

    public static async bootstrap(moduleRegistry: UeliModuleRegistry) {
        const app = moduleRegistry.get("App");
        const appIconFilePathResolver = moduleRegistry.get("AppIconFilePathResolver");
        const eventSubscriber = moduleRegistry.get("EventSubscriber");
        const htmlLoader = moduleRegistry.get("BrowserWindowHtmlLoader");
        const ipcMain = moduleRegistry.get("IpcMain");
        const nativeTheme = moduleRegistry.get("NativeTheme");
        const operatingSystem = moduleRegistry.get("OperatingSystem");
        const settingsManager = moduleRegistry.get("SettingsManager");
        const vibrancyProvider = moduleRegistry.get("BrowserWindowVibrancyProvider");
        const browserWindowRegistry = moduleRegistry.get("BrowserWindowRegistry");
        const ueliCommandInvoker = moduleRegistry.get("UeliCommandInvoker");

        const defaultBrowserWindowOptions = new DefaultBrowserWindowConstructorOptionsProvider(
            app,
            settingsManager,
            appIconFilePathResolver,
        ).get();

        const browserWindowConstructorOptionsProviders: Record<
            OperatingSystem,
            BrowserWindowConstructorOptionsProvider
        > = {
            Linux: new LinuxBrowserWindowConstructorOptionsProvider(defaultBrowserWindowOptions),
            macOS: new MacOsBrowserWindowConstructorOptionsProvider(defaultBrowserWindowOptions, vibrancyProvider),
            Windows: new WindowsBrowserWindowConstructorOptionsProvider(defaultBrowserWindowOptions),
        };

        const searchWindow = new BrowserWindow(browserWindowConstructorOptionsProviders[operatingSystem].get());

        if (operatingSystem === "Windows") {
            applyRoundedWindowRegion(searchWindow, () =>
                moduleRegistry.get("Logger").warn("Native rounded window clipping is unavailable; CSS corners remain."),
            );
        }

        searchWindow.on("close", () => browserWindowRegistry.getById("settings")?.close());

        browserWindowRegistry.register("search", searchWindow);

        // Only the launcher renderer can request the three bounded workspace layouts.
        // Screen coordinates are DIP, so Windows scaling and secondary monitors stay usable.
        ipcMain.on("studioSetWindowMode", (event, mode: unknown) => {
            if (event.sender !== searchWindow.webContents || searchWindow.isDestroyed()) {
                return;
            }

            if (mode !== "launcher" && mode !== "appearance" && mode !== "composer") {
                return;
            }

            const bounds = searchWindow.getBounds();
            const area = moduleRegistry.get("Screen").getDisplayMatching(bounds).workArea;
            const width = Math.min(mode === "composer" ? 940 : 680, area.width - 24);
            const height = Math.min(mode === "launcher" ? 480 : 700, area.height - 24);
            searchWindow.setBounds({
                width: Math.max(1, width),
                height: Math.max(1, height),
                x: Math.max(
                    area.x + 12,
                    Math.min(bounds.x + Math.round((bounds.width - width) / 2), area.x + area.width - width - 12),
                ),
                y: Math.max(area.y + 12, Math.min(bounds.y, area.y + area.height - height - 12)),
            });
        });

        searchWindow.setVisibleOnAllWorkspaces(settingsManager.getValue("window.visibleOnAllWorkspaces", false));

        if (app.isPackaged) {
            searchWindow.removeMenu();
        }

        const browserWindowToggler = new BrowserWindowToggler(
            operatingSystem,
            app,
            searchWindow,
            browserWindowRegistry,
        );

        nativeTheme.on("updated", () => searchWindow.setIcon(appIconFilePathResolver.resolve()));

        const settingsWindowIsVisible = () => {
            const settingsWindow = browserWindowRegistry.getById("settings");
            return settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible();
        };

        const shouldHideWindowOnBlur = () =>
            settingsManager
                .getValue("window.hideWindowOn", SearchWindowModule.DefaultHideWindowOnOptions)
                .includes("blur") && !settingsWindowIsVisible();

        searchWindow.on("blur", () => shouldHideWindowOnBlur() && browserWindowToggler.hide());

        const shouldHideWindowAfterInvocation = (action: SearchResultItemAction) =>
            action.hideWindowAfterInvocation &&
            settingsManager
                .getValue("window.hideWindowOn", SearchWindowModule.DefaultHideWindowOnOptions)
                .includes("afterInvocation");

        const shouldHideWindowOnEscapePressed = () =>
            settingsManager
                .getValue("window.hideWindowOn", SearchWindowModule.DefaultHideWindowOnOptions)
                .includes("escapePressed");

        eventSubscriber.subscribe("settingsWindowClosed", () => {
            if (searchWindow.isVisible() && !searchWindow.isFocused()) {
                browserWindowToggler.showAndFocus();
            }
        });

        eventSubscriber.subscribe("actionInvocationStarted", ({ action }: { action: SearchResultItemAction }) => {
            if (shouldHideWindowAfterInvocation(action)) {
                browserWindowToggler.hide();
            }
        });

        eventSubscriber.subscribe("hotkeyPressed", () => browserWindowToggler.toggle());

        eventSubscriber.subscribe("settingUpdated", ({ key, value }: { key: string; value: unknown }) => {
            searchWindow.webContents.send(`settingUpdated[${key}]`, { value });
        });

        eventSubscriber.subscribe("settingUpdated[window.alwaysOnTop]", ({ value }: { value: boolean }) => {
            searchWindow.setAlwaysOnTop(value);
        });

        const updateBackgroundMaterial = () => {
            updateWindowsLauncherMaterial(searchWindow, operatingSystem);
        };

        eventSubscriber.subscribe("settingUpdated[window.backgroundMaterial]", updateBackgroundMaterial);
        eventSubscriber.subscribe("settingUpdated[studio.transparency]", updateBackgroundMaterial);

        eventSubscriber.subscribe("settingUpdated[window.vibrancy]", () => {
            searchWindow.setVibrancy(vibrancyProvider.get());
        });

        eventSubscriber.subscribe("settingUpdated[window.visibleOnAllWorkspaces]", ({ value }: { value: boolean }) => {
            searchWindow.setVisibleOnAllWorkspaces(value);
        });

        ipcMain.on("escapePressed", () => shouldHideWindowOnEscapePressed() && browserWindowToggler.hide());
        ipcMain.on("rescanExtensionsKeyboardShortcutPressed", () =>
            ueliCommandInvoker.invokeUeliCommand("rescanExtensions"),
        );

        app.on("second-instance", (_, argv) => {
            if (argv.includes("--toggle")) {
                browserWindowToggler.toggle();
            } else {
                browserWindowToggler.showAndFocus();
            }
        });

        eventSubscriber.subscribe("ueliCommandInvoked", ({ ueliCommand }: UeliCommandInvokedEvent<unknown>) => {
            const map: Record<string, () => void> = {
                show: () => browserWindowToggler.showAndFocus(),
                centerWindow: () => searchWindow.center(),
            };

            if (Object.keys(map).includes(ueliCommand)) {
                map[ueliCommand]();
            }
        });

        await htmlLoader.loadHtmlFile(searchWindow, "search.html");
    }
}
