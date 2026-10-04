import type { SettingsManager } from "@Core/SettingsManager";
import type { BrowserWindowConstructorOptions } from "electron";
import type { BrowserWindowBackgroundMaterialProvider as BackgroundMaterialProviderInterface } from "../Contract";

export class BackgroundMaterialProvider implements BackgroundMaterialProviderInterface {
    public constructor(private readonly settingsManager: SettingsManager) {}

    public get(): BrowserWindowConstructorOptions["backgroundMaterial"] {
        if (this.settingsManager.getValue<boolean>("studio.transparency", true) === true) {
            return "acrylic";
        }

        const backgroundMaterial = this.settingsManager.getValue<string>("window.backgroundMaterial", "Mica");

        const backgroundMaterials: Record<string, BrowserWindowConstructorOptions["backgroundMaterial"]> = {
            Acrylic: "acrylic",
            Mica: "mica",
            None: "none",
            Tabbed: "tabbed",
        };

        return backgroundMaterials[backgroundMaterial] ?? "mica";
    }
}
