export const paletteKeys = ["bg", "surface", "control", "text", "muted", "accent", "border", "selection"] as const;
export type StudioPalette = Record<(typeof paletteKeys)[number], string>;
export type CustomTheme = { id: string; name: string; light: StudioPalette; dark: StudioPalette };

const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
export const colorContrast = (a: string, b: string) => {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
export const isReadablePalette = (value: unknown): value is StudioPalette => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const p = value as StudioPalette;

    if (
        Object.keys(p).length !== paletteKeys.length ||
        !paletteKeys.every(
            (key) => Object.hasOwn(p, key) && typeof p[key] === "string" && /^#[\da-f]{6}$/i.test(p[key]),
        )
    ) {
        return false;
    }

    return (
        [p.text, p.muted].every((fg) =>
            [p.bg, p.surface, p.control, p.selection].every((bg) => colorContrast(fg, bg) >= 4.5),
        ) &&
        [p.bg, p.surface].every((bg) => colorContrast(p.control, bg) >= 1.35) &&
        [p.bg, p.surface].every((bg) => colorContrast(p.accent, bg) >= 4.5)
    );
};
export const readCustomThemes = (value: unknown): CustomTheme[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const ids = new Set<string>();
    return value.slice(0, 20).filter((item): item is CustomTheme => {
        if (
            !item ||
            typeof item !== "object" ||
            typeof item.id !== "string" ||
            !/^custom:[\w-]{1,64}$/.test(item.id) ||
            ids.has(item.id) ||
            typeof item.name !== "string" ||
            !item.name.trim() ||
            item.name.length > 40 ||
            !isReadablePalette(item.light) ||
            !isReadablePalette(item.dark)
        ) {
            return false;
        }

        ids.add(item.id);
        return true;
    });
};

export const findCustomPalette = (themes: unknown, id: string, dark: boolean): StudioPalette | undefined => {
    const theme = readCustomThemes(themes).find((item) => item.id === id);
    return theme?.[dark ? "dark" : "light"];
};

export const onAccentColor = (accent: string): string =>
    colorContrast("#000000", accent) >= colorContrast("#FFFFFF", accent) ? "#000000" : "#FFFFFF";
