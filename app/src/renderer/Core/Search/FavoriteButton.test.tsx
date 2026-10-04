import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavoriteButton } from "./FavoriteButton";

const host = vi.hoisted(() => ({ setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async (importOriginal) => ({
    ...(await importOriginal<typeof React>()),
    useState: (value: boolean) => {
        const set = vi.fn();
        host.setters.push(set);
        return [value, set];
    },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("favorite star", () => {
    const invokeAction = vi.fn();
    beforeEach(() => {
        host.setters = [];
        invokeAction.mockReset().mockResolvedValue(true);
        vi.stubGlobal("window", { ContextBridge: { invokeAction } });
    });
    afterEach(() => vi.unstubAllGlobals());

    it.each([false, true])(
        "toggles saved state %s through the existing favorites action without launching the row",
        async (isFavorite) => {
            const button = FavoriteButton({ id: "app:notepad", name: "Notepad", isFavorite });
            const stopPropagation = vi.fn();
            expect(button.props["aria-pressed"]).toBe(isFavorite);
            expect(button.props["aria-label"]).toContain("Notepad");
            await button.props.onClick({ stopPropagation });
            expect(stopPropagation).toHaveBeenCalledOnce();
            expect(invokeAction).toHaveBeenCalledOnce();
            const action = invokeAction.mock.calls[0][0];
            expect(action.handlerId).toBe("Favorites");
            expect(JSON.parse(action.argument)).toEqual({ action: isFavorite ? "Remove" : "Add", id: "app:notepad" });
            expect(host.setters[0].mock.calls).toEqual([[true], [false]]);
        },
    );

    it("surfaces failed persistence and allows retry", async () => {
        invokeAction.mockResolvedValue(false);
        await FavoriteButton({ id: "app", name: "App", isFavorite: false }).props.onClick({ stopPropagation: vi.fn() });
        expect(host.setters[1]).toHaveBeenLastCalledWith(true);
        expect(host.setters[0]).toHaveBeenLastCalledWith(false);
    });

    it("stops a double-click from invoking the parent item", () => {
        const stopPropagation = vi.fn();
        FavoriteButton({ id: "app", name: "App", isFavorite: true }).props.onDoubleClick({ stopPropagation });
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(invokeAction).not.toHaveBeenCalled();
    });
});
