import { BaseLayout } from "@Core/BaseLayout";
import type { ExtensionProps } from "@Core/ExtensionProps";
import { Header } from "@Core/Header";
import { useExtensionSetting, useSetting } from "@Core/Hooks";
import { getExtensionSettingKey } from "@common/Core/Extension";
import { aiProviders, isAiProviderId, resolveAiBaseUrl } from "@common/Extensions/Ai/AiProviders";
import {
    buildActionPrompt,
    buildStructuredPrompt,
    builtInPromptActions,
    parsePromptActions,
    type PromptAction,
    type PromptFields,
} from "@common/Extensions/Ai/PromptActions";
import { Button, Input, Spinner, Textarea } from "@fluentui/react-components";
import { ArrowLeftRegular, CopyRegular, SendRegular, StopRegular } from "@fluentui/react-icons";
import type { IpcRendererEvent } from "electron";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import "./AiComposer.css";
import { safeAiFailure } from "./AiConnectionResult";
import { getAiCopy } from "./AiCopy";
import { hasAiDestination, isSubscriptionProvider } from "./AiSubscription";

type SelectionContext = { text: string; token: string; editable: boolean };
type StreamResult = { query: string; answer: string };
const actionKey = getExtensionSettingKey("Ai", "promptActions");
const emptyFields: PromptFields = { goal: "", context: "", constraints: "", output: "" };

