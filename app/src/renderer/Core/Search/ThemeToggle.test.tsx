import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

const host = vi.hoisted(() => ({ dark: false, update: vi.fn(), setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async (original) => ({
    ...(await original<typeof React>()),
    useContext: () => ({ shouldUseDarkColors: host.dark }),
    useRef: () => ({ current: false }),
    useState: (initial: boolean) => {
        const setter = vi.fn();
        host.setters.push(setter);
        return [initial, setter];
    },
}));
vi.mock("../Hooks/useSetting", () => ({ useSetting: () => ({ updateValue: host.update }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));

describe("launcher theme toggle", () => {
    beforeEach(() => {
        host.setters = [];
        host.update.mockReset().mockResolvedValue(undefined);
    });
    it.each([false, true])(
        "uses resolved theme %s, including System, to save the opposite explicit mode",
        async (dark) => {
            host.dark = dark;
            const button = ThemeToggle().props.children;
            expect(button.props["aria-pressed"]).toBe(dark);
            expect(button.props.type).toBe("button");
            expect(button.props.className).toContain("non-draggable-area");
            expect(button.props.style.minHeight).toBe(44);
            await button.props.onClick();
            expect(host.update).toHaveBeenCalledExactlyOnceWith(dark ? "light" : "dark");
        },
    );
    it("blocks duplicate activation until persistence completes", async () => {
        let finish!: () => void;
        host.update.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
        );
        const button = ThemeToggle().props.children;
        const first = button.props.onClick();
        await button.props.onClick();
        expect(host.update).toHaveBeenCalledOnce();
        finish();
        await first;
        expect(host.setters[0]).toHaveBeenLastCalledWith(false);
    });
    it("reports rejected persistence and permits retry without pretending it succeeded", async () => {
        host.update.mockRejectedValueOnce(new Error("disk failure"));
        const button = ThemeToggle().props.children;
        await button.props.onClick();
        expect(host.setters[1]).toHaveBeenLastCalledWith(true);
        await button.props.onClick();
        expect(host.update).toHaveBeenCalledTimes(2);
        expect(host.setters[0]).toHaveBeenLastCalledWith(false);
    });
});
