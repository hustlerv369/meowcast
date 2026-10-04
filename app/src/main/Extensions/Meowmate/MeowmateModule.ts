import type { SearchResultItem, SearchResultItemAction } from "@common/Core";
import type { ActionHandler } from "@Core/ActionHandler";
import type { Extension } from "@Core/Extension";
import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import { app, shell } from "electron";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionBootstrapResult } from "../ExtensionBootstrapResult";
import type { ExtensionModule } from "../ExtensionModule";
import { launchCompanionInBackground, MEOWMATE_AUTOSTART_SETTING, MeowmateStartup } from "./MeowmateStartup";

let startup: MeowmateStartup | undefined;

export const companionPath = (packaged: boolean, resources: string, source: string): string => {
    return join(packaged ? resources : join(source, "companion"), "meowmate", "coucou.exe");
};

export class MeowmateExtension implements Extension, ActionHandler {
    public readonly id = "Meowmate";
    public readonly name = "Meowmate";
    public readonly author = { name: "Meowcast", githubUserName: "hustlerv369" };
    public isSupported() {
        return process.platform === "win32";
    }
    public getSettingDefaultValue() {
        return undefined;
    }
    public getI18nResources() {
        return {};
    }
    public getImage() {
        return {
            url:
                "data:image/svg+xml," +
                encodeURIComponent(
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M8 22V8l12 7h8l12-7v14c5 20-37 20-32 0Z" fill="#aaa"/><path d="M17 25h1m12 0h1" stroke="#222" stroke-width="4" stroke-linecap="round"/></svg>',
                ),
        };
    }
    public async getSearchResultItems(): Promise<SearchResultItem[]> {
        return [
            {
                id: "Meowmate:open",
                name: "Meowmate · AI companion dock",
                description: "Open your companion and coding assistants",
                image: this.getImage(),
                defaultAction: {
                    handlerId: this.id,
                    argument: "open",
                    description: "Open Meowmate",
                    hideWindowAfterInvocation: true,
                },
            },
        ];
    }
    public async invokeAction(action: SearchResultItemAction): Promise<void> {
        if (!this.isSupported()) {
            throw new Error("Meowmate is currently available in the Windows companion edition.");
        }

        if (action.argument !== "open") {
            throw new Error("Unknown Meowmate action.");
        }

        const executable = companionPath(app.isPackaged, process.resourcesPath, app.getAppPath());

        try {
            await access(executable);
        } catch {
            throw new Error("Meowmate is not included in this build. Install the Windows companion edition.");
        }

        const error = await shell.openPath(executable);

        if (error) {
            throw new Error("Meowmate could not be opened. Try restarting Meowcast.");
        }
    }
}

export class MeowmateModule implements ExtensionModule {
    public bootstrap(moduleRegistry: UeliModuleRegistry): ExtensionBootstrapResult {
        const extension = new MeowmateExtension();
        startup ??= new MeowmateStartup({
            ready: () => app.whenReady(),
            supported: () => extension.isSupported(),
            packaged: () => app.isPackaged,
            enabled: () => moduleRegistry.get("SettingsManager").getValue(MEOWMATE_AUTOSTART_SETTING, true),
            executable: () => companionPath(app.isPackaged, process.resourcesPath, app.getAppPath()),
            exists: access,
            launch: launchCompanionInBackground,
        });
        void startup.start().then((result) => {
            if (result === "failed" || result === "missing") {
                moduleRegistry
                    .get("Logger")
                    .warn("Meowmate did not start automatically. Open it from the launcher to retry.");
            }
        });
        return { extension, actionHandlers: [extension] };
    }
}
