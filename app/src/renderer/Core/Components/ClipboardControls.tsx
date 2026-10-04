import { useEffect, useState } from "react";
import { useSetting } from "../Hooks/useSetting";
import { useStudioCopy } from "../Theme/useStudioCopy";

type ClipboardStatus = { recording: boolean; count: number; capacity: number; encryptionAvailable: boolean };

export const ClipboardControls = ({ inline = false }: { inline?: boolean }) => {
    const copy = useStudioCopy();
    const { value: persistHistory, updateValue: setPersistHistory } = useSetting({
        key: "clipboard.persistHistory",
        defaultValue: false,
    });
    const [status, setStatus] = useState<ClipboardStatus>();
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const command = async (value: "status" | "enable" | "pause" | "clear" | "capacity", capacity?: number) => {
        setBusy(true);

        try {
            const result = await window.ContextBridge.invokeExtension<
                { command: string; capacity?: number },
                ClipboardStatus
            >("ClipboardHistory", { command: value, capacity });
            setStatus(result);
            setError("");
            setConfirmClear(false);
        } catch {
            setError(copy.clipboardUnavailable);
        } finally {
            setBusy(false);
        }
    };
    useEffect(() => {
        if (inline) {
            void command("status");
        }
    }, [inline]);

    const content = (
        <section
            className={inline ? "studio-clipboard-settings" : "studio-clipboard-panel"}
            aria-label={copy.clipboardHistory}
            style={inline ? { maxWidth: 720, fontSize: 14 } : undefined}
        >
            <strong>{copy.clipboardHistory}</strong>
            <p className="studio-hint">{copy.clipboardHint}</p>
            <p>
                <strong>{persistHistory ? copy.retentionPersistent : copy.retentionSession}</strong>
            </p>
            <p className="studio-hint">{persistHistory ? copy.retentionPersistentHint : copy.retentionSessionHint}</p>
            {status && (
                <p role="status">
                    {status.recording ? copy.recording : copy.paused} · {copy.savedItems}: {status.count}
                </p>
            )}
            <label>
                History capacity
                <select
                    aria-label="Clipboard history capacity"
                    disabled={busy || !status}
                    value={status?.capacity ?? 300}
                    onChange={(event) => void command("capacity", Number(event.target.value))}
                >
                    <option value={300}>300 entries</option>
                    <option value={1000}>1,000 entries</option>
                    <option value={5000}>5,000 entries</option>
                </select>
            </label>
            <p className="studio-hint">
                No age expiry. Up to 20 MiB of text; older entries roll off when you copy at capacity. Lowering capacity
                takes effect on your next copy.
            </p>
            <label>
                <input
                    type="checkbox"
                    checked={persistHistory}
                    disabled={busy || !status || (!persistHistory && !status.encryptionAvailable)}
                    onChange={(event) => {
                        void setPersistHistory(event.target.checked).catch(() => setError(copy.clipboardUnavailable));
                    }}
                />{" "}
                Keep new copies after restart, encrypted on this device
            </label>
            {status && !status.encryptionAvailable && (
                <p role="status">Secure storage is unavailable. Clipboard history stays in memory for this session.</p>
            )}
            <div className="studio-clipboard-actions">
                <button
                    type="button"
                    className="studio-button"
                    disabled={busy || !status}
                    onClick={() => void command(status?.recording ? "pause" : "enable")}
                >
                    {status?.recording ? copy.pause : copy.enable}
                </button>
                <button
                    type="button"
                    className="studio-button"
                    disabled={busy || !status}
                    onClick={() => setConfirmClear(true)}
                >
                    {copy.clear}
                </button>
            </div>
            {confirmClear && (
                <div>
                    <p>{copy.clearQuestion}</p>
                    <button
                        type="button"
                        className="studio-button"
                        disabled={busy}
                        onClick={() => void command("clear")}
                    >
                        {copy.clearAll}
                    </button>
                    <button type="button" className="studio-button" onClick={() => setConfirmClear(false)}>
                        {copy.keep}
                    </button>
                </div>
            )}
            {error && <p role="alert">{error}</p>}
        </section>
    );

    return inline ? (
        content
    ) : (
        <details
            className="studio-clipboard non-draggable-area"
            onToggle={(event) => {
                if (event.currentTarget.open) {
                    void command("status");
                }
            }}
        >
            <summary>{copy.clipboard}</summary>
            {content}
        </details>
    );
};
