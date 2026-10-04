import {
    createDarkTheme,
    createLightTheme,
    teamsDarkTheme,
    teamsLightTheme,
    webDarkTheme,
    webLightTheme,
    type BrandVariants,
    type Theme,
} from "@fluentui/react-components";
import type { ThemeMap } from "./ThemeMap";

/**
 * HustleCMD brand — vivid orange (#FF7A00) ramp on a near-black neutral base.
 */
const hustleBrand: BrandVariants = {
    10: "#1F0E00",
    20: "#2D1500",
    30: "#3C1C00",
    40: "#4C2300",
    50: "#5D2B00",
    60: "#6F3300",
    70: "#C25D00",
    80: "#D96800",
    90: "#EC7100",
    100: "#FF7A00",
    110: "#FF8A1F",
    120: "#FF9A3C",
    130: "#FFAA59",
    140: "#FFBA76",
    150: "#FFCA93",
    160: "#FFDAB0",
};

const hustleDarkTheme: Theme = {
    ...createDarkTheme(hustleBrand),
    // Punchier brand surfaces than the generated defaults
    colorBrandBackground: hustleBrand[100],
    colorBrandBackgroundHover: hustleBrand[110],
    colorBrandBackgroundPressed: hustleBrand[80],
    colorCompoundBrandBackground: hustleBrand[100],
    colorCompoundBrandBackgroundHover: hustleBrand[110],
    colorCompoundBrandBackgroundPressed: hustleBrand[80],
    colorCompoundBrandForeground1: hustleBrand[100],
    colorCompoundBrandStroke: hustleBrand[100],
    colorBrandForegroundLink: hustleBrand[110],
    colorBrandForegroundLinkHover: hustleBrand[120],
    colorBrandForeground1: hustleBrand[110],
    colorBrandForeground2: hustleBrand[120],
    colorBrandStroke1: hustleBrand[100],
    colorBrandStroke2: hustleBrand[60],
    // Near-black neutral base (dark grey / black look)
    colorNeutralBackground1: "#1A1A1A",
    colorNeutralBackground2: "#161616",
    colorNeutralBackground3: "#121212",
    colorNeutralBackground4: "#0F0F0F",
    colorNeutralBackground5: "#0B0B0B",
    colorNeutralBackground6: "#222222",
    colorNeutralBackground1Hover: "#242424",
    colorNeutralBackground1Pressed: "#2C2C2C",
    colorNeutralBackground1Selected: "#282828",
    colorSubtleBackgroundHover: "#262626",
    colorSubtleBackgroundPressed: "#2E2E2E",
    colorSubtleBackgroundSelected: "#2A2A2A",
    colorNeutralStroke1: "#3A3A3A",
    colorNeutralStroke2: "#2E2E2E",
    colorNeutralStroke3: "#262626",
};

const hustleLightTheme: Theme = {
    ...createLightTheme(hustleBrand),
    colorBrandBackground: hustleBrand[100],
    colorBrandBackgroundHover: hustleBrand[90],
    colorBrandBackgroundPressed: hustleBrand[80],
};

export const themeMap: ThemeMap = {
    HustleCMD: {
        dark: { theme: hustleDarkTheme, accentColor: "#FF7A00" },
        light: { theme: hustleLightTheme, accentColor: "#FF7A00" },
    },
    "Microsoft Teams": {
        dark: { theme: teamsDarkTheme, accentColor: "#7F85F5" },
        light: { theme: teamsLightTheme, accentColor: "#5B5FC7" },
    },
    "Fluent UI Web": {
        dark: { theme: webDarkTheme, accentColor: "#4F82C8" },
        light: { theme: webLightTheme, accentColor: "#1267B4" },
    },
};
