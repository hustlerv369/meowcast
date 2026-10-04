import { describe, expect, it, vi } from "vitest";
import {
    chooseSubscriptionModel,
    hasAiDestination,
    isSubscriptionProvider,
    refreshSubscriptionModels,
    type SubscriptionStatus,
} from "./AiSubscription";

describe("subscription model selection", () => {
    it("allows CLI routing without an API endpoint while preserving BYOK endpoint requirements", () => {
        expect(hasAiDestination("codex-subscription", "")).toBe(true);
        expect(hasAiDestination("claude-subscription", "")).toBe(true);
        expect(isSubscriptionProvider("invented-subscription")).toBe(false);
        expect(hasAiDestination("custom", "")).toBe(false);
        expect(hasAiDestination("minimax", "https://example.test/v1")).toBe(true);
    });

    const status: SubscriptionStatus = {
        installed: true,
        authenticated: true,
        models: [{ id: "account-model", name: "Account model" }],
    };

    it("ignores a late account result after switching provider, without overwriting its model", async () => {
        let complete!: (value: SubscriptionStatus) => void;
        let current = true;
        const showStatus = vi.fn();
        const saveModel = vi.fn();
        const refresh = refreshSubscriptionModels({
            load: () =>
                new Promise<SubscriptionStatus>((resolve) => {
                    complete = resolve;
                }),
            isCurrent: () => current,
            currentModel: () => "other-provider-model",
            showStatus,
            saveModel,
        });
        current = false;
        complete(status);
        await refresh;
        expect(showStatus).not.toHaveBeenCalled();
        expect(saveModel).not.toHaveBeenCalled();
    });

    it("keeps an explicit client-default option without fabricating a model name", async () => {
        const saveModel = vi.fn();
        await refreshSubscriptionModels({
            load: async () => ({ ...status, models: [{ id: "default", name: "Claude Code default" }] }),
            isCurrent: () => true,
            currentModel: () => "old-model",
            showStatus: vi.fn(),
            saveModel,
        });
        expect(saveModel).toHaveBeenCalledExactlyOnceWith("default");
    });

    it("uses only a model returned by the signed-in CLI", () => {
        expect(chooseSubscriptionModel(status, "old-api-model")).toBe("account-model");
        expect(chooseSubscriptionModel(status, "account-model")).toBe("account-model");
        expect(chooseSubscriptionModel({ ...status, models: [] }, "old-api-model")).toBe("");
    });

    it("requires explicit choice among multiple models and preserves an available choice", () => {
        const several = { ...status, models: [...status.models, { id: "another-model", name: "Another model" }] };
        expect(chooseSubscriptionModel(several, "old-api-model")).toBe("");
        expect(chooseSubscriptionModel(several, "another-model")).toBe("another-model");
    });

    it("does not infer readiness from a model list when CLI, login or status fails", () => {
        expect(chooseSubscriptionModel({ ...status, installed: false }, "account-model")).toBe("");
        expect(chooseSubscriptionModel({ ...status, authenticated: false }, "account-model")).toBe("");
        expect(chooseSubscriptionModel({ ...status, error: "Check failed" }, "account-model")).toBe("");
    });

    it("allows an explicit test of an installed CLI with unknown authentication without marking it authenticated", () => {
        const unknown: SubscriptionStatus = {
            installed: true,
            authenticated: false,
            authenticationUnknown: true,
            models: [{ id: "default", name: "CLI default" }],
            error: "Test to verify login",
        };
        expect(chooseSubscriptionModel(unknown, "")).toBe("default");
        expect(unknown.authenticated).toBe(false);
        expect(chooseSubscriptionModel({ ...unknown, installed: false }, "")).toBe("");
    });
});
