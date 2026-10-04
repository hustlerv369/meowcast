import { describe, expect, it } from "vitest";
import { getStudioFluentTheme, getStudioPalette, studioGlassOpacity, studioThemes } from "./studioThemes";

// WCAG relative luminance. OKLCH surfaces are converted to linear sRGB first.
const luminance = (color: string) => {
    if (color.startsWith("#")) {
        const channels = [1, 3, 5].map((offset) => {
            const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }

    const parts = color.match(/oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/);

    if (!parts) {
        throw new Error(`Unsupported color ${color}`);
    }

    const L = Number(parts[1]) / 100;
    const C = Number(parts[2]);
    const hue = (Number(parts[3]) * Math.PI) / 180;
    const a = C * Math.cos(hue);
    const b = C * Math.sin(hue);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (a: string, b: string) => {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

describe("Studio theme readability", () => {
    it("separates idle controls from the surrounding surfaces while keeping their labels readable", () => {
        for (const dark of [false, true]) {
            const palette = getStudioPalette("Graphite", dark);
            expect(contrast(palette.control, palette.bg)).toBeGreaterThanOrEqual(1.35);
            expect(contrast(palette.control, palette.surface)).toBeGreaterThanOrEqual(1.35);
            expect(contrast(palette.text, palette.control)).toBeGreaterThanOrEqual(4.5);
            expect(contrast(palette.muted, palette.control)).toBeGreaterThanOrEqual(4.5);
            expect(getStudioFluentTheme("Graphite", dark).colorNeutralBackground1).toBe(palette.control);
        }
    });
    it("keeps every dark surface and the Graphite accent neutral with equal RGB channels", () => {
        for (const theme of studioThemes) {
            const palette = getStudioPalette(theme.name, true);

            for (const color of [palette.bg, palette.surface, palette.border, palette.selection]) {
                const channels = [1, 3, 5].map((offset) => color.slice(offset, offset + 2));
                expect(new Set(channels).size).toBe(1);
            }
        }

        for (const dark of [true, false]) {
            const accent = getStudioPalette("Graphite", dark).accent;
            expect(new Set([1, 3, 5].map((offset) => accent.slice(offset, offset + 2))).size).toBe(1);
        }
    });

    it("suppresses unblurred desktop detail while retaining a small translucent contribution", () => {
        for (const opacity of Object.values(studioGlassOpacity)) {
            const shellDesktopContribution = 1 - opacity.shell;
            const contentDesktopContribution = shellDesktopContribution * (1 - opacity.content);
            expect(shellDesktopContribution).toBeGreaterThan(0);
            expect(shellDesktopContribution * 255).toBeLessThanOrEqual(11);
            expect(contentDesktopContribution * 255).toBeLessThanOrEqual(9);
        }
    });

    it("keeps translucent content readable over black and white desktop extremes for every accent", () => {
        const channels = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));

        for (const dark of [false, true]) {
            const opacity = studioGlassOpacity[dark ? "dark" : "light"];

            for (const theme of studioThemes) {
                const palette = getStudioPalette(theme.name, dark);

                for (const desktop of [0, 255]) {
                    const shell = channels(palette.bg).map(
                        (channel) => channel * opacity.shell + desktop * (1 - opacity.shell),
                    );
                    const composite =
                        "#" +
                        channels(palette.surface)
                            .map((channel, index) =>
                                (dark ? Math.ceil : Math.floor)(
                                    channel * opacity.content + shell[index] * (1 - opacity.content),
                                )
                                    .toString(16)
                                    .padStart(2, "0"),
                            )
                            .join("");

                    for (const foreground of [palette.text, palette.muted, palette.accent]) {
                        expect(contrast(foreground, composite)).toBeGreaterThanOrEqual(4.5);
                    }
                }
            }
        }
    });

    it("accents never tint the pearl or graphite content surfaces", () => {
        for (const dark of [true, false]) {
            const neutral = getStudioPalette("Graphite", dark);

            for (const theme of studioThemes) {
                const palette = getStudioPalette(theme.name, dark);
                expect([palette.bg, palette.surface, palette.selection]).toEqual([
                    neutral.bg,
                    neutral.surface,
                    neutral.selection,
                ]);
            }
        }
    });

    for (const theme of studioThemes) {
        for (const dark of [true, false]) {
            it(`${theme.name} ${dark ? "dark" : "light"}: text, metadata and accents meet 4.5:1 on content and selection`, () => {
                const palette = getStudioPalette(theme.name, dark);

                for (const foreground of [palette.text, palette.muted, palette.accent]) {
                    for (const background of [palette.bg, palette.surface, palette.selection]) {
                        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
                    }
                }

                const fluent = getStudioFluentTheme(theme.name, dark);
                expect(
                    contrast(fluent.colorNeutralForegroundOnBrand, fluent.colorBrandBackground),
                ).toBeGreaterThanOrEqual(4.5);
            });
        }
    }

    it("falls back to Graphite for stale or invalid names", () => {
        expect(getStudioPalette("not-a-theme", true)).toEqual(getStudioPalette("Graphite", true));
    });

    it("keeps readable shared control sizes and only regular/semibold weights", () => {
        const theme = getStudioFluentTheme("Graphite", false);
        expect([theme.fontSizeBase100, theme.fontSizeBase200, theme.fontSizeBase300, theme.fontSizeBase400]).toEqual([
            "14px",
            "14px",
            "16px",
            "16px",
        ]);
        expect([
            theme.fontWeightRegular,
            theme.fontWeightMedium,
            theme.fontWeightSemibold,
            theme.fontWeightBold,
        ]).toEqual([400, 600, 600, 600]);
    });
});
