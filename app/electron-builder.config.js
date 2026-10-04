/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const baseConfig = {
    asar: true,
    appId: "Hustler.HustleCMD",
    asarUnpack: ["**/node_modules/sharp/**/*", "**/node_modules/@img/**/*"],
    productName: "Meowcast",
    directories: {
        output: "release",
        buildResources: "build",
    },
    files: ["dist-main/**/*.js", "dist-preload/index.js", "dist-renderer/**/*", "assets/**/*", "LICENSE", "PRIVACY_STATEMENT"],
    extraMetadata: {
        version: process.env.VITE_APP_VERSION,
    },
};

/**
 * @type {Record<NodeJS.Platform, import('electron-builder').Configuration>}
 */
const platformSpecificConfig = {
    win32: {
        ...baseConfig,
        extraResources: [{ from: "companion/meowmate", to: "meowmate", filter: ["coucou.exe", "coucou-hook.exe", "LICENSE", "LICENSE-ASSETS.md", "NOTICE.txt"] }],
        win: {
            icon: "assets/Packaging/hustlecmd.ico",
            // nsis = the professional .exe installer, msi = enterprise, zip = portable.
            target: [{ target: "nsis" }, { target: "msi" }, { target: "zip" }],
        },
        nsis: {
            oneClick: false, // full assisted installer (welcome / options / finish), not a silent one-click
            perMachine: false, // per-user install → no admin prompt
            allowElevation: true,
            allowToChangeInstallationDirectory: true,
            createDesktopShortcut: true,
            createStartMenuShortcut: true,
            shortcutName: "Meowcast",
            installerIcon: "assets/Packaging/hustlecmd.ico",
            uninstallerIcon: "assets/Packaging/hustlecmd.ico",
            uninstallDisplayName: "Meowcast ${version}",
            runAfterFinish: true,
            deleteAppDataOnUninstall: false,
        },
    },
    linux: {
        ...baseConfig,
        linux: {
            icon: "build/icons/",
            category: "Utility",
            target: [
                { target: "AppImage", arch: ["x64", "arm64"] },
                { target: "deb", arch: ["x64", "arm64"] },
                { target: "rpm", arch: ["x64", "arm64"] },
                { target: "zip", arch: ["x64", "arm64"] },
            ],
        },
    },
};

// Load the standalone Mac configuration only on Mac; Windows signing and packaging stay independent.
module.exports =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- electron-builder loads this configuration as CommonJS.
    process.platform === "darwin" ? require("./electron-builder.mac.cjs") : platformSpecificConfig[process.platform];
