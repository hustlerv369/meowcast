import { WeatherMoon20Regular, WeatherSunny20Regular } from "@fluentui/react-icons";
import { useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetting } from "../Hooks/useSetting";
import { ThemeContext } from "../Theme/ThemeContext";

export const ThemeToggle = () => {
    const { shouldUseDarkColors } = useContext(ThemeContext);
    const { updateValue } = useSetting({ key: "appearance.themeSource", defaultValue: "light" });
    const { i18n } = useTranslation();
    const czech = i18n.language.startsWith("cs");
    const pendingRef = useRef(false);
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    const label = czech ? "Tmavý režim" : "Dark mode";
    const title = shouldUseDarkColors
        ? czech
            ? "Přepnout na světlý režim"
            : "Switch to light mode"
        : czech
          ? "Přepnout na tmavý režim"
          : "Switch to dark mode";

    return (
        <div
            className="non-draggable-area"
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}
        >
            <button
                type="button"
                className="studio-text-button non-draggable-area"
                style={{ minWidth: 44, minHeight: 44 }}
                aria-label={label}
                aria-pressed={shouldUseDarkColors}
                title={
                    failed
                        ? czech
                            ? "Režim se nepodařilo uložit. Zkuste to znovu."
                            : "Could not save appearance. Try again."
                        : title
                }
                disabled={pending}
                onClick={async () => {
                    if (pendingRef.current) {
                        return;
                    }

                    pendingRef.current = true;
                    setPending(true);
                    setFailed(false);

                    try {
                        await updateValue(shouldUseDarkColors ? "light" : "dark");
                    } catch {
                        setFailed(true);
                    } finally {
                        pendingRef.current = false;
                        setPending(false);
                    }
                }}
            >
                {shouldUseDarkColors ? (
                    <WeatherMoon20Regular aria-hidden="true" />
                ) : (
                    <WeatherSunny20Regular aria-hidden="true" />
                )}
                {failed ? (
                    <span role="alert">{czech ? "Zkusit znovu" : "Try again"}</span>
                ) : shouldUseDarkColors ? (
                    czech ? (
                        "Tmavý"
                    ) : (
                        "Dark"
                    )
                ) : czech ? (
                    "Světlý"
                ) : (
                    "Light"
                )}
            </button>
        </div>
    );
};
