import { useSetting } from "@Core/Hooks/useSetting";
import { useStudioCopy } from "@Core/Theme/useStudioCopy";
import { Switch } from "@fluentui/react-components";
import { useState } from "react";

export const OfflineControl = () => {
    const copy = useStudioCopy();
    const { value } = useSetting({ key: "privacy.offline", defaultValue: false });
    const [error, setError] = useState(false);
    const [busy, setBusy] = useState(false);
    const change = async (enabled: boolean) => {
        setBusy(true);

        try {
            await window.ContextBridge.updateSettingValue("privacy.offline", enabled);
            setError(false);
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    };
    return (
        <section>
            <Switch
                label={copy.offline}
                checked={value}
                disabled={busy}
                onChange={(_, data) => void change(data.checked)}
                aria-describedby="studio-offline-description"
            />
            <p className="studio-hint" id="studio-offline-description">
                {copy.offlineHint}
            </p>
            {error && <p role="alert">{copy.offlineError}</p>}
        </section>
    );
};
