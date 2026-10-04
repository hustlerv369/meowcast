import { aiProviders, isAiProviderId } from "@common/Extensions/Ai/AiProviders";
import type { SubscriptionStatus } from "@common/Extensions/Ai/SubscriptionStatus";
export type { SubscriptionStatus } from "@common/Extensions/Ai/SubscriptionStatus";

export const hasAiDestination = (provider: string, endpoint: string): boolean =>
    isSubscriptionProvider(provider) || !!endpoint;

export const isSubscriptionProvider = (provider: string): boolean =>
    isAiProviderId(provider) && !!aiProviders[provider].subscription;

export const refreshSubscriptionModels = async (options: {
    load: () => Promise<SubscriptionStatus>;
    isCurrent: () => boolean;
    currentModel: () => string;
    showStatus: (status: SubscriptionStatus) => void;
    saveModel: (model: string) => Promise<void>;
}): Promise<void> => {
    const status = await options.load();

    if (!options.isCurrent()) {
        return;
    }

    options.showStatus(status);
    const current = options.currentModel();
    const next = chooseSubscriptionModel(status, current);

    if (next !== current) {
        await options.saveModel(next);
    }
};

/** Keep a supported choice, or use the only offered model. Never guess a model ID. */
export const chooseSubscriptionModel = (status: SubscriptionStatus, current: string): string => {
    if (!status.installed || (!status.authenticationUnknown && (!status.authenticated || status.error))) {
        return "";
    }

    if (status.models.some((model) => model.id === current)) {
        return current;
    }

    return status.models.length === 1 ? status.models[0].id : "";
};
