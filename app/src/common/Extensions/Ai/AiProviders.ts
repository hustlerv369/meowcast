/**
 * Bring-your-own-key providers for the AI Assistant extension.
 *
 * API connections support OpenAI Chat Completions and Anthropic Messages.
 * Subscription connections use their official local client and its login.
 * No connection falls back to a different account or billing method.
 */

export type AiProviderId =
    | "minimax"
    | "openrouter"
    | "custom"
    | "custom-anthropic"
    | "openai"
    | "anthropic"
    | "gemini"
    | "antigravity-subscription"
    | "codex-subscription"
    | "claude-subscription";

export type AiProviderPreset = {
    subscription?: { clientName: string; loginCommand: string; helpUrl: string };
    id: AiProviderId;
    label: string;
    /** OpenAI-compatible base URL (without trailing `/chat/completions`). Empty for "custom". */
    baseUrl: string;
    defaultModel: string;
    /** Curated popular models shown as quick-pick suggestions; the user may type any model. */
    models: string[];
    /** Page where the user creates/copies an API key. */
    apiKeyUrl: string;
    keyHint: string;
};

export const aiProviders: Record<AiProviderId, AiProviderPreset> = {
    "antigravity-subscription": {
        subscription: {
            clientName: "Antigravity CLI",
            loginCommand: "agy",
            helpUrl: "https://www.antigravity.google/docs/cli/headless/",
        },
        id: "antigravity-subscription",
        label: "Antigravity CLI (compatibility test)",
        baseUrl: "",
        defaultModel: "",
        models: [],
        apiKeyUrl: "",
        keyHint: "",
    },
    openai: {
        id: "openai",
        label: "OpenAI API",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "",
        models: [],
        apiKeyUrl: "https://platform.openai.com/api-keys",
        keyHint: "OpenAI API key",
    },
    anthropic: {
        id: "anthropic",
        label: "Anthropic API",
        baseUrl: "https://api.anthropic.com/v1",
        defaultModel: "",
        models: [],
        apiKeyUrl: "https://platform.claude.com/settings/keys",
        keyHint: "Anthropic API key",
    },
    gemini: {
        id: "gemini",
        label: "Google Gemini API",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        defaultModel: "",
        models: [],
        apiKeyUrl: "https://aistudio.google.com/apikey",
        keyHint: "Gemini API key",
    },
    "custom-anthropic": {
        id: "custom-anthropic",
        label: "Custom (Anthropic-compatible)",
        baseUrl: "",
        defaultModel: "",
        models: [],
        apiKeyUrl: "",
        keyHint: "API key",
    },
    "claude-subscription": {
        subscription: {
            clientName: "Claude Code",
            loginCommand: "claude auth login --claudeai",
            helpUrl: "https://code.claude.com/docs/en/setup",
        },
        id: "claude-subscription",
        label: "Claude subscription (Claude Code)",
        baseUrl: "",
        defaultModel: "",
        models: [],
        apiKeyUrl: "",
        keyHint: "",
    },
    "codex-subscription": {
        subscription: {
            clientName: "Codex",
            loginCommand: "codex login",
            helpUrl: "https://developers.openai.com/codex/cli",
        },
        id: "codex-subscription",
        label: "ChatGPT subscription (Codex)",
        baseUrl: "",
        defaultModel: "",
        models: [],
        apiKeyUrl: "",
        keyHint: "",
    },
    minimax: {
        id: "minimax",
        label: "MiniMax",
        baseUrl: "https://api.minimaxi.chat/v1",
        defaultModel: "MiniMax-M3",
        models: ["MiniMax-M3", "MiniMax-Text-01", "abab6.5s-chat"],
        apiKeyUrl: "https://www.minimaxi.com/user-center/basic-information/interface-key",
        keyHint: "MiniMax API key",
    },
    openrouter: {
        id: "openrouter",
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        defaultModel: "openai/gpt-4o-mini",
        models: [
            "openai/gpt-4o-mini",
            "openai/gpt-4o",
            "anthropic/claude-3.7-sonnet",
            "anthropic/claude-3.5-sonnet",
            "google/gemini-2.0-flash-001",
            "deepseek/deepseek-chat",
            "meta-llama/llama-3.3-70b-instruct",
            "x-ai/grok-2-1212",
        ],
        apiKeyUrl: "https://openrouter.ai/keys",
        keyHint: "OpenRouter API key (sk-or-...)",
    },
    custom: {
        id: "custom",
        label: "Custom (OpenAI-compatible)",
        baseUrl: "",
        defaultModel: "",
        models: [],
        apiKeyUrl: "",
        keyHint: "Bearer token",
    },
};

export const aiProviderIds: AiProviderId[] = [
    "codex-subscription",
    "claude-subscription",
    "antigravity-subscription",
    "openai",
    "anthropic",
    "gemini",
    "minimax",
    "openrouter",
    "custom",
    "custom-anthropic",
];

export const isAiProviderId = (value: string): value is AiProviderId => (aiProviderIds as string[]).includes(value);

/** Resolves the effective base URL: preset for known providers, the user's custom URL otherwise. */
export const resolveAiBaseUrl = (provider: string, customBaseUrl: string): string => {
    if (isAiProviderId(provider) && aiProviders[provider].subscription) {
        return "";
    }

    if (isAiProviderId(provider) && provider !== "custom" && aiProviders[provider].baseUrl) {
        return aiProviders[provider].baseUrl;
    }

    return customBaseUrl;
};
