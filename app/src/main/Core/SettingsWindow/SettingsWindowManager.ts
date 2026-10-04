import type { AppIconFilePathResolver } from "@Core/AppIconFilePathResolver";
import type { BrowserWindowHtmlLoader } from "@Core/BrowserWindow";
import type { BrowserWindowRegistry } from "@Core/BrowserWindowRegistry";
import type { EventEmitter } from "@Core/EventEmitter";
import type { SettingsManager } from "@Core/SettingsManager";
import type { Translator } from "@Core/Translator";
import { type App, BrowserWindow, type NativeTheme } from "electron";
import { join } from "path";

export class SettingsWindowManager {
    private static readonly SettingsWindowId = "settings";

    private browserWindow?: BrowserWindow;

    public constructor(
        private readonly appIconFilePathResolver: AppIconFilePathResolver,
        private readonly translator: Translator,
        private readonly app: App,
        private readonly browserWindowRegistry: BrowserWindowRegistry,
        private readonly eventEmitter: EventEmitter,
        private readonly htmlLoader: BrowserWindowHtmlLoader,
        private readonly settingsManager: SettingsManager,
        private readonly nativeTheme: NativeTheme,
    ) {}

    public async getWindow(): Promise<BrowserWindow> {
        if (this.browserWindow === undefined || this.browserWindow?.isDestroyed()) {
            this.browserWindow = await this.createBrowserWindow();
        }

        return this.browserWindow;
    }

    public getWindowTitle(): string {
        const { t } = this.translator.createT({
            "en-US": { settingsWindowTitle: "Settings" },
            "de-CH": { settingsWindowTitle: "Einstellungen" },
            "ja-JP": { settingsWindowTitle: "設定" },
            "ko-KR": { settingsWindowTitle: "설정" },
            "zh-CN": { settingsWindowTitle: "设置" },
            "zh-TW": { settingsWindowTitle: "設定" },
        });

        return `Meowcast — ${t("settingsWindowTitle")}`;
    }

    private getTitleBarOverlay() {
        // Match Studio's explicit light default; nativeTheme is authoritative only in system mode.
        const mode = this.settingsManager.getValue<string>("appearance.themeSource", "light");
        const dark = mode === "dark" || (mode === "system" && this.nativeTheme.shouldUseDarkColors);
        return { color: dark ? "#171717" : "#F0F2F5", symbolColor: dark ? "#F5F5F5" : "#202631", height: 40 };
    }

    public updateAppearance(): void {
        if (process.platform !== "win32" || !this.browserWindow || this.browserWindow.isDestroyed()) {
            return;
        }

        const overlay = this.getTitleBarOverlay();
        this.browserWindow.setTitleBarOverlay(overlay);
        this.browserWindow.setBackgroundColor(overlay.color);
    }

    private async createBrowserWindow(): Promise<BrowserWindow> {
        const settingsWindow = new BrowserWindow({
            show: false,
            height: 800,
            width: 1000,
            autoHideMenuBar: true,
            icon: this.appIconFilePathResolver.resolve(),
            title: this.getWindowTitle(),
            ...(process.platform === "win32"
                ? {
                      // Native caption buttons remain accessible; renderer reserves the draggable 40px strip.
                      titleBarStyle: "hidden" as const,
                      titleBarOverlay: this.getTitleBarOverlay(),
                      backgroundColor: this.getTitleBarOverlay().color,
                  }
                : {}),
            webPreferences: {
                preload: join(__dirname, "..", "dist-preload", "index.js"),
                spellcheck: false,

                // The dev tools should only be available in development mode. Once the app is packaged, the dev tools
                // should be disabled.
                devTools: !this.app.isPackaged,

                // The following options are needed for images with `file://` URLs to work during development
                allowRunningInsecureContent: !this.app.isPackaged,
                webSecurity: this.app.isPackaged,
            },
        });

        this.browserWindowRegistry.register(SettingsWindowManager.SettingsWindowId, settingsWindow);

        settingsWindow.on("close", () => {
            this.browserWindowRegistry.remove(SettingsWindowManager.SettingsWindowId);
            this.eventEmitter.emitEvent("settingsWindowClosed");
        });

        if (this.app.isPackaged) {
            settingsWindow.removeMenu();
        }

        await this.htmlLoader.loadHtmlFile(settingsWindow, "settings.html");

        return settingsWindow;
    }
}
