import type { SearchResultItemAction } from "@common/Core";
import type { Shell } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { CustomWebBrowserActionHandler } from "./CustomWebBrowser";
import { UrlActionHandler } from "./UrlActionHandler";

describe(UrlActionHandler, () => {
    it("should open the URL with the system's default web browser if the custom web browser action handler is disabled", async () => {
        const openExternalMock = vi.fn().mockReturnValue(Promise.resolve());
        const shell = <Shell>{ openExternal: (url) => openExternalMock(url) };

        const customWebBrowserActionHandler = <CustomWebBrowserActionHandler>{
            isEnabled: () => false,
            openUrl: () => Promise.resolve(),
        };

        const actionHandler = new UrlActionHandler(shell, customWebBrowserActionHandler);
        await actionHandler.invokeAction(<SearchResultItemAction>{ argument: "https://example.com/" });

        expect(openExternalMock).toHaveBeenCalledWith("https://example.com/");
    });

    it("should open the URL with the custom web browser action handler if it's enabled", async () => {
        const openUrlMock = vi.fn().mockReturnValue(Promise.resolve());

        const customWebBrowserActionHandler = <CustomWebBrowserActionHandler>{
            isEnabled: () => true,
            openUrl: (url) => openUrlMock(url),
        };

        const actionHandler = new UrlActionHandler(<Shell>{}, customWebBrowserActionHandler);
        await actionHandler.invokeAction(<SearchResultItemAction>{ argument: "https://example.com/" });

        expect(openUrlMock).toHaveBeenCalledWith("https://example.com/");
    });
    it.each(["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "ms-msdt:/id", "not a URL"])(
        "rejects unsafe web target %s before either browser path",
        async (argument) => {
            const openExternal = vi.fn();
            const openUrl = vi.fn();

            for (const enabled of [true, false]) {
                const handler = new UrlActionHandler({ openExternal } as unknown as Shell, {
                    isEnabled: () => enabled,
                    openUrl,
                });
                await expect(handler.invokeAction({ argument } as SearchResultItemAction)).rejects.toThrow();
            }

            expect(openExternal).not.toHaveBeenCalled();
            expect(openUrl).not.toHaveBeenCalled();
        },
    );
});
