// electron-builder v26 config. Run on macOS; no credentials in this file.
const signed = process.env.HUSTLE_SIGN_MAC === "1";

if (signed && !(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)) {
    throw new Error("Signed build requires Apple notarization credentials in the environment.");
}

module.exports = {
    appId: "Hustler.HustleCMD",
    productName: "Meowcast",
    asar: true,
    asarUnpack: ["**/node_modules/sharp/**/*", "**/node_modules/@img/**/*"],
    directories: { output: "release/mac", buildResources: "assets/Packaging" },
    files: ["dist-main/**/*.js", "dist-preload/index.js", "dist-renderer/**/*", "assets/**/*", "LICENSE"],
    forceCodeSigning: signed,
    mac: {
        category: "public.app-category.utilities",
        icon: "assets/Core/AppIconFilePathResolver/app-icon-light.png",
        target: ["dmg", "zip"],
        identity: signed ? undefined : "-",
        hardenedRuntime: true,
        notarize: signed ? { teamId: process.env.APPLE_TEAM_ID } : false,
    },
    publish: null,
};
