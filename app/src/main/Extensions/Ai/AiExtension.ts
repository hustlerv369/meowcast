import type { AssetPathResolver } from "@Core/AssetPathResolver";
import type { EventSubscriber } from "@Core/EventSubscriber";
import type { Extension } from "@Core/Extension";
import type { SettingsManager } from "@Core/SettingsManager";
import type { Translator } from "@Core/Translator";
import type { InstantSearchResultItems, SearchResultItem } from "@common/Core";
import { getExtensionSettingKey } from "@common/Core/Extension";
import type { Image } from "@common/Core/Image";
import { resolveAiBaseUrl } from "@common/Extensions/Ai/AiProviders";
import type { Net, WebContents } from "electron";
import {
    antigravitySubscriptionCompletion,
    findAntigravityExecutable,
    getAntigravitySubscriptionStatus,
} from "./AntigravitySubscription";
import { claudeSubscriptionCompletion, findClaudeExecutable, getClaudeSubscriptionStatus } from "./ClaudeSubscription";
import { findCodexExecutable, getSubscriptionStatus, subscriptionCompletion } from "./CodexSubscription";
import {
    findGeminiInstallation,
    geminiSubscriptionCompletion,
    getGeminiSubscriptionStatus,
} from "./GeminiSubscription";
import { nativeSelection } from "./NativeSelection";
import type { Settings } from "./Settings";
import { streamAnthropic } from "./streamAnthropic";
import { streamCompletion } from "./streamCompletion";

const TRIGGER_PREFIX = "ai ";
const SUBSCRIPTIONS = ["codex-subscription", "claude-subscription", "gemini-subscription", "antigravity-subscription"];

export class AiExtension implements Extension {
    public readonly id = "Ai";
    public readonly name = "AI Assistant";

    public readonly nameTranslation = {
        key: "extensionName",
        namespace: "extension[Ai]",
    };

    public readonly author = {
        name: "Hustler",
        githubUserName: "hustlerv369",
    };

    private readonly defaultSettings: Settings = {
        provider: "minimax",
        apiKey: "",
        // Empty by default: known providers resolve their base URL from the preset (resolveAiBaseUrl),
        // and "custom" must supply its own. A non-empty default here would let a custom provider's key
        // silently fall back to (and be sent to) this host.
        baseUrl: "",
        model: "MiniMax-M3",
        systemPrompt: "You are a helpful assistant. Be concise and direct.",
    };

    public constructor(
        private readonly net: Net,
        private readonly assetPathResolver: AssetPathResolver,
        private readonly settingsManager: SettingsManager,
        private readonly translator: Translator,
        eventSubscriber?: EventSubscriber,
    ) {
        eventSubscriber?.subscribe("settingUpdated[privacy.offline]", () => {
            if (this.settingsManager.getValue("privacy.offline", false)) {
                for (const controller of this.requests.values()) {
                    controller.abort();
                }
            }
        });
    }

    public async getSearchResultItems(): Promise<SearchResultItem[]> {
        const { t } = this.translator.createT(this.getI18nResources());
        return [
            {
                id: "Ai:studio",
                name: t("studioName"),
                description: t("studioDescription"),
                image: this.getImage(),
                defaultAction: {
                    argument: JSON.stringify({ browserWindowId: "search", pathname: "/extension/Ai" }),
                    description: t("openStudioDescription"),
                    handlerId: "navigateTo",
                    fluentIcon: "OpenRegular",
                },
            },
        ];
    }

    public getInstantSearchResultItems(searchTerm: string): InstantSearchResultItems {
        const { t } = this.translator.createT(this.getI18nResources());

        const lower = searchTerm.trimStart().toLowerCase();

        if (!lower.startsWith(TRIGGER_PREFIX)) {
            return { before: [], after: [] };
        }

        const query = searchTerm.trimStart().slice(TRIGGER_PREFIX.length).trim();

        if (!query) {
            return { before: [], after: [] };
        }

        const encodedQuery = encodeURIComponent(query);
        return {
            before: [
                {
                    id: `Ai:ask:${query.slice(0, 80)}`,
                    name: query,
                    description: t("askAiDescription"),
                    image: this.getImage(),
                    defaultAction: {
                        argument: JSON.stringify({
                            browserWindowId: "search",
                            pathname: `/extension/Ai?q=${encodedQuery}`,
                        }),
                        description: t("openChatDescription"),
                        handlerId: "navigateTo",
                        fluentIcon: "OpenRegular",
                    },
                },
            ],
            after: [],
        };
    }

