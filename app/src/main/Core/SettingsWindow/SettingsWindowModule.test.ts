import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsWindowModule } from "./SettingsWindowModule";

const { getWindow } = vi.hoisted(() => ({ getWindow: vi.fn() }));
vi.mock("./SettingsWindowManager", () => ({
    SettingsWindowManager: class {
        public getWindow = getWindow;
    },
}));

describe("settings onboarding destination", () => {
    beforeEach(() => vi.clearAllMocks());

    const setup = async () => {
        const handlers = new Map<string, (...args: unknown[]) => Promise<void>>();
        const notify = vi.fn();
        const window = { focus: vi.fn(), show: vi.fn() };
        const modules: Record<string, unknown> = {
            IpcMain: {
                on: (name: string, handler: (...args: unknown[]) => Promise<void>) => handlers.set(name, handler),
            },
            EventSubscriber: { subscribe: vi.fn() },
            NativeTheme: { on: vi.fn() },
            BrowserWindowNotifier: { notify },
        };
        const registry = { get: (key: string) => modules[key] } as unknown as UeliModuleRegistry;
        await SettingsWindowModule.bootstrap(registry);
        return { open: handlers.get("openSettings")!, notify, window };
    };

    it("waits for the settings window to load before routing to provider settings", async () => {
        const { open, notify, window } = await setup();
        let loaded!: (value: typeof window) => void;
        getWindow.mockReturnValue(new Promise<typeof window>((resolve) => (loaded = resolve)));
        const opening = open({}, "/extension/Ai");
        expect(notify).not.toHaveBeenCalled();
        expect(window.show).not.toHaveBeenCalled();
        loaded(window);
        await opening;
        expect(window.show).toHaveBeenCalledOnce();
        expect(window.focus).toHaveBeenCalledOnce();
        expect(notify).toHaveBeenCalledExactlyOnceWith({
            browserWindowId: "settings",
            channel: "navigateTo",
            data: { pathname: "/extension/Ai" },
        });
    });

    it.each([undefined, "/", "/extension/Other", "https://example.com", { pathname: "/extension/Ai" }])(
        "keeps the existing settings page for unsupported destination %j",
        async (destination) => {
            const { open, notify, window } = await setup();
            getWindow.mockResolvedValue(window);
            await open({}, destination);
            expect(window.show).toHaveBeenCalledOnce();
            expect(notify).not.toHaveBeenCalled();
        },
    );
});
