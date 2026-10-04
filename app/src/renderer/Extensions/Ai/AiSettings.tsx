import { getExtensionSettingKey } from "@common/Core/Extension";
import { aiProviders, isAiProviderId, resolveAiBaseUrl } from "@common/Extensions/Ai/AiProviders";
import { useExtensionSetting, useSetting } from "@Core/Hooks";
import { Setting } from "@Core/Settings/Setting";
import { SettingGroup } from "@Core/Settings/SettingGroup";
import { SettingGroupList } from "@Core/Settings/SettingGroupList";
import {
    Badge,
    Button,
    Dropdown,
    Input,
    Link,
    Option,
    Spinner,
    Text,
    Textarea,
    tokens,
} from "@fluentui/react-components";
import { CheckmarkCircleRegular, DismissCircleRegular, OpenRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";

import "./AiComposer.css";
import { getAiConnectionResult, safeAiFailure } from "./AiConnectionResult";
import { getAiCopy } from "./AiCopy";
import {
    chooseSubscriptionModel,
    isSubscriptionProvider,
    refreshSubscriptionModels,
    type SubscriptionStatus,
} from "./AiSubscription";

type TestState = { status: "idle" | "loading" | "ok" | "error"; message?: string };

export const AiSettings = () => {
    const { value: language } = useSetting<string>({ key: "general.language", defaultValue: "en-US" });
    const copy = getAiCopy(language);
    const extensionId = "Ai";

    const { value: provider, updateValue: setProvider } = useExtensionSetting<string>({ extensionId, key: "provider" });
    const isSubscription = isSubscriptionProvider(provider);
    const providerRef = useRef(provider);
    providerRef.current = provider;
    const refreshRevision = useRef(0);
    const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
    // Existing secrets never return to the renderer. This field only holds a newly entered key.
    const [apiKey, setApiKeyDraft] = useState("");
    const [savingKey, setSavingKey] = useState(false);
    const [keyConfigured, setKeyConfigured] = useState(false);
    const [sessionOnly, setSessionOnly] = useState(false);
    const refreshKeyStatus = async () => {
        const result = await window.ContextBridge.invokeExtension<
            unknown,
            { configured: boolean; sessionOnly: boolean }
        >(extensionId, { command: "getConnectionStatus" });
        setKeyConfigured(result.configured);
        setSessionOnly(result.sessionOnly);
    };
    const clearSessionKey = () =>
        window.ContextBridge.invokeExtension(extensionId, { command: "setSessionKey", apiKey: "" });
    useEffect(() => {
        if (!isSubscription) {
            void refreshKeyStatus().catch(() => {});
        }
    }, [provider]);
    const setApiKey = (value: string) =>
        window.ContextBridge.updateSettingValue(getExtensionSettingKey(extensionId, "apiKey"), value, true);
    const { value: baseUrl, updateValue: setBaseUrl } = useExtensionSetting<string>({ extensionId, key: "baseUrl" });
    const { value: model, updateValue: setModel } = useExtensionSetting<string>({ extensionId, key: "model" });
    const { value: systemPrompt, updateValue: setSystemPrompt } = useExtensionSetting<string>({
        extensionId,
        key: "systemPrompt",
    });

    const [storageError, setStorageError] = useState("");
    const [test, setTest] = useState<TestState>({ status: "idle" });

    const currentProvider = isAiProviderId(provider) ? aiProviders[provider] : aiProviders.custom;
    const subscriptionInfo = currentProvider.subscription;
    const subscriptionText = (text: string) =>
        text
            .replaceAll("{client}", subscriptionInfo?.clientName ?? currentProvider.label)
            .replaceAll("{login}", subscriptionInfo?.loginCommand ?? "");
    const isCustom = currentProvider.id === "custom" || currentProvider.id === "custom-anthropic";
    const resolvedBaseUrl = resolveAiBaseUrl(provider, baseUrl);

    const refreshSubscription = async () => {
        const revision = ++refreshRevision.current;
        const current = () =>
            revision === refreshRevision.current &&
            providerRef.current === provider &&
            window.ContextBridge.getSettingValue(getExtensionSettingKey(extensionId, "provider"), "") === provider;
        setSavingKey(true);
        setStorageError("");
        setTest({ status: "idle" });

        try {
            await refreshSubscriptionModels({
                load: () =>
                    window.ContextBridge.invokeExtension<unknown, SubscriptionStatus>(extensionId, {
                        command: "getSubscriptionStatus",
                    }),
                isCurrent: current,
                currentModel: () =>
                    window.ContextBridge.getSettingValue(getExtensionSettingKey(extensionId, "model"), ""),
                showStatus: setSubscription,
                saveModel: setModel,
            });
        } catch {
            if (current()) {
                setSubscription(null);
                setStorageError(subscriptionText(copy.subscriptionCheckFailed));
            }
        } finally {
            if (revision === refreshRevision.current) {
                setSavingKey(false);
            }
        }
    };

    useEffect(() => {
        ++refreshRevision.current;
        setSavingKey(false);
        setSubscription(null);
        setTest({ status: "idle" });
    }, [provider]);

    useEffect(
        () => () => {
            ++refreshRevision.current;
        },
        [],
    );

    useEffect(() => {
        setTest({ status: "idle" });
    }, [model, baseUrl, systemPrompt]);

    const onProviderChange = async (next: string) => {
        if (!isAiProviderId(next) || next === provider) {
            return;
        }

        setSavingKey(true);
        setStorageError("");
        ++refreshRevision.current;

        try {
            // Explicit provider changes keep the existing credential-disconnect behavior.
            await clearSessionKey();
            await setApiKey("");
            await setBaseUrl("");
            setKeyConfigured(false);
            setApiKeyDraft("");
            await setProvider(next);
            const preset = aiProviders[next];

            await setModel(preset.defaultModel);

            setTest({ status: "idle" });
        } catch {
            setStorageError(copy.providerChangeFailed);
        } finally {
            setSavingKey(false);
        }
    };

    const testConnection = async () => {
        const current = () =>
            providerRef.current === provider &&
            window.ContextBridge.getSettingValue(getExtensionSettingKey(extensionId, "provider"), "") === provider &&
            window.ContextBridge.getSettingValue(getExtensionSettingKey(extensionId, "model"), "") === model;
        setTest({ status: "loading" });

        try {
            const res = await window.ContextBridge.invokeExtension<
                Array<{ role: "user"; content: string }>,
                { query: string; answer: string }
            >(extensionId, [{ role: "user", content: "Reply with just: OK" }]);

            if (current()) {
                setTest(getAiConnectionResult(res.answer, copy));

                if (isSubscription && res.answer?.trim()) {
                    setSubscription((previous) =>
                        previous
                            ? { ...previous, authenticated: true, authenticationUnknown: false, error: undefined }
                            : previous,
                    );
                }
            }
        } catch (error) {
            if (current()) {
                setTest({
                    status: "error",
                    message: safeAiFailure(
                        error,
                        isSubscription ? copy.subscriptionRequestFailed : copy.connectionFailed,
                    ),
                });
            }
        }
    };

    return (
        <div className="ai-settings">
            <SettingGroupList>
                <SettingGroup title={copy.settingsTitle}>
                    <Setting
                        label={copy.provider}
                        description={`${copy.providerHint} ${copy.providerSwitchWarning}`}
                        control={
                            <Dropdown
                                value={
                                    isSubscription
                                        ? currentProvider.label
                                        : currentProvider.id === "custom"
                                          ? copy.customProvider
                                          : currentProvider.label
                                }
                                selectedOptions={[currentProvider.id]}
                                disabled={savingKey || test.status === "loading"}
                                onOptionSelect={(_, { optionValue }) => optionValue && onProviderChange(optionValue)}
                                style={{ minWidth: 240 }}
                            >
                                {Object.values(aiProviders).map((p) => (
                                    <Option
                                        key={p.id}
                                        value={p.id}
                                        text={
                                            isSubscriptionProvider(p.id)
                                                ? p.label
                                                : p.id === "custom"
                                                  ? copy.customProvider
                                                  : p.label
                                        }
                                    >
                                        {isSubscriptionProvider(p.id)
                                            ? p.label
                                            : p.id === "custom"
                                              ? copy.customProvider
                                              : p.label}
                                    </Option>
                                ))}
                            </Dropdown>
                        }
                    />

                    {isSubscription ? (
                        <Setting
                            label={currentProvider.label}
                            description={subscriptionText(copy.subscriptionHint)}
                            control={
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <Text role="status">
                                        {subscriptionText(
                                            !subscription
                                                ? copy.subscriptionUnchecked
                                                : !subscription.installed
                                                  ? copy.subscriptionMissingCli
                                                  : subscription.authenticationUnknown
                                                    ? copy.subscriptionUnchecked
                                                    : !subscription.authenticated
                                                      ? copy.subscriptionLogin
                                                      : copy.subscriptionSignedIn,
                                        )}
                                    </Text>
                                    <Text>{subscriptionText(copy.subscriptionSetup)}</Text>
                                    {subscriptionInfo?.helpUrl && (
                                        <Link
                                            onClick={() => window.ContextBridge.openExternal(subscriptionInfo.helpUrl)}
                                        >
                                            {copy.subscriptionDocs}
                                        </Link>
                                    )}
                                    <Button
                                        disabled={savingKey || test.status === "loading"}
                                        onClick={refreshSubscription}
                                    >
                                        {copy.subscriptionRefresh}
                                    </Button>
                                    {subscription?.error && <Text role="alert">{subscription.error}</Text>}
                                    {storageError && <Text role="alert">{storageError}</Text>}
                                </div>
                            }
                        />
                    ) : (
                        <Setting
                            label={copy.apiKey}
                            description={copy.keyPrivacy}
                            control={
                                <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
                                    <Input
                                        type="password"
                                        value={apiKey}
                                        disabled={savingKey}
                                        onChange={(_, { value }) => setApiKeyDraft(value)}
                                        placeholder={copy.newKey}
                                        autoComplete="off"
                                        style={{ width: "100%" }}
                                    />
                                    <Text size={200}>
                                        {keyConfigured
                                            ? sessionOnly
                                                ? copy.sessionKeyStatus
                                                : copy.savedKeyStatus
                                            : copy.noKey}
                                    </Text>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                        <Button
                                            disabled={savingKey || !apiKey.trim()}
                                            onClick={async () => {
                                                setSavingKey(true);
                                                setStorageError("");

                                                try {
                                                    await clearSessionKey();
                                                    await setApiKey(apiKey.trim());
                                                    await refreshKeyStatus();
                                                    setApiKeyDraft("");
                                                    setTest({ status: "idle" });
                                                } catch {
                                                    setStorageError(copy.keySaveFailed);
                                                } finally {
                                                    setSavingKey(false);
                                                }
                                            }}
                                        >
                                            {copy.saveKey}
                                        </Button>
                                        <Button
                                            disabled={savingKey || !apiKey.trim()}
                                            onClick={async () => {
                                                setSavingKey(true);
                                                setStorageError("");

                                                try {
                                                    await window.ContextBridge.invokeExtension(extensionId, {
                                                        command: "setSessionKey",
                                                        apiKey: apiKey.trim(),
                                                    });
                                                    await refreshKeyStatus();
                                                    setApiKeyDraft("");
                                                    setTest({ status: "idle" });
                                                } catch {
                                                    setStorageError(copy.sessionKeyFailed);
                                                } finally {
                                                    setSavingKey(false);
                                                }
                                            }}
                                        >
                                            {copy.useUntilQuit}
                                        </Button>
                                        <Button
                                            disabled={savingKey}
                                            onClick={async () => {
                                                setSavingKey(true);
                                                setStorageError("");

                                                try {
                                                    await clearSessionKey();
                                                    await setApiKey("");
                                                    setKeyConfigured(false);
                                                    setApiKeyDraft("");
                                                    setTest({ status: "idle" });
                                                } catch {
                                                    setStorageError(copy.keyRemoveFailed);
                                                } finally {
                                                    setSavingKey(false);
                                                }
                                            }}
                                        >
                                            {copy.removeKey}
                                        </Button>
                                    </div>
                                    {storageError && <Text role="alert">{storageError}</Text>}
                                    {currentProvider.apiKeyUrl && (
                                        <Link
                                            onClick={() => window.ContextBridge.openExternal(currentProvider.apiKeyUrl)}
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 4,
                                                fontSize: 12,
                                            }}
                                        >
                                            {copy.getKey} · {currentProvider.label} <OpenRegular fontSize={12} />
                                        </Link>
                                    )}
                                </div>
                            }
                        />
                    )}

                    {isCustom && (
                        <Setting
                            label={copy.apiBaseUrl}
                            description={
                                currentProvider.id === "custom-anthropic"
                                    ? copy.anthropicEndpointHint
                                    : copy.endpointHint
                            }
                            control={
                                <Input
                                    value={baseUrl}
                                    onChange={async (_, { value }) => {
                                        setStorageError("");

                                        try {
                                            await clearSessionKey();
                                            await setApiKey("");
                                            setKeyConfigured(false);
                                            setApiKeyDraft("");
                                            await setBaseUrl(value);
                                            setTest({ status: "idle" });
                                        } catch {
                                            setStorageError(copy.endpointChangeFailed);
                                        }
                                    }}
                                    placeholder="https://.../v1"
                                    style={{ width: "100%" }}
                                />
                            }
                        />
                    )}

                    <Setting
                        label={copy.model}
                        description={
                            isSubscription
                                ? subscriptionText(copy.subscriptionModels)
                                : isCustom
                                  ? copy.modelHint
                                  : `${resolvedBaseUrl} · ${copy.endpointModelHint}`
                        }
                        control={
                            isSubscription ? (
                                <Dropdown
                                    value={
                                        subscription?.models.find((item) => item.id === model)?.name ??
                                        copy.subscriptionChooseModel
                                    }
                                    selectedOptions={
                                        subscription?.models.some((item) => item.id === model) ? [model] : []
                                    }
                                    disabled={
                                        savingKey ||
                                        test.status === "loading" ||
                                        !subscription ||
                                        (!subscription.authenticationUnknown &&
                                            (!subscription.authenticated || !!subscription.error))
                                    }
                                    onOptionSelect={(_, { optionValue }) => optionValue && setModel(optionValue)}
                                >
                                    {(subscription?.models ?? []).map((item) => (
                                        <Option key={item.id} value={item.id} text={item.name}>
                                            {item.name}
                                        </Option>
                                    ))}
                                </Dropdown>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                                    <Input
                                        value={model}
                                        onChange={(_, { value }) => setModel(value)}
                                        placeholder={currentProvider.defaultModel || "model-id"}
                                        style={{ width: "100%" }}
                                    />
                                    {currentProvider.models.length > 0 && (
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                            {currentProvider.models.map((m) => (
                                                <Button
                                                    key={m}
                                                    size="small"
                                                    appearance={m === model ? "primary" : "subtle"}
                                                    onClick={() => setModel(m)}
                                                >
                                                    {m}
                                                </Button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        }
                    />

                    <Setting
                        label={copy.systemPrompt}
                        description={copy.systemHint}
                        control={
                            <Textarea
                                value={systemPrompt}
                                onChange={(_, { value }) => setSystemPrompt(value)}
                                resize="vertical"
                                rows={4}
                                style={{ width: "100%" }}
                            />
                        }
                    />

                    <Setting
                        label={copy.testConnection}
                        description={isSubscription ? subscriptionText(copy.subscriptionTestHint) : copy.testHint}
                        control={
                            <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                                <Button
                                    appearance="secondary"
                                    disabled={
                                        savingKey ||
                                        !model ||
                                        test.status === "loading" ||
                                        (isSubscription &&
                                            (!subscription || chooseSubscriptionModel(subscription, model) !== model))
                                    }
                                    onClick={testConnection}
                                >
                                    {copy.test}
                                </Button>
                                {test.status === "loading" && <Spinner size="tiny" label={copy.testing} />}
                                {test.status === "ok" && (
                                    <Badge
                                        appearance="tint"
                                        color="success"
                                        icon={<CheckmarkCircleRegular />}
                                        style={{ maxWidth: 320 }}
                                    >
                                        OK
                                    </Badge>
                                )}
                                {test.status === "error" && (
                                    <Text
                                        size={200}
                                        style={{ color: tokens.colorStatusDangerForeground1, maxWidth: 360 }}
                                    >
                                        <DismissCircleRegular fontSize={12} /> {test.message}
                                    </Text>
                                )}
                            </div>
                        }
                    />
                </SettingGroup>
            </SettingGroupList>
        </div>
    );
};
