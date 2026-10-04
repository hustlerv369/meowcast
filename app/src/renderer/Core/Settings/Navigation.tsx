import type { ExtensionInfo } from "@common/Core";
import { StudioWordmark } from "@Core/Components/StudioWordmark";
import { getImageUrl } from "@Core/getImageUrl";
import { ThemeContext } from "@Core/Theme";
import {
    Button,
    Input,
    NavDivider,
    NavDrawer,
    NavDrawerBody,
    NavItem,
    NavSectionHeader,
} from "@fluentui/react-components";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import type { SettingsPage } from "./Pages";
import { isSettingsFindShortcut, matchesSettingsSection, SETTINGS_QUERY_LIMIT } from "./settingsSearch";

type NavigationProps = {
    settingsPages: SettingsPage[];
};

export const Navigation = ({ settingsPages }: NavigationProps) => {
    const { shouldUseDarkColors } = useContext(ThemeContext);
    const { t, i18n } = useTranslation();
    const [query, setQuery] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);
    const isCzech = (i18n.resolvedLanguage ?? i18n.language).startsWith("cs");
    const searchLabel = isCzech ? "Hledat sekci nastavení" : "Find settings sections";
    const navigate = useNavigate();
    const { pathname } = useLocation();

    const [enabledExtensions, setEnabledExtensions] = useState<ExtensionInfo[]>(
        window.ContextBridge.getEnabledExtensions(),
    );

    const visiblePages = settingsPages.filter(({ translation, absolutePath }) =>
        matchesSettingsSection(query, t(translation.key, { ns: translation.namespace }), absolutePath),
    );
    const visibleExtensions = enabledExtensions.filter(({ id, name, nameTranslation }) =>
        matchesSettingsSection(
            query,
            nameTranslation ? t(nameTranslation.key, { ns: nameTranslation.namespace }) : name,
            `/extension/${id}`,
            name,
        ),
    );

    useEffect(() => {
        const find = (event: KeyboardEvent) => {
            const modalOpen = !!document.querySelector('[aria-modal="true"], dialog[open]');

            if (isSettingsFindShortcut(event, modalOpen)) {
                event.preventDefault();
                searchRef.current?.focus();
                searchRef.current?.select();
            }
        };
        window.addEventListener("keydown", find);
        return () => window.removeEventListener("keydown", find);
    }, []);

    useEffect(() => {
        const extensionToggleEventHandler = () => {
            setEnabledExtensions(window.ContextBridge.getEnabledExtensions());
        };

        window.ContextBridge.ipcRenderer.on("extensionEnabled", extensionToggleEventHandler);
        window.ContextBridge.ipcRenderer.on("extensionDisabled", extensionToggleEventHandler);

        return () => {
            window.ContextBridge.ipcRenderer.off("extensionEnabled", extensionToggleEventHandler);
            window.ContextBridge.ipcRenderer.off("extensionDisabled", extensionToggleEventHandler);
        };
    }, []);

    return (
        <NavDrawer
            density="small"
            open
            type="inline"
            selectedValue={pathname}
            onNavItemSelect={(_, { value }) => navigate(value)}
            style={{ height: "100%", width: 224, minWidth: 0, overflowX: "hidden" }}
        >
            <NavDrawerBody>
                <div className="studio-settings-wordmark">
                    <StudioWordmark />
                </div>
                <div style={{ padding: "0 8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <label htmlFor="settings-section-search" style={{ fontSize: 14 }}>
                        {searchLabel}
                    </label>
                    <Input
                        id="settings-section-search"
                        ref={searchRef}
                        value={query}
                        maxLength={SETTINGS_QUERY_LIMIT}
                        placeholder={isCzech ? "Název nebo téma" : "Name or topic"}
                        onChange={(_, { value }) => setQuery(value.slice(0, SETTINGS_QUERY_LIMIT))}
                        onKeyDown={(event) => {
                            if (event.key === "Escape" && !event.nativeEvent.isComposing && query) {
                                event.preventDefault();
                                event.stopPropagation();
                                setQuery("");
                            }
                        }}
                        style={{ minWidth: 0, width: "100%", boxSizing: "border-box", fontSize: 14 }}
                    />
                    {query && (
                        <Button
                            appearance="subtle"
                            onClick={() => {
                                setQuery("");
                                searchRef.current?.focus();
                            }}
                        >
                            {isCzech ? "Vymazat hledání" : "Clear search"}
                        </Button>
                    )}
                    {visiblePages.length === 0 && visibleExtensions.length === 0 && (
                        <div role="status" style={{ fontSize: 14 }}>
                            {isCzech
                                ? "Žádná sekce neodpovídá. Zkuste jiné téma."
                                : "No matching sections. Try another topic."}
                        </div>
                    )}
                </div>
                {visiblePages.length > 0 && (
                    <NavSectionHeader>{t("generalSettings", { ns: "general" })}</NavSectionHeader>
                )}
                {visiblePages.map(({ translation, absolutePath, icon }) => (
                    <NavItem
                        key={`settings-page-tab-${absolutePath}`}
                        value={absolutePath}
                        onFocus={() => navigate(absolutePath)}
                        icon={icon}
                    >
                        {t(translation.key, { ns: translation.namespace })}
                    </NavItem>
                ))}
                {visiblePages.length > 0 && visibleExtensions.length > 0 && <NavDivider />}
                {visibleExtensions.length > 0 && (
                    <NavSectionHeader>{t("extensionSettings", { ns: "general" })}</NavSectionHeader>
                )}
                {visibleExtensions.map(({ id, name, nameTranslation, image }) => (
                    <NavItem
                        key={`extension-settings-tab-${id}`}
                        value={`/extension/${id}`}
                        onFocus={() => navigate(`/extension/${id}`)}
                        icon={
                            <div
                                style={{
                                    width: 20,
                                    height: "100%",
                                    display: "flex",
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "center",
                                }}
                            >
                                <img
                                    alt={name}
                                    style={{ maxWidth: "100%", maxHeight: "100%" }}
                                    src={getImageUrl({ image, shouldUseDarkColors })}
                                />
                            </div>
                        }
                    >
                        {nameTranslation ? t(nameTranslation.key, { ns: nameTranslation.namespace }) : name}
                    </NavItem>
                ))}
            </NavDrawerBody>
        </NavDrawer>
    );
};
