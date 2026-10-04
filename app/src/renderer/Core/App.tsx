import { FluentProvider } from "@fluentui/react-components";
import type { IpcRendererEvent } from "electron";
import { changeLanguage } from "i18next";
import { useContext, useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import { Extension } from "./Extension";
import { getAppCssProperties } from "./getAppCssProperties";
import { useExcludedSearchResultItems, useFavorites, useScrollBar, useSearchResultItems, useSetting } from "./Hooks";
import { useI18n } from "./I18n";
import { Search } from "./Search";
import { ThemeContext } from "./Theme";
import { StudioWelcome } from "./Theme/StudioWelcome";

export const App = () => {
    const { fluentUiTheme, shouldUseDarkColors } = useContext(ThemeContext);
    const { searchResultItems } = useSearchResultItems();
    const { excludedSearchResultItemIds } = useExcludedSearchResultItems();
    const { favorites } = useFavorites();
    const [showAppearance, setShowAppearance] = useState(false);
    const [onboardingComplete, setOnboardingComplete] = useState(
        window.ContextBridge.getSettingValue("studio.onboardingComplete", false),
    );

    const { value: backgroundMaterial } = useSetting({ key: "window.backgroundMaterial", defaultValue: "Mica" });
    const { value: acrylicOpacity } = useSetting({ key: "window.acrylicOpacity", defaultValue: 0.6 });
    const { value: vibrancy } = useSetting({ key: "window.vibrancy", defaultValue: "None" });

    const { appCssProperties } = getAppCssProperties({
        shouldUseDarkColors,
        acrylicOpacity,
        backgroundMaterial,
        vibrancy,
    });

    useI18n();
    useScrollBar({ fluentUiTheme });

    const navigate = useNavigate();
    const { pathname } = useLocation();
    useEffect(() => {
        const mode =
            !onboardingComplete || showAppearance
                ? "appearance"
                : pathname === "/extension/Ai" ||
                    pathname === "/extension/Whiteboard" ||
                    pathname === "/extension/Notes"
                  ? "composer"
                  : "launcher";
        window.ContextBridge.ipcRenderer.send("studioSetWindowMode", mode);
    }, [onboardingComplete, showAppearance, pathname]);

    useEffect(() => {
        const appearanceHandler = () => setShowAppearance(true);
        window.addEventListener("studio:appearance", appearanceHandler);
        const navigateToEventHandler = (_: IpcRendererEvent, { pathname }: { pathname: string }) => {
            // Pass the path as a string so react-router splits off any "?query" part
            // into location.search (object form treats it as a literal pathname).
            navigate(pathname);
        };

        const changeLanguageEventHandler = () => {
            changeLanguage(window.ContextBridge.getSettingValue<string>("general.language", "en-US"));
        };

        window.ContextBridge.ipcRenderer.on("navigateTo", navigateToEventHandler);
        window.ContextBridge.ipcRenderer.on("settingUpdated[general.language]", changeLanguageEventHandler);

        return () => {
            window.removeEventListener("studio:appearance", appearanceHandler);
            window.ContextBridge.ipcRenderer.off("navigateTo", navigateToEventHandler);
            window.ContextBridge.ipcRenderer.off("settingUpdated[general.language]", changeLanguageEventHandler);
        };
    }, []);

    return (
        <FluentProvider className="studio-app" theme={fluentUiTheme} style={appCssProperties}>
            {!onboardingComplete || showAppearance ? (
                <StudioWelcome
                    firstRun={!onboardingComplete}
                    onDone={(openAi) => {
                        setOnboardingComplete(true);
                        setShowAppearance(false);

                        if (openAi) {
                            window.ContextBridge.openSettings("/extension/Ai");
                        }
                    }}
                />
            ) : (
                <Routes>
                    <Route
                        path="/"
                        element={
                            <Search
                                searchResultItems={searchResultItems}
                                excludedSearchResultItemIds={excludedSearchResultItemIds}
                                favoriteSearchResultItemIds={favorites}
                            />
                        }
                    />
                    <Route path="/extension/:extensionId" element={<Extension />} />
                </Routes>
            )}
        </FluentProvider>
    );
};
