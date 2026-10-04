import { useSetting } from "@Core/Hooks";
import { Setting } from "@Core/Settings/Setting";
import { Switch } from "@fluentui/react-components";
import { useState } from "react";

export const MeowmateAutostart = () => {
    const { value: language } = useSetting({ key: "general.language", defaultValue: "en-US" });
    const { value, updateValue } = useSetting({ key: "general.meowmateAutoStart", defaultValue: true });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const czech = language === "cs-CZ";
    const label = czech ? "Spouštět Meowmate s Meowcastem" : "Start Meowmate with Meowcast";
    const change = async (checked: boolean) => {
        setBusy(true);
        setError(false);

        try {
            await updateValue(checked);
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div>
            <Setting
                label={label}
                description={
                    czech
                        ? "Při příštím spuštění zobrazí dock kočky. Aktuálně běžící Meowmate zůstane otevřený."
                        : "Show the cat dock on your next launch. Meowmate stays open if it is already running."
                }
                control={
                    <Switch
                        aria-label={label}
                        checked={value}
                        disabled={busy}
                        onChange={(_, { checked }) => void change(checked)}
                    />
                }
            />
            {error && (
                <p role="alert">
                    {czech
                        ? "Nastavení se nepodařilo uložit. Zkuste to znovu."
                        : "Could not save this setting. Try again."}
                </p>
            )}
        </div>
    );
};
