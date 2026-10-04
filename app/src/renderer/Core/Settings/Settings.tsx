import { StudioWordmark } from "@Core/Components/StudioWordmark";
import { useScrollBar } from "@Core/Hooks";
import { useI18n } from "@Core/I18n";
import { ThemeContext } from "@Core/Theme";
import { FluentProvider } from "@fluentui/react-components";
import type { IpcRendererEvent } from "electron";
import { useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Route, Routes, useNavigate } from "react-router";
import { ExtensionSettings } from "./ExtensionSettings";
import { Navigation } from "./Navigation";
import { settingsPages } from "./Pages";

export const Settings = () => {
    const { fluentUiTheme } = useContext(ThemeContext);

    useI18n();
    const { t } = useTranslation("general");
    const isWindows = window.ContextBridge.getOperatingSystem() === "Windows";
    const contentHeight = isWindows ? "calc(100vh - 40px)" : "100vh";
    useScrollBar({ fluentUiTheme });

    const navigate = useNavigate();

    useEffect(() => {
        const navigateToEventHandler = (_: IpcRendererEvent, { pathname }: { pathname: string }) => {
            navigate({ pathname });
        };

        window.ContextBridge.ipcRenderer.on("navigateTo", navigateToEventHandler);

        return () => {
            window.ContextBridge.ipcRenderer.off("navigateTo", navigateToEventHandler);
        };
    }, []);

    return (
        <FluentProvider
            className="studio-settings"
            theme={fluentUiTheme}
            style={{
                minHeight: "100vh",
                background: "var(--studio-surface)",
                color: "var(--studio-text)",
            }}
        >
            <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
                {isWindows && (
                    <header className="studio-settings-titlebar draggable-area">
                        <StudioWordmark />
                        <span className="studio-caption">{t("settings")}</span>
                    </header>
                )}
                <div
                    style={{
                        flexGrow: 1,
                        display: "flex",
                        flexDirection: "row",
                        boxSizing: "border-box",
                        height: contentHeight,
                        minHeight: 0,
                        width: "100%",
                        overflow: "hidden",
                    }}
                >
                    <div
                        className="studio-settings-sidebar"
                        style={{
                            display: "flex",
                            flexShrink: 0,
                            minWidth: 0,
                            background: "var(--studio-bg)",
                            borderRight: "1px solid var(--studio-border)",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 20,
                                boxSizing: "border-box",
                                height: contentHeight,
                                minWidth: 0,
                                overflowX: "hidden",
                                overflowY: "auto",
                            }}
                        >
                            <Navigation settingsPages={settingsPages} />
                        </div>
                    </div>
                    <div
                        className="studio-settings-content"
                        style={{
                            height: contentHeight,
                            flexGrow: 1,
                            overflowY: "auto",
                            padding: "28px 32px",
                            boxSizing: "border-box",
                            background: "var(--studio-surface)",
                        }}
                    >
                        <Routes>
                            {settingsPages.map(({ element, relativePath }) => (
                                <Route
                                    key={`settings-page-content-${relativePath}`}
                                    path={relativePath}
                                    element={element}
                                />
                            ))}
                            <Route path="/extension/:extensionId" element={<ExtensionSettings />} />
                        </Routes>
                    </div>
                </div>
            </div>
        </FluentProvider>
    );
};
