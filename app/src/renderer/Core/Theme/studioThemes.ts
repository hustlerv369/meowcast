import { webDarkTheme, webLightTheme, type Theme } from "@fluentui/react-components";
import { isReadablePalette, onAccentColor, type StudioPalette } from "./customThemes";

export const studioGlassOpacity = {
    dark: { shell: 0.96, content: 0.18 },
    light: { shell: 0.96, content: 0.35 },
} as const;

export const studioThemes = [
    { name: "Ember", hue: 38, dark: "#F5B68C", light: "#883C15" },
    { name: "Amber", hue: 80, dark: "#E9CB78", light: "#71520B" },
    { name: "Jade", hue: 155, dark: "#8DD4A9", light: "#226441" },
    { name: "Mint", hue: 175, dark: "#91D5BC", light: "#24634F" },
    { name: "Lagoon", hue: 205, dark: "#8DD1DA", light: "#23616B" },
    { name: "Cobalt", hue: 255, dark: "#A8C6F6", light: "#315E99" },
    { name: "Iris", hue: 290, dark: "#CAB6EF", light: "#68458F" },
    { name: "Rose", hue: 345, dark: "#EDB0CD", light: "#8B3B62" },
    { name: "Coral", hue: 25, dark: "#F2AEA1", light: "#913E32" },
    { name: "Graphite", hue: 250, dark: "#D0D0D0", light: "#505050" },
] as const;

export const getStudioPalette = (name: string, dark: boolean, custom?: StudioPalette) => {
    if (isReadablePalette(custom)) {
        return custom;
    }

    const theme = studioThemes.find((item) => item.name === name) ?? studioThemes[9];
    return {
        bg: dark ? "#202020" : "#EEEEEE",
        surface: dark ? "#282828" : "#F5F5F5",
        control: dark ? "#404040" : "#CACACA",
        text: dark ? "#F5F5F5" : "#242424",
        muted: dark ? "#BFBFBF" : "#505050",
        accent: dark ? theme.dark : theme.light,
        border: dark ? "#4A4A4A" : "#D7DCE3",
        selection: dark ? "#484848" : "#DDDDDD",
    };
};

export const getStudioFluentTheme = (name: string, dark: boolean, custom?: StudioPalette): Theme => {
    const p = getStudioPalette(name, dark, custom);
    return {
        ...(dark ? webDarkTheme : webLightTheme),
        fontFamilyBase: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontFamilyNumeric: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSizeBase100: "14px",
        fontSizeBase200: "14px",
        fontSizeBase300: "16px",
        fontSizeBase400: "16px",
        fontSizeBase500: "20px",
        fontSizeBase600: "24px",
        lineHeightBase100: "20px",
        lineHeightBase200: "20px",
        lineHeightBase300: "24px",
        lineHeightBase400: "24px",
        lineHeightBase500: "28px",
        lineHeightBase600: "32px",
        fontWeightRegular: 400,
        fontWeightMedium: 600,
        fontWeightSemibold: 600,
        fontWeightBold: 600,
        borderRadiusSmall: "6px",
        borderRadiusMedium: "10px",
        borderRadiusLarge: "14px",
        borderRadiusXLarge: "18px",
        shadow2: "0 1px 3px #18283a0a",
        shadow4: "0 2px 8px #18283a0d",
        shadow8: "0 4px 20px #18283a14",
        shadow16: "0 8px 32px #18283a1a",
        colorNeutralBackground1: p.control,
        colorNeutralBackground2: p.bg,
        colorNeutralBackground3: p.bg,
        colorNeutralBackground4: p.bg,
        colorNeutralBackground5: p.bg,
        colorNeutralBackground6: p.bg,
        colorNeutralBackground2Hover: p.selection,
        colorNeutralBackground3Hover: p.selection,
        colorNeutralBackground1Pressed: p.selection,
        colorNeutralBackground2Pressed: p.selection,
        colorNeutralBackground1Selected: p.selection,
        colorNeutralBackground1Hover: p.selection,
        colorNeutralForeground1: p.text,
        colorNeutralForeground2: p.muted,
        colorNeutralForeground3: p.muted,
        colorNeutralStroke1: "transparent",
        colorNeutralStroke2: "transparent",
        colorNeutralStrokeAccessible: p.muted,
        colorNeutralStroke1Hover: "transparent",
        colorNeutralStroke1Pressed: "transparent",
        colorNeutralStroke1Selected: "transparent",
        colorBrandBackground2: p.selection,
        colorBrandBackground2Hover: p.selection,
        colorBrandBackground2Pressed: p.selection,
        colorBrandStroke1: p.accent,
        colorBrandStroke2: "transparent",
        colorBrandForeground1: p.accent,
        colorBrandForeground2: p.accent,
        colorNeutralForeground2BrandHover: p.accent,
        colorNeutralForeground2BrandPressed: p.accent,
        colorNeutralForeground2BrandSelected: p.accent,
        colorNeutralForeground3BrandHover: p.accent,
        colorNeutralForeground3BrandPressed: p.accent,
        colorNeutralForeground3BrandSelected: p.accent,
        colorCompoundBrandForeground1: p.accent,
        colorBrandBackground: p.accent,
        colorBrandBackgroundHover: p.accent,
        colorBrandBackgroundPressed: p.accent,
        colorNeutralForegroundOnBrand:
            custom && isReadablePalette(custom) ? onAccentColor(p.accent) : dark ? "#252A30" : "#FAF8F5",
        colorStrokeFocus2: p.accent,
        colorCompoundBrandStroke: p.accent,
        colorCompoundBrandBackground: p.accent,
        colorCompoundBrandBackgroundHover: p.accent,
        colorCompoundBrandBackgroundPressed: p.accent,
        colorCompoundBrandForeground1Hover: p.accent,
        colorCompoundBrandForeground1Pressed: p.accent,
        colorCompoundBrandStrokeHover: p.accent,
        colorCompoundBrandStrokePressed: p.accent,
    };
};
