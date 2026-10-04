import { describe, expect, it } from "vitest";
import {
    colorContrast,
    findCustomPalette,
    isReadablePalette,
    onAccentColor,
    readCustomThemes,
    type CustomTheme,
} from "./customThemes";
import { getStudioFluentTheme, getStudioPalette } from "./studioThemes";

const theme: CustomTheme = {
    id: "custom:test",
    name: "My theme",
    light: getStudioPalette("Graphite", false),
    dark: getStudioPalette("Graphite", true),
};

describe("custom studio palettes", () => {
    it("accepts complete readable light and dark palettes", () => {
        expect(isReadablePalette(theme.light)).toBe(true);
        expect(isReadablePalette(theme.dark)).toBe(true);
        expect(readCustomThemes([theme])).toEqual([theme]);
    });

    it("rejects unsafe CSS, incomplete palettes and unreadable text or controls", () => {
        expect(isReadablePalette({ ...theme.dark, accent: "url(https://example.test)" })).toBe(false);
        expect(isReadablePalette({ ...theme.dark, text: theme.dark.bg })).toBe(false);
        expect(isReadablePalette({ ...theme.dark, control: theme.dark.surface })).toBe(false);
        expect(isReadablePalette({ ...theme.dark, accent: theme.dark.surface })).toBe(false);
        expect(isReadablePalette({ ...theme.dark, injected: "red" })).toBe(false);
        expect(isReadablePalette({ bg: "#000000" })).toBe(false);
    });

    it("filters malformed IDs, duplicate IDs, names and caps local themes at twenty", () => {
        expect(readCustomThemes(null)).toEqual([]);
        expect(
            readCustomThemes([theme, theme, { ...theme, id: "Graphite" }, { ...theme, id: "custom:other", name: " " }]),
        ).toEqual([theme]);
        expect(readCustomThemes([{ ...theme, name: "x".repeat(41) }])).toEqual([]);
        expect(
            readCustomThemes(Array.from({ length: 25 }, (_, index) => ({ ...theme, id: `custom:${index}` }))),
        ).toHaveLength(20);
    });

    it("applies the correct palette and safely falls back after deletion or invalid persisted colors", () => {
        expect(findCustomPalette([theme], theme.id, true)).toEqual(theme.dark);
        expect(findCustomPalette([theme], theme.id, false)).toEqual(theme.light);
        expect(findCustomPalette([], theme.id, true)).toBeUndefined();
        expect(getStudioPalette(theme.id, true, findCustomPalette([], theme.id, true))).toEqual(
            getStudioPalette("Graphite", true),
        );
        expect(findCustomPalette([{ ...theme, dark: { ...theme.dark, bg: "bad" } }], theme.id, true)).toBeUndefined();
        expect(getStudioPalette(theme.id, false, theme.light)).toEqual(theme.light);
    });

    it("chooses readable black or white text on any custom accent", () => {
        for (const accent of ["#FFFFFF", "#000000", "#808080", "#F08000"]) {
            expect(colorContrast(onAccentColor(accent), accent)).toBeGreaterThanOrEqual(4.5);
        }

        for (const dark of [false, true]) {
            const palette = dark ? theme.dark : theme.light;
            const fluent = getStudioFluentTheme(theme.id, dark, palette);
            expect(
                colorContrast(fluent.colorNeutralForegroundOnBrand, fluent.colorBrandBackground),
            ).toBeGreaterThanOrEqual(4.5);
        }
    });
});
