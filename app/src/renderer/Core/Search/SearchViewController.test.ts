import type { SearchResultItem } from "@common/Core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usageSettingKey } from "./Helpers/usageRanking";
import { useSearchViewController } from "./SearchViewController";

vi.mock("react", () => ({
    useState: (value: unknown) => [value, vi.fn()],
    useRef: (current: unknown) => ({ current }),
}));

describe("successful launcher usage", () => {
    const invokeAction = vi.fn();
    const updateSettingValue = vi.fn();
    const item = {
        id: "app",
        name: "App",
        defaultAction: { handlerId: "OpenFile", argument: "app.exe", description: "Open" },
    } as SearchResultItem;
    let values: Record<string, unknown>;

    beforeEach(() => {
        values = {};
        invokeAction.mockReset().mockResolvedValue(true);
        updateSettingValue.mockReset().mockImplementation(async (key: string, value: unknown) => {
            values[key] = value;
        });
        vi.stubGlobal("window", {
            ContextBridge: {
                getSettingValue: (key: string, fallback: unknown) => values[key] ?? fallback,
                invokeAction,
                updateSettingValue,
            },
        });
    });
    afterEach(() => vi.unstubAllGlobals());
    const controller = () =>
        useSearchViewController({
            searchResultItems: [item],
            excludedSearchResultItemIds: [],
            favoriteSearchResultItemIds: [],
            operatingSystem: "Windows",
        });

    it("records a successful default action after execution", async () => {
        const view = controller();
        expect(updateSettingValue).not.toHaveBeenCalled();
        await view.invokeAction({ action: item.defaultAction, confirmed: true });
        expect(updateSettingValue).toHaveBeenCalledWith(usageSettingKey, { app: 1 });
        expect(invokeAction.mock.invocationCallOrder[0]).toBeLessThan(updateSettingValue.mock.invocationCallOrder[0]);
    });

    it("does not count failed launches or favorite actions", async () => {
        const view = controller();
        invokeAction.mockResolvedValueOnce(false);
        await view.invokeAction({ action: item.defaultAction, confirmed: true });
        await view.invokeAction({
            action: { handlerId: "Favorites", argument: "app", description: "Pin" },
            confirmed: true,
        });
        expect(updateSettingValue).not.toHaveBeenCalled();
    });

    it("serializes overlapping successful launches without losing counts", async () => {
        const view = controller();
        await Promise.all([
            view.invokeAction({ action: item.defaultAction, confirmed: true }),
            view.invokeAction({ action: item.defaultAction, confirmed: true }),
        ]);
        expect(values[usageSettingKey]).toEqual({ app: 2 });
    });
});
