import type { AssetPathResolver } from "@Core/AssetPathResolver";
import type { SettingsManager } from "@Core/SettingsManager";
import type { Translator } from "@Core/Translator";
import { Translator as AppTranslator } from "@Core/Translator/Translator";
import { searchFilter } from "@common/Core/Search/SearchFilter";
import type { Net, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { AiExtension } from "./AiExtension";
vi.mock("./NativeSelection", () => ({
    nativeSelection: { shortcutStatus: { shortcut: "Control+Shift+Space", available: false } },
}));
describe("AI studio discovery", () => {
    it("requires selecting an explicitly empty API model instead of sending the legacy default", async () => {
        const values: Record<string, unknown> = {
            "extension[Ai].provider": "custom",
            "extension[Ai].baseUrl": "https://example.test/v1",
            "extension[Ai].apiKey": "test-key",
            "extension[Ai].model": "",
        };
        const settings = {
            getValue: (key: string, fallback: unknown) => values[key] ?? fallback,
        } as SettingsManager;
        const fetch = vi.fn();
        const extension = new AiExtension(
            { fetch } as unknown as Net,
            {} as AssetPathResolver,
            settings,
            {} as Translator,
        );
        await expect(extension.invoke([{ role: "user", content: "Test" }])).rejects.toThrow("Select a model first.");
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(["codex-subscription", "antigravity-subscription"])(
        "does not read an old API key for %s credential status",
        async (provider) => {
            const settings = {
                getValue: (key: string) => {
                    if (key === "extension[Ai].provider") {
                        return provider;
                    }

                    throw new Error("Unexpected credential read");
                },
            } as unknown as SettingsManager;
            const extension = new AiExtension({} as Net, {} as AssetPathResolver, settings, {} as Translator);
            expect(await extension.invoke({ command: "getConnectionStatus" })).toEqual({
                configured: false,
                sessionOnly: false,
            });
        },
    );

    it.each(["codex-subscription", "antigravity-subscription"])(
        "blocks %s requests offline before any key or subprocess access",
        async (provider) => {
            const settings = {
                getValue: (key: string) => {
                    if (key === "extension[Ai].provider") {
                        return provider;
                    }

                    if (key === "privacy.offline") {
                        return true;
                    }

                    throw new Error("Unexpected setting read");
                },
            } as unknown as SettingsManager;
            const extension = new AiExtension({} as Net, {} as AssetPathResolver, settings, {} as Translator);
            await expect(extension.invoke([{ role: "user", content: "Test" }])).rejects.toThrow("Offline mode");
            expect(await extension.invoke({ command: "getSubscriptionStatus" })).toMatchObject({
                authenticated: false,
                models: [],
                error: "Offline mode is enabled. Turn it off before checking your subscription.",
            });
        },
    );
    const setup = (language = "en-US") => {
        const fetch = vi.fn();
        const getValue = vi.fn((key: string) => {
            if (key !== "general.language") {
                throw new Error("Discovery must not read credentials or AI settings");
            }

            return language;
        });
        const settings = { getValue } as unknown as SettingsManager;
        const extension = new AiExtension(
            { fetch } as unknown as Net,
            { getExtensionAssetPath: () => "icon.svg" } as unknown as AssetPathResolver,
            settings,
            new AppTranslator(settings),
        );
        return { extension, fetch };
    };

    it.each(["en-US", "cs-CZ"])("opens one stable studio entry without a query or key in %s", async (language) => {
        const { extension, fetch } = setup(language);
        const items = await extension.getSearchResultItems();
        expect(items).toHaveLength(1);
        expect(items[0].name).toBe("Text studio · Prompt Master");
        expect(items[0].defaultAction.handlerId).toBe("navigateTo");
        expect(JSON.parse(items[0].defaultAction.argument)).toEqual({
            browserWindowId: "search",
            pathname: "/extension/Ai",
        });
        expect(await extension.getSearchResultItems()).toEqual(items);
        expect(items[0].description).toBe(
            language === "cs-CZ"
                ? "Tvorba promptů offline s volitelnou pomocí AI"
                : "Build prompts offline, with optional AI assistance",
        );

        for (const engine of ["Fuse.js", "fuzzysort"] as const) {
            for (const searchTerm of ["Text studio", "Prompt Master"]) {
                expect(
                    searchFilter(
                        { searchResultItems: items, searchTerm, fuzziness: 0.5, maxSearchResultItems: 10 },
                        engine,
                    ).map((item) => item.id),
                ).toEqual(["Ai:studio"]);
            }
        }

        expect(fetch).not.toHaveBeenCalled();
    });

    it("preserves the query shortcut as navigation only, without auto-sending", () => {
        const { extension, fetch } = setup();
        const result = extension.getInstantSearchResultItems("ai hello & world");
        expect(result.before).toHaveLength(1);
        expect(result.before[0].defaultAction.handlerId).toBe("navigateTo");
        expect(JSON.parse(result.before[0].defaultAction.argument)).toEqual({
            browserWindowId: "search",
            pathname: "/extension/Ai?q=hello%20%26%20world",
        });
        expect(extension.getInstantSearchResultItems("Text studio")).toEqual({ before: [], after: [] });
        expect(extension.getInstantSearchResultItems("Prompt Master")).toEqual({ before: [], after: [] });
        expect(fetch).not.toHaveBeenCalled();
    });
});
describe("AI session credential", () => {
    it("shares only in memory between app windows, bound to destination", async () => {
        const values: Record<string, string> = {
            "extension[Ai].provider": "custom",
            "extension[Ai].baseUrl": "https://one.test",
        };
        const settings = { getValue: (key: string, fallback: string) => values[key] ?? fallback } as SettingsManager;
        const extension = new AiExtension({} as Net, {} as AssetPathResolver, settings, {} as Translator);
        await extension.invoke({ command: "setSessionKey", apiKey: "private-key" }, { id: 1 } as WebContents);
        expect(await extension.invoke({ command: "getConnectionStatus" }, { id: 2 } as WebContents)).toEqual({
            configured: true,
            sessionOnly: true,
        });
        values["extension[Ai].baseUrl"] = "https://other.test";
        expect(await extension.invoke({ command: "getConnectionStatus" }, { id: 2 } as WebContents)).toEqual({
            configured: false,
            sessionOnly: false,
        });
        expect(JSON.stringify(values)).not.toContain("private-key");
    });
});