    private readonly requests = new Map<string, AbortController>();
    private statusSequence = 0;
    private sessionKey = "";
    private sessionEndpoint = "";
    private currentSessionKey(): string {
        const endpoint = resolveAiBaseUrl(
            this.getSettingValue<string>("provider"),
            this.getSettingValue<string>("baseUrl"),
        );
        return this.sessionEndpoint === endpoint ? this.sessionKey : "";
    }
    public async invoke(argument: unknown, sender?: WebContents): Promise<unknown> {
        const command =
            argument && typeof argument === "object" && !Array.isArray(argument)
                ? (argument as {
                      command?: string;
                      requestId?: string;
                      messages?: unknown;
                      text?: string;
                      token?: string;
                      apiKey?: string;
                  })
                : undefined;

        if (command?.command === "getSelectionStatus") {
            return nativeSelection.shortcutStatus;
        }

        if (command?.command === "getConnectionStatus") {
            if (SUBSCRIPTIONS.includes(this.getSettingValue<string>("provider"))) {
                return { configured: false, sessionOnly: false };
            }

            return {
                configured: !!(this.currentSessionKey() || this.getSettingValue<string>("apiKey", true)),
                sessionOnly: !!this.currentSessionKey(),
            };
        }

        if (command?.command === "getSubscriptionStatus") {
            const provider = this.getSettingValue<string>("provider");
            const claude = provider === "claude-subscription";
            const gemini = provider === "gemini-subscription";
            const antigravity = provider === "antigravity-subscription";

            if (this.settingsManager.getValue("privacy.offline", false)) {
                return {
                    installed: !!(antigravity
                        ? findAntigravityExecutable()
                        : gemini
                          ? findGeminiInstallation()
                          : claude
                            ? findClaudeExecutable()
                            : findCodexExecutable()),
                    authenticated: false,
                    models: [],
                    error: "Offline mode is enabled. Turn it off before checking your subscription.",
                };
            }

            const controller = new AbortController();
            const key = `status:${sender?.id ?? 0}:${++this.statusSequence}`;
            const onDestroyed = () => controller.abort();
            this.requests.set(key, controller);
            sender?.once("destroyed", onDestroyed);

            try {
                const status = await (antigravity
                    ? getAntigravitySubscriptionStatus()
                    : gemini
                      ? getGeminiSubscriptionStatus()
                      : claude
                        ? getClaudeSubscriptionStatus(controller.signal)
                        : getSubscriptionStatus(controller.signal));

                if (controller.signal.aborted) {
                    throw new Error("Subscription check cancelled.");
                }

                return {
                    ...status,
                    ...((gemini || antigravity) && status.installed && !status.authenticated
                        ? { authenticationUnknown: true }
                        : {}),
                };
            } finally {
                this.requests.delete(key);
                sender?.removeListener("destroyed", onDestroyed);
            }
        }

        if (command?.command === "setSessionKey") {
            if (!sender || typeof command.apiKey !== "string" || command.apiKey.length > 10000) {
                throw new Error("Invalid session credential.");
            }

            this.sessionKey = command.apiKey;
            this.sessionEndpoint = resolveAiBaseUrl(
                this.getSettingValue<string>("provider"),
                this.getSettingValue<string>("baseUrl"),
            );
            return { configured: !!command.apiKey, sessionOnly: true };
        }

        if (command?.command === "getSelection") {
            return nativeSelection.latest(sender);
        }

        if (command?.command === "captureSelection") {
            return nativeSelection.capture(sender);
        }

        if (command?.command === "insertSelection") {
            return nativeSelection.insert(sender, command.token, command.text);
        }

        const requestId = command?.requestId;
        const key = `${sender?.id ?? 0}:${requestId}`;

        if (command?.command === "cancel") {
            const controller = this.requests.get(key);
            controller?.abort();
            return { cancelled: !!controller };
        }

        const streaming = command?.command === "stream";

        if (command && !streaming) {
            throw new Error("Unknown AI command.");
        }

        if (streaming && (!sender || typeof requestId !== "string" || !/^[\w-]{1,100}$/.test(requestId))) {
            throw new Error("Invalid request identifier.");
        }

        const messages = AiExtension.toMessages(streaming ? command.messages : argument);

        if (!messages.length || messages.some((m) => m.content.length > 100000)) {
            throw new Error("Provide text up to 100,000 characters per message.");
        }

        if (this.requests.has(key)) {
            throw new Error("Request already running.");
        }

        const controller = new AbortController();
        this.requests.set(key, controller);
        const onDestroyed = () => controller.abort();
        sender?.once("destroyed", onDestroyed);

        try {
            const provider = this.getSettingValue<string>("provider");

            if (SUBSCRIPTIONS.includes(provider)) {
                if (this.settingsManager.getValue("privacy.offline", false)) {
                    throw new Error("Offline mode is enabled.");
                }

                const complete =
                    provider === "antigravity-subscription"
                        ? antigravitySubscriptionCompletion
                        : provider === "gemini-subscription"
                          ? geminiSubscriptionCompletion
                          : provider === "claude-subscription"
                            ? claudeSubscriptionCompletion
                            : subscriptionCompletion;
                const answer = await complete(
                    this.getSettingValue<string>("model"),
                    this.getSettingValue<string>("systemPrompt"),
                    messages,
                    controller.signal,
                    (delta) => {
                        if (streaming && sender && !sender.isDestroyed()) {
                            sender.send("aiStream", { requestId, delta });
                        }
                    },
                );
                return { query: messages[messages.length - 1].content, answer };
            }

            const complete = ["anthropic", "custom-anthropic"].includes(provider) ? streamAnthropic : streamCompletion;
            const answer = await complete(
                this.net.fetch.bind(this.net),
                {
                    apiKey: this.currentSessionKey() || this.getSettingValue<string>("apiKey", true),
                    baseUrl: resolveAiBaseUrl(
                        this.getSettingValue<string>("provider"),
                        this.getSettingValue<string>("baseUrl"),
                    ),
                    model: this.getSettingValue<string>("model"),
                    systemPrompt: this.getSettingValue<string>("systemPrompt"),
                    messages,
                },
                controller,
                (delta) => {
                    if (streaming && sender && !sender.isDestroyed()) {
                        sender.send("aiStream", { requestId, delta });
                    }
                },
            );
            return { query: messages[messages.length - 1].content, answer };
        } finally {
            this.requests.delete(key);
            sender?.removeListener("destroyed", onDestroyed);
        }
    }

