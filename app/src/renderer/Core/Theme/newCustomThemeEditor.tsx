import { useState } from "react";
import { useSetting } from "../Hooks/useSetting";
import { isReadablePalette, paletteKeys, readCustomThemes, type CustomTheme } from "./customThemes";
import "./newCustomThemeEditor.css";
import { getStudioPalette } from "./studioThemes";

const words = {
    en: {
        title: "Custom themes",
        name: "Theme name",
        light: "Light",
        dark: "Dark",
        new: "New theme",
        save: "Save and apply",
        apply: "Apply",
        duplicate: "Duplicate",
        remove: "Delete",
        reset: "Use Graphite",
        limit: "You can save up to 20 custom themes.",
        failed: "Could not save the change. Try again.",
        invalid:
            "Use a name of 1–40 characters and six-digit hex colors. Text and accent need 4.5:1 contrast; controls need 1.35:1 against their background.",
        hint: "Saved on this device. Custom themes use solid backgrounds to preserve contrast. Both light and dark palettes must pass validation.",
        preview: "Theme preview",
        sample: "Sample text",
        secondary: "Secondary text",
        button: "Action",
        copy: "Copy",
        colors: {
            bg: "Background",
            surface: "Surface",
            control: "Control",
            text: "Text",
            muted: "Secondary text",
            accent: "Accent",
            border: "Border",
            selection: "Selection",
        },
    },
    cs: {
        title: "Vlastní motivy",
        name: "Název motivu",
        light: "Světlý",
        dark: "Tmavý",
        new: "Nový motiv",
        save: "Uložit a použít",
        apply: "Použít",
        duplicate: "Duplikovat",
        remove: "Smazat",
        reset: "Použít Graphite",
        limit: "Můžete uložit nejvýše 20 vlastních motivů.",
        failed: "Změnu se nepodařilo uložit. Zkuste to znovu.",
        invalid:
            "Zadejte název o 1–40 znacích a šestimístné hex barvy. Text a akcent potřebují kontrast 4,5:1; ovládací prvky 1,35:1 vůči pozadí.",
        hint: "Ukládá se do tohoto zařízení. Vlastní motivy používají plné pozadí kvůli kontrastu. Světlá i tmavá paleta musí projít kontrolou.",
        preview: "Náhled motivu",
        sample: "Ukázkový text",
        secondary: "Doplňující text",
        button: "Akce",
        copy: "Kopie",
        colors: {
            bg: "Pozadí",
            surface: "Plocha",
            control: "Ovládací prvek",
            text: "Text",
            muted: "Doplňující text",
            accent: "Akcent",
            border: "Okraj",
            selection: "Výběr",
        },
    },
};

const blankTheme = (): CustomTheme => ({
    id: "",
    name: "",
    light: getStudioPalette("Graphite", false),
    dark: getStudioPalette("Graphite", true),
});