export const AiExtension = ({ contextBridge, goBack }: ExtensionProps) => {
    const { value: language } = useSetting<string>({ key: "general.language", defaultValue: "en-US" });
    const copy = getAiCopy(language);
    const supportsNativeSelection = contextBridge.getOperatingSystem() === "Windows";
    const [selectionError, setSelectionError] = useState(false);
    const { search } = useLocation();
    const initialQuery = new URLSearchParams(search).get("q") ?? "";
    const [selection, setSelection] = useState<SelectionContext | null>(null);
    const [resultSelection, setResultSelection] = useState<SelectionContext | null>(null);
    const [selectionShortcut, setSelectionShortcut] = useState<{ shortcut: string; available: boolean } | null>(null);
    const [capturing, setCapturing] = useState(false);
    const [inserting, setInserting] = useState(false);
    const [source, setSource] = useState("");
    const [instruction, setInstruction] = useState(initialQuery);
    const [actionId, setActionId] = useState("free");
    const [customActions, setCustomActions] = useState<PromptAction[]>(() =>
        parsePromptActions(contextBridge.getSettingValue(actionKey, [])),
    );
    const [actionName, setActionName] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
    const [masterOpen, setMasterOpen] = useState(false);
    const [fields, setFields] = useState<PromptFields>(emptyFields);
    const [original, setOriginal] = useState<string | null>(null);
    const [promptPreview, setPromptPreview] = useState<string | null>(null);
    const [answer, setAnswer] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [status, setStatus] = useState("");
    const requestRef = useRef<string | null>(null);
    const stoppedRef = useRef(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const { value: model } = useExtensionSetting<string>({ extensionId: "Ai", key: "model" });
    const { value: provider } = useExtensionSetting<string>({ extensionId: "Ai", key: "provider" });
    const isSubscription = isSubscriptionProvider(provider);
    const subscriptionClient = isAiProviderId(provider) ? aiProviders[provider].subscription?.clientName : undefined;
    const { value: baseUrl } = useExtensionSetting<string>({ extensionId: "Ai", key: "baseUrl" });
    const { value: systemPrompt } = useExtensionSetting<string>({ extensionId: "Ai", key: "systemPrompt" });
    const providerLabel =
        isAiProviderId(provider) && provider !== "custom" ? aiProviders[provider].label : copy.customProvider;
    const endpoint = resolveAiBaseUrl(provider, baseUrl);
    const endpointLabel = (() => {
        try {
            return new URL(endpoint).host;
        } catch {
            return copy.endpointMissing;
        }
    })();
    const localizedBuiltIns = builtInPromptActions
        .filter((action) => action.id !== "translate")
        .map((action) => ({
            ...action,
            name: copy[action.id as "translate" | "correct" | "summarize" | "explain" | "reply"],
        }));
    const actions = [...localizedBuiltIns, ...customActions];
    const outgoingPrompt = buildActionPrompt(instruction, source);
    const needsSource = builtInPromptActions.some((action) => action.id === actionId);
    const canSend =
        !!instruction.trim() &&
        (!needsSource || !!source.trim()) &&
        !!model &&
        hasAiDestination(provider, endpoint) &&
        !capturing &&
        !inserting;

    useEffect(() => {
        inputRef.current?.focus();
        const refreshSelectionStatus = () => {
            void contextBridge
                .invokeExtension<unknown, { shortcut: string; available: boolean; error?: string }>("Ai", {
                    command: "getSelectionStatus",
                })
                .then((value) => {
                    setSelectionShortcut(value);
                    setSelectionError(!!value.error);
                })
                .catch(() => {});
        };
        refreshSelectionStatus();
        const onSelectionError = () => {
            setSelectionError(true);
            setSelection(null);
            setResultSelection(null);
        };
        const listener = (_: IpcRendererEvent, event: { requestId: string; delta: string }) => {
            if (event.requestId === requestRef.current && !stoppedRef.current && typeof event.delta === "string") {
                setAnswer((value) => value + event.delta);
            }
        };
        const readSelection = () => {
            refreshSelectionStatus();
            void contextBridge
                .invokeExtension<unknown, SelectionContext | null>("Ai", { command: "getSelection" })
                .then((result) => {
                    if (result && !requestRef.current) {
                        setStatus("");
                        setError("");
                        setAnswer("");
                        setResultSelection(null);
                        setSelection(result);
                        setSource(result.text);
                    }
                })
                .catch(() => {});
        };
        readSelection();
        contextBridge.ipcRenderer.on("aiSelectionReady", readSelection);
        contextBridge.ipcRenderer.on("aiSelectionError", onSelectionError);
        contextBridge.ipcRenderer.on("aiStream", listener);
        return () => {
            contextBridge.ipcRenderer.off("aiStream", listener);
            contextBridge.ipcRenderer.off("aiSelectionReady", readSelection);
            contextBridge.ipcRenderer.off("aiSelectionError", onSelectionError);

            if (requestRef.current) {
                void contextBridge
                    .invokeExtension("Ai", { command: "cancel", requestId: requestRef.current })
                    .catch(() => {});
            }
        };
    }, [contextBridge]);

    const stop = async () => {
        if (!requestRef.current) {
            return;
        }

        stoppedRef.current = true;
        setStatus(copy.stopped);

        try {
            await contextBridge.invokeExtension("Ai", { command: "cancel", requestId: requestRef.current });
        } catch {
            setError(copy.stopFailed);
        }
    };

    const send = async () => {
        if (requestRef.current || !canSend) {
            return;
        }

        const requestId = crypto.randomUUID();
        requestRef.current = requestId;
        stoppedRef.current = false;
        setLoading(true);
        setResultSelection(selection);
        setAnswer("");
        setError("");
        setStatus("");

        try {
            const result = await contextBridge.invokeExtension<unknown, StreamResult>("Ai", {
                command: "stream",
                requestId,
                messages: [{ role: "user", content: outgoingPrompt }],
            });

            if (requestRef.current === requestId && !stoppedRef.current) {
                setAnswer(result.answer);
                setStatus(copy.complete);
            }
        } catch (error) {
            if (!stoppedRef.current) {
                setError(safeAiFailure(error, isSubscription ? copy.subscriptionRequestFailed : copy.requestFailed));
            }
        } finally {
            if (requestRef.current === requestId) {
                requestRef.current = null;
                setLoading(false);
            }
        }
    };

    const captureSelection = async () => {
        if (!supportsNativeSelection) {
            return;
        }

        setCapturing(true);
        setSelectionError(false);
        setError("");
        setStatus(copy.captureWait);

        try {
            const result = await contextBridge.invokeExtension<unknown, SelectionContext>("Ai", {
                command: "captureSelection",
            });
            setSelection(result);
            setResultSelection(null);
            setAnswer("");
            setSource(result.text);
            setStatus(result.editable ? copy.selectionReady : copy.selectionReadonly);
        } catch {
            setError(copy.captureFailed);
        } finally {
            setCapturing(false);
        }
    };

    const insertResult = async () => {
        if (!resultSelection?.editable || !answer || loading || inserting) {
            return;
        }

        setInserting(true);
        setError("");

        try {
            await contextBridge.invokeExtension("Ai", {
                command: "insertSelection",
                token: resultSelection.token,
                text: answer,
            });
            setSelection(null);
            setResultSelection(null);
            setStatus(copy.pasteSent);
        } catch {
            setError(copy.pasteFailed);
        } finally {
            setInserting(false);
        }
    };

    const selectAction = (id: string) => {
        const action = actions.find((item) => item.id === id);
        setActionId(id);
        setInstruction(action?.instruction ?? "");
        setActionName(action?.name ?? "");
        setOriginal(null);
        setPromptPreview(null);
    };

    const saveAction = async () => {
        if (!actionName.trim() || !instruction.trim()) {
            return;
        }

        const id = actionId.startsWith("custom-") ? actionId : `custom-${crypto.randomUUID()}`;
        const saved = { id, name: actionName.trim().slice(0, 80), instruction: instruction.slice(0, 12000) };
        const updated = [...customActions.filter((item) => item.id !== id), saved];

        try {
            await contextBridge.updateSettingValue(actionKey, updated);
            setCustomActions(updated);
            setActionId(id);
            setEditorOpen(false);
            setStatus(copy.actionSaved);
        } catch {
            setError(copy.saveActionFailed);
        }
    };

    const deleteAction = async () => {
        const updated = customActions.filter((item) => item.id !== actionId);

        try {
            await contextBridge.updateSettingValue(actionKey, updated);
            setCustomActions(updated);
            selectAction("free");
            setStatus(copy.actionRemoved);
        } catch {
            setError(copy.removeActionFailed);
        }
    };

    return (
        <BaseLayout
            header={
                <Header
                    draggable
                    contentBefore={
                        <Button
                            className="non-draggable-area"
                            appearance="subtle"
                            aria-label={copy.back}
                            icon={<ArrowLeftRegular />}
                            onClick={goBack}
                        />
                    }
                >
                    <div className="ai-heading">
                        <strong>{copy.title}</strong>
                        <span>{copy.subtitle}</span>
                    </div>
                </Header>
            }
            content={
                <div className="ai-studio">
                    <div className="ai-action-strip" aria-label={copy.actions}>
                        {actions.map((action) => (
                            <button
                                key={action.id}
                                type="button"
                                disabled={loading}
                                aria-pressed={actionId === action.id}
                                onClick={() => selectAction(action.id)}
                            >
                                {action.name}
                            </button>
                        ))}
                        <button
                            type="button"
                            disabled={loading}
                            aria-pressed={actionId === "free"}
                            onClick={() => selectAction("free")}
                        >
                            {copy.freePrompt}
                        </button>
                    </div>
                    <div className="ai-columns">
                        <section className="ai-input-pane" aria-label={copy.prompt}>
                            <div className="ai-section-title">
                                <h2>{copy.prompt}</h2>
                                <button
                                    className="ai-text-button"
                                    disabled={loading}
                                    onClick={() => setEditorOpen(!editorOpen)}
                                >
                                    {copy.editAction}
                                </button>
                            </div>
                            {supportsNativeSelection ? (
                                <div className="ai-capture">
                                    <Button disabled={loading || capturing} onClick={captureSelection}>
                                        {capturing ? copy.capturing : copy.capture}
                                    </Button>
                                    <span>
                                        {selectionShortcut?.available
                                            ? `${selectionShortcut.shortcut.replaceAll("Control", "Ctrl")}`
                                            : copy.shortcutUnavailable}
                                    </span>
                                </div>
                            ) : (
                                <p className="ai-status">{copy.manualSelection}</p>
                            )}
                            {supportsNativeSelection && selectionError && (
                                <p className="ai-error" role="alert">
                                    {copy.captureFailed}
                                </p>
                            )}
                            <label className="ai-field">
                                <span>
                                    {copy.source}
                                    <small>{copy.sourceHint}</small>
                                </span>
                                <Textarea
                                    ref={inputRef}
                                    value={source}
                                    disabled={loading}
                                    onChange={(_, data) => {
                                        setSource(data.value);
                                    }}
                                    rows={2}
                                    resize="vertical"
                                    placeholder={copy.sourcePlaceholder}
                                />
                            </label>
                            <label className="ai-field">
                                <span>
                                    {copy.instruction}
                                    <small>{copy.instructionHint}</small>
                                </span>
                                <Textarea
                                    value={instruction}
                                    disabled={loading}
                                    onChange={(_, data) => setInstruction(data.value)}
                                    rows={2}
                                    resize="vertical"
                                    placeholder={copy.instructionPlaceholder}
                                />
                            </label>
                            {editorOpen && (
                                <div className="ai-editor">
                                    <label className="ai-field">
                                        <span>{copy.actionName}</span>
                                        <Input
                                            value={actionName}
                                            maxLength={80}
                                            onChange={(_, data) => setActionName(data.value)}
                                        />
                                    </label>
                                    <p>{copy.savedContent}</p>
                                    <div className="ai-button-row">
                                        <Button
                                            disabled={
                                                loading ||
                                                !actionName.trim() ||
                                                !instruction.trim() ||
                                                instruction.length > 12000 ||
                                                (customActions.length >= 50 && !actionId.startsWith("custom-"))
                                            }
                                            onClick={saveAction}
                                        >
                                            {copy.saveAction}
                                        </Button>
                                        {actionId.startsWith("custom-") && (
                                            <Button disabled={loading} onClick={deleteAction}>
                                                {copy.removeAction}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}
                            <button
                                className="ai-text-button ai-master-toggle"
                                disabled={loading}
                                aria-expanded={masterOpen}
                                onClick={() => setMasterOpen(!masterOpen)}
                            >
                                {copy.improve}
                                <span>{copy.offline}</span>
                            </button>
                            {masterOpen && (
                                <div className="ai-master">
                                    <p>{copy.masterHint}</p>
                                    {(
                                        [
                                            ["goal", copy.goal],
                                            ["context", copy.context],
                                            ["constraints", copy.constraints],
                                            ["output", copy.output],
                                        ] as const
                                    ).map(([key, label]) => (
                                        <label key={key} className="ai-field">
                                            <span>{label}</span>
                                            <Input
                                                disabled={loading}
                                                value={fields[key]}
                                                onChange={(_, data) =>
                                                    setFields((value) => ({ ...value, [key]: data.value }))
                                                }
                                            />
                                        </label>
                                    ))}
                                    <Button
                                        disabled={loading}
                                        onClick={() =>
                                            setPromptPreview(
                                                buildStructuredPrompt(original ?? instruction, fields, copy),
                                            )
                                        }
                                    >
                                        {copy.preview}
                                    </Button>
                                    {promptPreview !== null && (
                                        <>
                                            <pre className="ai-prompt-preview">{promptPreview}</pre>
                                            <Button
                                                disabled={loading}
                                                onClick={() => {
                                                    setOriginal(original ?? instruction);
                                                    setInstruction(promptPreview);
                                                    setPromptPreview(null);
                                                }}
                                            >
                                                {copy.usePrompt}
                                            </Button>
                                        </>
                                    )}
                                    {original !== null && (
                                        <Button
                                            disabled={loading}
                                            onClick={() => {
                                                setInstruction(original);
                                                setOriginal(null);
                                                setPromptPreview(null);
                                            }}
                                        >
                                            {copy.revert}
                                        </Button>
                                    )}
                                </div>
                            )}
                            <details className="ai-disclosure">
                                <summary>{copy.disclosure}</summary>
                                <p>{copy.systemDisclosure}</p>
                                <pre>{systemPrompt || copy.none}</pre>
                                <p>{copy.sourceDisclosure}</p>
                                <pre>{outgoingPrompt}</pre>
                                <p>{copy.attachmentsDisclosure}</p>
                            </details>
                        </section>
                        <section className="ai-result-pane" aria-label={copy.result}>
                            <div className="ai-section-title">
                                <h2>{copy.result}</h2>
                                {loading && <Spinner size="tiny" label={copy.generating} />}
                            </div>
                            {answer ? (
                                <div className="ai-result" tabIndex={0}>
                                    {answer}
                                </div>
                            ) : (
                                <div className="ai-empty">
                                    <span>{copy.emptyTitle}</span>
                                    <p>{copy.emptyHint}</p>
                                </div>
                            )}
                            {error && (
                                <p className="ai-error" role="alert">
                                    {error}
                                </p>
                            )}
                            {status && (
                                <p className="ai-status" role="status">
                                    {status}
                                </p>
                            )}
                            {answer && (
                                <div className="ai-button-row">
                                    <Button
                                        icon={<CopyRegular />}
                                        onClick={() => {
                                            contextBridge.copyTextToClipboard(answer);
                                            setStatus(copy.copied);
                                        }}
                                    >
                                        {copy.copy}
                                    </Button>
                                    {supportsNativeSelection && resultSelection?.editable && (
                                        <Button disabled={loading || inserting} onClick={insertResult}>
                                            {inserting ? copy.checkingTarget : copy.insert}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </section>
                    </div>
                </div>
            }
            footer={
                <div className="ai-footer">
                    <details className="ai-provider">
                        <summary>{copy.aiConnection}</summary>
                        <strong>
                            {copy.configuredProvider}: {providerLabel}
                            {model ? ` · ${model}` : copy.chooseModel}
                        </strong>
                        <span>
                            {isSubscription
                                ? copy.subscriptionRoute.replaceAll("{client}", subscriptionClient ?? providerLabel)
                                : endpointLabel}{" "}
                            · {isSubscription ? copy.subscriptionPrivacy : copy.privacyFooter}
                        </span>
                        <span>{copy.connectionUnverified}</span>
                    </details>
                    {loading ? (
                        <Button appearance="secondary" icon={<StopRegular />} onClick={stop}>
                            {copy.stop}
                        </Button>
                    ) : (
                        <Button appearance="primary" icon={<SendRegular />} disabled={!canSend} onClick={send}>
                            {copy.send}
                        </Button>
                    )}
                </div>
            }
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();

                    if (loading) {
                        void stop();
                    } else {
                        goBack();
                    }
                }

                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    void send();
                }
            }}
        />
    );
};
