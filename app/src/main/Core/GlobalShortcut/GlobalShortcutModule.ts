import { isValidHotkey } from "@common/Core/Hotkey";
import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import { app, globalShortcut as electronGlobalShortcut } from "electron";
import { nativeSelection } from "../../Extensions/Ai/NativeSelection";

export class GlobalShortcutModule {
    public static bootstrap(moduleRegistry: UeliModuleRegistry) {
        const eventEmitter = moduleRegistry.get("EventEmitter");
        const eventSubscriber = moduleRegistry.get("EventSubscriber");
        const settingsManager = moduleRegistry.get("SettingsManager");
        const logger = moduleRegistry.get("Logger");

        const hotkeyIsEnabled = () => settingsManager.getValue("general.hotkey.enabled", true);

        const registerHotkey = () => {
            if (!hotkeyIsEnabled()) {
                electronGlobalShortcut.unregisterAll();
                nativeSelection.shortcutStatus.available = false;
                return;
            }

            const hotkey = settingsManager.getValue("general.hotkey", "Alt+Space");

            if (!isValidHotkey(hotkey)) {
                logger.error(`Unable to register hotkey. Reason: unexpected hotkey ${hotkey}`);
                electronGlobalShortcut.unregisterAll();
                return;
            }

            electronGlobalShortcut.unregisterAll();

            if (process.platform === "win32") {
                const selectionHotkey = settingsManager.getValue("general.selectionHotkey", "Control+Shift+Space");
                const selectionRegistered =
                    isValidHotkey(selectionHotkey) &&
                    electronGlobalShortcut.register(selectionHotkey, async () => {
                        const window = moduleRegistry.get("BrowserWindowRegistry").getById("search");

                        if (!window) {
                            return;
                        }

                        try {
                            await nativeSelection.capture(window.webContents, false);
                        } catch {
                            window.webContents.send("aiSelectionError", {
                                message:
                                    nativeSelection.shortcutStatus.error ??
                                    "Selection unavailable. Copy text manually.",
                            });
                        }

                        window.show();
                        window.focus();
                        window.webContents.send("navigateTo", { pathname: "/extension/Ai" });
                        window.webContents.send("aiSelectionReady", {});
                    });
                nativeSelection.shortcutStatus = { shortcut: selectionHotkey, available: !!selectionRegistered };
            }

            const ok = electronGlobalShortcut.register(hotkey, () => eventEmitter.emitEvent("hotkeyPressed"));

            if (!ok) {
                logger.error(`Failed to register hotkey "${hotkey}" — already in use by another application`);
            }
        };

        if (hotkeyIsEnabled()) {
            registerHotkey();
        }

        eventSubscriber.subscribe("settingUpdated[general.selectionHotkey]", () => registerHotkey());

        eventSubscriber.subscribe("settingUpdated[general.hotkey]", () => registerHotkey());

        eventSubscriber.subscribe("settingUpdated[general.hotkey.enabled]", () => {
            if (hotkeyIsEnabled()) {
                registerHotkey();
            } else {
                electronGlobalShortcut.unregisterAll();
                nativeSelection.shortcutStatus.available = false;
            }
        });

        app.on("will-quit", () => electronGlobalShortcut.unregisterAll());
    }
}
