import type { AiProviderId } from "@common/Extensions/Ai/AiProviders";

export type Settings = {
    provider: AiProviderId;
    apiKey: string;
    /** Only used when provider === "custom"; presets resolve their own base URL. */
    baseUrl: string;
    model: string;
    systemPrompt: string;
};
