import type { BrowserWindowConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
    WindowsBrowserWindowConstructorOptionsProvider,
    updateWindowsLauncherMaterial,
} from "./WindowsBrowserWindowConstructorOptionsProvider";

describe(WindowsBrowserWindowConstructorOptionsProvider, () => {
    describe(WindowsBrowserWindowConstructorOptionsProvider.prototype.get, () => {
        it("should return the windows constructor options", () => {
            const defaultOptions = <BrowserWindowConstructorOptions>{
                frame: false,
                center: true,
            };

            const actual = new WindowsBrowserWindowConstructorOptionsProvider(defaultOptions).get();

            expect(actual).toEqual(<BrowserWindowConstructorOptions>{
                frame: false,
                center: true,
                autoHideMenuBar: true,
                transparent: true,
                backgroundColor: "#00000000",
                backgroundMaterial: "none",
            });
        });
        it.each(["acrylic", "mica", "tabbed", "auto", "none"] as const)(
            "overrides inherited %s without mutating stored options",
            (backgroundMaterial) => {
                const options = { backgroundMaterial };
                expect(new WindowsBrowserWindowConstructorOptionsProvider(options).get().backgroundMaterial).toBe(
                    "none",
                );
                expect(options.backgroundMaterial).toBe(backgroundMaterial);
            },
        );
    });

    it("keeps native material disabled through repeated material and transparency updates", () => {
        const window = { setBackgroundMaterial: vi.fn(), isDestroyed: () => false };
        updateWindowsLauncherMaterial(window, "Windows");
        updateWindowsLauncherMaterial(window, "Windows");
        expect(window.setBackgroundMaterial.mock.calls).toEqual([["none"], ["none"]]);
    });

    it.each(["macOS", "Linux"] as const)("does not alter %s material", (platform) => {
        const window = { setBackgroundMaterial: vi.fn(), isDestroyed: () => false };
        updateWindowsLauncherMaterial(window, platform);
        expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
    });

    it("ignores a destroyed launcher", () => {
        const window = { setBackgroundMaterial: vi.fn(), isDestroyed: () => true };
        updateWindowsLauncherMaterial(window, "Windows");
        expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
    });
});
