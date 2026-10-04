import { useContext, useState } from "react";
import { useSetting } from "../Hooks/useSetting";
import { ThemeContext } from "./ThemeContext";
import { CustomThemeEditor } from "./newCustomThemeEditor";
import { studioThemes } from "./studioThemes";
import { useStudioCopy } from "./useStudioCopy";

export const StudioAppearance = () => {
    const copy = useStudioCopy();
    const { shouldUseDarkColors } = useContext(ThemeContext);
    const { value: theme, updateValue: setTheme } = useSetting({ key: "studio.theme", defaultValue: "Graphite" });
    const { value: mode, updateValue: setMode } = useSetting({ key: "appearance.themeSource", defaultValue: "light" });
    const { value: transparent, updateValue: setTransparent } = useSetting({
        key: "studio.transparency",
        defaultValue: true,
    });
    const [error, setError] = useState("");
    const save = async (change: Promise<void>) => {
        try {
            await change;
            setError("");
        } catch {
            setError(copy.saveError);
        }
    };

    return (
        <section className="studio-appearance" aria-label={copy.appearance}>
            <div className="studio-preview" aria-label={copy.preview}>
                <div className="studio-preview-input">
                    ⌕ <span>{copy.search}</span>
                    <kbd>Esc</kbd>
                </div>
                <div className="studio-preview-caption">{copy.everyday}</div>
                <div className="studio-preview-row" data-selected="true">
                    <span>▧</span>
                    <strong>{copy.clipboardHistory}</strong>
                    <small>{copy.utility}</small>
                    <kbd>↵</kbd>
                </div>
                <div className="studio-preview-row">
                    <span>↗</span>
                    <strong>{copy.openApp}</strong>
                    <small>{copy.applications}</small>
                </div>
            </div>
            <fieldset className="studio-fieldset">
                <legend>
                    {copy.accent} <span>{copy.allIncluded}</span>
                </legend>
                <div className="studio-theme-grid">
                    {studioThemes.map((item) => (
                        <button
                            key={item.name}
                            type="button"
                            aria-pressed={theme === item.name}
                            onClick={() => void save(setTheme(item.name))}
                        >
                            <span
                                className="studio-swatch"
                                style={{ background: shouldUseDarkColors ? item.dark : item.light }}
                                aria-hidden="true"
                            />
                            {item.name}
                            <span className="studio-theme-check" aria-hidden="true">
                                {theme === item.name ? "✓" : ""}
                            </span>
                        </button>
                    ))}
                </div>
            </fieldset>
            <div className="studio-appearance-options">
                <div className="studio-mode-choice">
                    <span>{copy.appearance}</span>
                    <div className="studio-mode-segments" role="group" aria-label={copy.appearance}>
                        {[
                            ["light", copy.light],
                            ["dark", copy.dark],
                            ["system", copy.system],
                        ].map(([value, label]) => (
                            <button
                                type="button"
                                key={value}
                                aria-pressed={mode === value}
                                onClick={() => void save(setMode(value))}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                <label className="studio-checkbox">
                    <input
                        type="checkbox"
                        checked={transparent}
                        onChange={(event) => void save(setTransparent(event.target.checked))}
                    />
                    {copy.translucent}
                </label>
            </div>
            <p className="studio-hint">{copy.glassHint}</p>
            <CustomThemeEditor />
            {error && <p role="alert">{error}</p>}
        </section>
    );
};
