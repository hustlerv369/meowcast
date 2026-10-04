import type { OperatingSystem } from "@common/Core";
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import type { BrowserWindowConstructorOptionsProvider } from "./BrowserWindowConstructorOptionsProvider";

export class WindowsBrowserWindowConstructorOptionsProvider implements BrowserWindowConstructorOptionsProvider {
    public constructor(private readonly defaultOptions: BrowserWindowConstructorOptions) {}

    public get(): Electron.BrowserWindowConstructorOptions {
        return {
            ...this.defaultOptions,
            ...{
                autoHideMenuBar: true,
                transparent: true,
                backgroundColor: "#00000000",
                // DWM acrylic paints square backing beyond the transparent renderer's rounded silhouette.
                backgroundMaterial: "none",
            },
        };
    }
}

/** Setting changes must not restore the DWM backing on the transparent launcher. */
export const updateWindowsLauncherMaterial = (
    window: Pick<BrowserWindow, "setBackgroundMaterial" | "isDestroyed">,
    operatingSystem: OperatingSystem,
) => {
    if (operatingSystem === "Windows" && !window.isDestroyed()) {
        window.setBackgroundMaterial("none");
    }
};
