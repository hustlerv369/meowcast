import { useSetting } from "@Core/Hooks/useSetting";
import { useEffect, useState, type ReactNode } from "react";
import { ThemeContext } from "./ThemeContext";
import { findCustomPalette } from "./customThemes";
import "./studio.css";
import { getStudioFluentTheme, getStudioPalette, studioGlassOpacity } from "./studioThemes";

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
    const [systemDark, setSystemDark] = useState(window.matchMedia("(prefers-color-scheme: dark)").matches);
    const { value: name } = useSetting({ key: "studio.theme", defaultValue: "Graphite" });
    const { value: mode } = useSetting({ key: "appearance.themeSource", defaultValue: "light" });
    const { value: transparent } = useSetting({ key: "studio.transparency", defaultValue: true });
    const { value: customThemes } = useSetting<unknown>({ key: "studio.customThemes", defaultValue: [] });
    const shouldUseDarkColors = mode === "dark" || (mode !== "light" && systemDark);
    const customPalette = findCustomPalette(customThemes, name, shouldUseDarkColors);
    const fluentUiTheme = getStudioFluentTheme(name, shouldUseDarkColors, customPalette);

    useEffect(() => {
        const root = document.documentElement;
        root.dataset.studioKeyboard = "false";
        const keyboard = (event: KeyboardEvent) => {
            const target = event.target;
            const editingText =
                target instanceof HTMLElement &&
                (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

            if (
                event.key === "Tab" ||
                (!editingText && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key))
            ) {
                root.dataset.studioKeyboard = "true";
            }
        };
        const pointer = () => {
            root.dataset.studioKeyboard = "false";
        };
        document.addEventListener("keydown", keyboard, true);
        document.addEventListener("pointerdown", pointer, true);
        return () => {
            document.removeEventListener("keydown", keyboard, true);
            document.removeEventListener("pointerdown", pointer, true);
        };
    }, []);

    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
    }, []);

    useEffect(() => {
        const palette = getStudioPalette(name, shouldUseDarkColors, customPalette);
        // Custom palettes are validated against solid surfaces. Keep that contrast over any desktop.
        const useGlass = transparent && !customPalette;
        const opacity = studioGlassOpacity[shouldUseDarkColors ? "dark" : "light"];

        for (const [key, value] of Object.entries(palette)) {
            document.documentElement.style.setProperty(`--studio-${key}`, value);
        }

        document.documentElement.style.setProperty(
            "--studio-chrome",
            useGlass ? `color-mix(in srgb, ${palette.bg} ${opacity.shell * 100}%, transparent)` : palette.bg,
        );
        document.documentElement.style.setProperty(
            "--studio-content-fill",
            useGlass
                ? `color-mix(in srgb, ${palette.surface} ${opacity.content * 100}%, transparent)`
                : palette.surface,
        );
        document.documentElement.dataset.studioTransparency = String(useGlass);
        document.documentElement.style.colorScheme = shouldUseDarkColors ? "dark" : "light";
    }, [name, shouldUseDarkColors, transparent, customThemes]);

    return <ThemeContext.Provider value={{ fluentUiTheme, shouldUseDarkColors }}>{children}</ThemeContext.Provider>;
};