    private static toMessages(argument: unknown): Array<{ role: "user" | "assistant"; content: string }> {
        if (Array.isArray(argument)) {
            return argument
                .filter(
                    (message): message is { role: "user" | "assistant"; content: string } =>
                        (message?.role === "user" || message?.role === "assistant") &&
                        typeof message?.content === "string" &&
                        message.content.trim().length > 0,
                )
                .slice(-20); // cap context at the last 20 turns
        }

        const query = String(argument ?? "").trim();
        return query ? [{ role: "user", content: query }] : [];
    }

    public isSupported(): boolean {
        return true;
    }

    public getSettingDefaultValue(key: keyof Settings) {
        return this.defaultSettings[key];
    }

    public getImage(): Image {
        return {
            url: `file://${this.assetPathResolver.getExtensionAssetPath(this.id, "icon.svg")}`,
        };
    }

    public getSettingKeysTriggeringRescan() {
        return ["general.language"];
    }

    public getI18nResources() {
        return {
            "en-US": {
                studioName: "Text studio · Prompt Master",
                studioDescription: "Build prompts offline, with optional AI assistance",
                openStudioDescription: "Open text studio",
                extensionName: "AI Assistant",
                askAiDescription: "Ask AI",
                openChatDescription: "Open AI Chat",
                settingsApiKey: "API Key",
                settingsBaseUrl: "API Base URL",
                settingsModel: "Model",
                settingsSystemPrompt: "System Prompt",
                missingApiKey: "API key not set. Go to Settings → AI Assistant to add it.",
                apiError: "API error",
            },
            "cs-CZ": {
                studioName: "Text studio · Prompt Master",
                studioDescription: "Tvorba promptů offline s volitelnou pomocí AI",
                openStudioDescription: "Otevřít textové studio",
                extensionName: "AI Asistent",
                askAiDescription: "Zeptat se AI",
                openChatDescription: "Otevřít AI Chat",
                settingsApiKey: "API klíč",
                settingsBaseUrl: "Base URL API",
                settingsModel: "Model",
                settingsSystemPrompt: "Systémový prompt",
                missingApiKey: "API klíč není nastaven. Jdi do Nastavení → AI Asistent.",
                apiError: "Chyba API",
            },
        };
    }

    private getSettingValue<T>(key: keyof Settings, isSensitive = false): T {
        const value = this.settingsManager.getValue<T>(
            getExtensionSettingKey(this.id, key),
            this.defaultSettings[key] as T,
            isSensitive,
        );

        // An empty model is intentional for providers that require explicit selection.
        if (key !== "model" && value === ("" as unknown as T)) {
            return this.defaultSettings[key] as T;
        }

        return value;
    }
}
