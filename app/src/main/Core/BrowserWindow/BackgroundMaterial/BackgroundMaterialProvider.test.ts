import type { SettingsManager } from "@Core/SettingsManager";
import type { BrowserWindowConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { BackgroundMaterialProvider } from "./BackgroundMaterialProvider";

describe(BackgroundMaterialProvider, () => {
    it("defaults missing transparency to Acrylic without persisting a preference", () => {
        const settingsManager = {
            getValue: vi.fn((_key: string, fallback: unknown) => fallback),
            updateValue: vi.fn(),
        } as unknown as SettingsManager;
        expect(new BackgroundMaterialProvider(settingsManager).get()).toBe("acrylic");
        expect(settingsManager.getValue).toHaveBeenCalledWith("studio.transparency", true);
        expect(settingsManager.updateValue).not.toHaveBeenCalled();
    });

    it("temporarily uses Acrylic for transparency and restores the stored choice without writing it", () => {
        let transparent = false;
        const updateValue = vi.fn();
        const settingsManager = {
            getValue: (key: string) => (key === "studio.transparency" ? transparent : "Tabbed"),
            updateValue,
        } as unknown as SettingsManager;
        const provider = new BackgroundMaterialProvider(settingsManager);
        expect(provider.get()).toBe("tabbed");
        transparent = true;
        expect(provider.get()).toBe("acrylic");
        transparent = false;
        expect(provider.get()).toBe("tabbed");
        expect(updateValue).not.toHaveBeenCalled();
    });

    describe(BackgroundMaterialProvider.prototype.get, () => {
        const testGet = ({
            expected,
            backgroundMaterial,
        }: {
            expected: BrowserWindowConstructorOptions["backgroundMaterial"];
            backgroundMaterial: string;
        }) => {
            const settingsManager = <SettingsManager>{
                getValue: vi.fn((key: string) => (key === "studio.transparency" ? false : backgroundMaterial)),
                updateValue: vi.fn(),
            };

            expect(new BackgroundMaterialProvider(settingsManager).get()).toEqual(expected);
            expect(settingsManager.getValue).toHaveBeenCalledWith("window.backgroundMaterial", "Mica");
        };

        it("should return the correct background material", () => {
            testGet({ backgroundMaterial: "Acrylic", expected: "acrylic" });
            testGet({ backgroundMaterial: "Mica", expected: "mica" });
            testGet({ backgroundMaterial: "Tabbed", expected: "tabbed" });
            testGet({ backgroundMaterial: "None", expected: "none" });
            testGet({ backgroundMaterial: "", expected: "mica" });
            testGet({ backgroundMaterial: "acrylic", expected: "mica" });
            testGet({ backgroundMaterial: "mica", expected: "mica" });
            testGet({ backgroundMaterial: "tabbed", expected: "mica" });
            testGet({ backgroundMaterial: "auto", expected: "mica" });
        });
    });
});
