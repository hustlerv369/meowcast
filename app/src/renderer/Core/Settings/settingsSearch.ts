export const SETTINGS_QUERY_LIMIT = 100;

const topics: Record<string, string> = {
    "/": "general language offline privacy startup autostart meowmate companion cat dock tray hotkey shortcut history import export browser jazyk soukromí spuštění zkratka historie prohlížeč kočka",
    "/window":
        "window opacity transparency acrylic mica vibrancy hide startup top scroll workspace okno průhlednost skrýt posouvání plocha",
    "/appearance":
        "appearance theme color size results search bar glass transparency vzhled motiv barva velikost výsledky sklo průhlednost",
    "/keyboard-and-mouse": "keyboard mouse click double drag drop klávesnice myš kliknutí přetažení",
    "/search-engine":
        "search engine rescan indexing interval automatic fuzzy results vyhledávání indexování skenování interval výsledky",
    "/favorites": "favorites oblíbené",
    "/excluded-items": "excluded hidden items vyloučené skryté položky",
    "/extensions": "extensions enable disable rozšíření zapnout vypnout",
    "/about": "about version verze electron node v8",
    "/debug": "debug logs reset cache ladění protokoly reset mezipaměť",
};

const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Search public section metadata only; never inspect stored settings or secrets. */
export const matchesSettingsSection = (query: string, label: string, path: string, name = ""): boolean => {
    const terms = normalize(query.slice(0, SETTINGS_QUERY_LIMIT)).trim().split(/\s+/).filter(Boolean);
    const haystack = normalize(`${label} ${name} ${topics[path] ?? ""}`);
    return terms.every((term) => haystack.includes(term));
};

export const isSettingsFindShortcut = (
    event: {
        key: string;
        ctrlKey: boolean;
        metaKey: boolean;
        altKey: boolean;
        shiftKey: boolean;
        isComposing: boolean;
        defaultPrevented: boolean;
    },
    modalOpen: boolean,
): boolean =>
    !modalOpen &&
    !event.isComposing &&
    !event.defaultPrevented &&
    !event.altKey &&
    !event.shiftKey &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "f";
