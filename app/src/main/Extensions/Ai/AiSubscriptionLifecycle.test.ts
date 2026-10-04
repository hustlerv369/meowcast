import type { AssetPathResolver } from "@Core/AssetPathResolver";
import type { EventSubscriber } from "@Core/EventSubscriber";
import type { SettingsManager } from "@Core/SettingsManager";
import type { Translator } from "@Core/Translator";
import type { Net, WebContents } from "electron";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiExtension } from "./AiExtension";
import { getSubscriptionStatus, subscriptionCompletion } from "./CodexSubscription";
import { geminiSubscriptionCompletion, getGeminiSubscriptionStatus } from "./GeminiSubscription";

vi.mock("./NativeSelection", () => ({ nativeSelection: {} }));
vi.mock("./CodexSubscription", () => ({
    findCodexExecutable: () => "codex.exe",
    getSubscriptionStatus: vi.fn(),
    subscriptionCompletion: vi.fn(),
}));
vi.mock("./GeminiSubscription", () => ({
    findGeminiInstallation: () => ({ node: "node.exe", entry: "gemini.js" }),
    getGeminiSubscriptionStatus: vi.fn(),
    geminiSubscriptionCompletion: vi.fn(),
}));

const setup = (provider = "codex-subscription") => {
    let offline = false;
    let changed: () => void = () => {};
    const events = {
        subscribe: (name: string, handler: () => void) => {
            expect(name).toBe("settingUpdated[privacy.offline]");
            changed = handler;
        },
    } as EventSubscriber;
    const settings = {
        getValue: (key: string, fallback: unknown) => {
            if (key === "privacy.offline") {
                return offline;
            }

            if (key === "extension[Ai].provider") {
                return provider;
            }

            if (key === "extension[Ai].model") {
                return "default";
            }

            if (key === "extension[Ai].apiKey") {
                throw new Error("Unexpected secret read");
            }

            return fallback;
        },
    } as SettingsManager;
    const sender = Object.assign(new EventEmitter(), { id: 7 }) as unknown as WebContents;
    const extension = new AiExtension({} as Net, {} as AssetPathResolver, settings, {} as Translator, events);
    return {
        extension,
        sender,
        offline: () => {
            offline = true;
            changed();
        },
    };
};

describe("subscription lifecycle", () => {
    beforeEach(() => vi.resetAllMocks());
    it("cancels an active CLI completion when offline mode is enabled", async () => {
        let signal: AbortSignal | undefined;
        vi.mocked(subscriptionCompletion).mockImplementation(async (_model, _prompt, _messages, value) => {
            signal = value;
            return new Promise((_resolve, reject) =>
                value.addEventListener("abort", () => reject(new Error("cancelled"))),
            );
        });
        const fixture = setup();
        const request = fixture.extension.invoke([{ role: "user", content: "Test" }], fixture.sender);
        fixture.offline();
        await expect(request).rejects.toThrow("cancelled");
        expect(signal?.aborted).toBe(true);
        expect(fixture.sender.listenerCount("destroyed")).toBe(0);
    });
    it.each(["offline", "destroyed"])(
        "cancels status on %s and discards stale authenticated results",
        async (cause) => {
            let signal: AbortSignal | undefined;
            vi.mocked(getSubscriptionStatus).mockImplementation(async (value) => {
                signal = value;
                return new Promise((resolve) =>
                    value?.addEventListener("abort", () =>
                        resolve({ installed: true, authenticated: true, models: [] }),
                    ),
                );
            });
            const fixture = setup();
            const request = fixture.extension.invoke({ command: "getSubscriptionStatus" }, fixture.sender);

            if (cause === "offline") {
                fixture.offline();
            } else {
                fixture.sender.emit("destroyed");
            }

            await expect(request).rejects.toThrow("Subscription check cancelled.");
            expect(signal?.aborted).toBe(true);
            expect(fixture.sender.listenerCount("destroyed")).toBe(0);
        },
    );
    it("reports unknown Gemini authentication and routes explicit text requests without API keys", async () => {
        vi.mocked(getGeminiSubscriptionStatus).mockResolvedValue({
            installed: true,
            authenticated: false,
            models: [{ id: "default", name: "Gemini CLI default" }],
        });
        vi.mocked(geminiSubscriptionCompletion).mockResolvedValue("Fixture answer");
        const fixture = setup("gemini-subscription");
        expect(await fixture.extension.invoke({ command: "getSubscriptionStatus" })).toMatchObject({
            authenticationUnknown: true,
            authenticated: false,
        });
        expect(await fixture.extension.invoke([{ role: "user", content: "Test" }])).toEqual({
            query: "Test",
            answer: "Fixture answer",
        });
        expect(geminiSubscriptionCompletion).toHaveBeenCalledOnce();
        expect(getSubscriptionStatus).not.toHaveBeenCalled();
    });
});