export const CustomThemeEditor = () => {
    const { value: language } = useSetting({ key: "general.language", defaultValue: "en-US" });
    const copy = language === "cs-CZ" ? words.cs : words.en;
    const { value: stored, updateValue: setStored } = useSetting<unknown>({
        key: "studio.customThemes",
        defaultValue: [],
    });
    const { value: active, updateValue: setActive } = useSetting({ key: "studio.theme", defaultValue: "Graphite" });
    const themes = readCustomThemes(stored);
    const [draft, setDraft] = useState<CustomTheme>(blankTheme);
    const [mode, setMode] = useState<"light" | "dark">("light");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const palette = draft[mode];
    const valid =
        !!draft.name.trim() &&
        draft.name.trim().length <= 40 &&
        isReadablePalette(draft.light) &&
        isReadablePalette(draft.dark);
    const run = async (task: () => Promise<void>) => {
        setBusy(true);
        setError("");

        try {
            await task();
        } catch {
            setError(copy.failed);
        } finally {
            setBusy(false);
        }
    };
    const save = () => {
        if (!valid) {
            setError(copy.invalid);
            return;
        }

        const exists = themes.some((item) => item.id === draft.id);

        if (!exists && themes.length >= 20) {
            setError(copy.limit);
            return;
        }

        void run(async () => {
            const item = { ...draft, id: exists ? draft.id : `custom:${crypto.randomUUID()}`, name: draft.name.trim() };
            await setStored(exists ? themes.map((theme) => (theme.id === item.id ? item : theme)) : [...themes, item]);
            setDraft(item);
            await setActive(item.id);
        });
    };

    return (
        <details className="studio-custom-themes">
            <summary>{copy.title}</summary>
            <p>{copy.hint}</p>
            <div className="studio-custom-list">
                {themes.map((item) => (
                    <div key={item.id}>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                setDraft(item);
                                setError("");
                            }}
                        >
                            {item.name}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            aria-pressed={active === item.id}
                            onClick={() => void run(() => setActive(item.id))}
                        >
                            {copy.apply}
                        </button>
                        <button
                            type="button"
                            disabled={busy || themes.length >= 20}
                            onClick={() => {
                                setDraft({ ...item, id: "", name: `${item.name.slice(0, 30)} ${copy.copy}` });
                                setError("");
                            }}
                        >
                            {copy.duplicate}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                                void run(async () => {
                                    if (active === item.id) {
                                        await setActive("Graphite");
                                    }

                                    await setStored(themes.filter((theme) => theme.id !== item.id));

                                    if (draft.id === item.id) {
                                        setDraft(blankTheme());
                                    }
                                })
                            }
                        >
                            {copy.remove}
                        </button>
                    </div>
                ))}
            </div>
            <div className="studio-custom-actions">
                <button
                    type="button"
                    disabled={busy || themes.length >= 20}
                    onClick={() => {
                        setDraft(blankTheme());
                        setError("");
                    }}
                >
                    {copy.new}
                </button>
                <button type="button" disabled={busy} onClick={() => void run(() => setActive("Graphite"))}>
                    {copy.reset}
                </button>
            </div>
            <label>
                {copy.name}
                <input
                    value={draft.name}
                    maxLength={40}
                    disabled={busy}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
            </label>
            <div className="studio-custom-actions" role="group" aria-label={copy.title}>
                {(["light", "dark"] as const).map((value) => (
                    <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>
                        {copy[value]}
                    </button>
                ))}
            </div>
            <div className="studio-custom-colors">
                {paletteKeys.map((key) => (
                    <label key={key}>
                        {copy.colors[key]}
                        <input
                            disabled={busy}
                            value={palette[key]}
                            maxLength={7}
                            spellCheck={false}
                            onChange={(event) =>
                                setDraft({ ...draft, [mode]: { ...palette, [key]: event.target.value } })
                            }
                        />
                        <input
                            type="color"
                            aria-label={copy.colors[key]}
                            disabled={busy}
                            value={/^#[\da-f]{6}$/i.test(palette[key]) ? palette[key] : "#000000"}
                            onChange={(event) =>
                                setDraft({ ...draft, [mode]: { ...palette, [key]: event.target.value } })
                            }
                        />
                    </label>
                ))}
            </div>
            {isReadablePalette(palette) && (
                <div
                    className="studio-custom-preview"
                    aria-label={copy.preview}
                    style={{ background: palette.bg, color: palette.text, borderColor: palette.border }}
                >
                    <strong>{copy.sample}</strong>
                    <span style={{ color: palette.muted }}>{copy.secondary}</span>
                    <span style={{ background: palette.control, color: palette.text }}>{copy.button}</span>
                </div>
            )}
            <button type="button" disabled={busy} onClick={save}>
                {copy.save}
            </button>
            {themes.length >= 20 && <p>{copy.limit}</p>}
            {error && <p role="alert">{error}</p>}
        </details>
    );
};
