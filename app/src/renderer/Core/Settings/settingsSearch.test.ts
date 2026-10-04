import { describe, expect, it } from "vitest";
import { isSettingsFindShortcut, matchesSettingsSection, SETTINGS_QUERY_LIMIT } from "./settingsSearch";

describe("settings section finder", () => {
    it("does not advertise missing license or font controls", () => {
        expect(matchesSettingsSection("license", "About", "/about")).toBe(false);
        expect(matchesSettingsSection("licence", "About", "/about")).toBe(false);
        expect(matchesSettingsSection("font", "Appearance", "/appearance")).toBe(false);
        expect(matchesSettingsSection("glass", "Appearance", "/appearance")).toBe(true);
    });

    it.each([
        ["offline", "/"],
        ["opacity", "/window"],
        ["rescan", "/search-engine"],
    ])("finds the existing section for %s", (query, path) => {
        expect(matchesSettingsSection(query, "Section", path)).toBe(true);
        expect(matchesSettingsSection(query, "About", "/about")).toBe(false);
    });
    it("normalizes Czech accents and requires every query word", () => {
        expect(matchesSettingsSection("  OBLIbene  ", "Oblíbené", "/favorites")).toBe(true);
        expect(matchesSettingsSection("mouse kliknuti", "Keyboard", "/keyboard-and-mouse")).toBe(true);
        expect(matchesSettingsSection("mouse offline", "Keyboard", "/keyboard-and-mouse")).toBe(false);
    });
    it("matches extension public names, empty queries and bounded input", () => {
        expect(matchesSettingsSection("calculator", "Kalkulačka", "/extension/Calculator", "Calculator")).toBe(true);
        expect(matchesSettingsSection("  ", "Anything", "/unknown")).toBe(true);
        expect(
            matchesSettingsSection(
                "x".repeat(SETTINGS_QUERY_LIMIT) + "missing",
                "x".repeat(SETTINGS_QUERY_LIMIT),
                "/unknown",
            ),
        ).toBe(true);
        expect(matchesSettingsSection("nonsense", "Anything", "/unknown")).toBe(false);
    });
    const shortcut = {
        key: "f",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
        defaultPrevented: false,
    };
    it("supports Control and Command while respecting modal and composition ownership", () => {
        expect(isSettingsFindShortcut(shortcut, false)).toBe(true);
        expect(isSettingsFindShortcut({ ...shortcut, ctrlKey: false, metaKey: true }, false)).toBe(true);
        expect(isSettingsFindShortcut(shortcut, true)).toBe(false);

        for (const key of ["isComposing", "defaultPrevented", "altKey", "shiftKey"] as const) {
            expect(isSettingsFindShortcut({ ...shortcut, [key]: true }, false)).toBe(false);
        }

        expect(isSettingsFindShortcut({ ...shortcut, ctrlKey: false }, false)).toBe(false);
    });
});
