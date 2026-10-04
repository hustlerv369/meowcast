import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClipboardControls } from "../Components/ClipboardControls";
import { SearchBar } from "../Search/SearchBar";
import { StudioPrivacyIntro, StudioWelcome } from "./StudioWelcome";

const settings = (values: Record<string, unknown>) => {
    vi.stubGlobal("window", {
        ContextBridge: {
            getSettingValue: (key: string, fallback: unknown) => values[key] ?? fallback,
        },
    });
};
afterEach(() => vi.unstubAllGlobals());

describe("Studio acceptance regressions", () => {
    it("enables the translucent frame for new installs while preserving explicit opaque preference", () => {
        settings({});
        const fresh = renderToStaticMarkup(<StudioWelcome firstRun={false} onDone={() => undefined} />);
        expect(fresh).toMatch(/type="checkbox"[^>]*checked=""/);
        settings({ "studio.transparency": false });
        const opaque = renderToStaticMarkup(<StudioWelcome firstRun={false} onDone={() => undefined} />);
        expect(opaque).not.toMatch(/type="checkbox"[^>]*checked=""/);
    });

    it("first launch teaches app search, calculation and keyboard use before setup choices", () => {
        settings({});
        const html = renderToStaticMarkup(<StudioWelcome firstRun onDone={() => undefined} />);
        expect(html).toContain("24 * 7");
        expect(html).toContain("Ctrl+K");
        expect(html).toContain("No launcher account required");
        expect(html).toContain('aria-current="step"');
        expect(html).toContain("Continue");
        expect(html).not.toContain("Set up AI");
        expect(html).not.toContain("Start without AI");
    });

    it("appearance revisit goes directly to theme controls without replaying the manual", () => {
        settings({});
        const html = renderToStaticMarkup(<StudioWelcome firstRun={false} onDone={() => undefined} />);
        expect(html).toContain("Live theme preview");
        expect(html).toContain("Back to launcher");
        expect(html).not.toContain("Getting started");
        expect(html).not.toContain("24 * 7");
    });

    it("the optional connection explanation distinguishes provider costs, clipboard consent and offline limits", () => {
        settings({});
        const html = renderToStaticMarkup(<StudioPrivacyIntro />);
        expect(html).toContain("usage charges apply");
        expect(html).toContain("only after you enable it");
        expect(html).toContain("External browser links");
        expect(html).not.toContain("<input");
    });

    it("the first-launch manual has Czech copy", () => {
        settings({ "general.language": "cs-CZ" });
        const html = renderToStaticMarkup(<StudioWelcome firstRun onDone={() => undefined} />);
        expect(html).toContain("Otevřete aplikaci");
        expect(html).toContain("Účet launcheru nepotřebujete");
        expect(html).toContain("Pokračovat");
    });

    it("discloses imported persistent clipboard storage instead of promising session-only retention", () => {
        settings({ "clipboard.persistHistory": true });
        const html = renderToStaticMarkup(<ClipboardControls />);
        expect(html).toContain("Storage: between sessions");
        expect(html).toContain("operating-system encryption");
        expect(html).not.toContain("Storage: current session only");
    });

    it("discloses persistent clipboard storage in Czech", () => {
        settings({ "clipboard.persistHistory": true, "general.language": "cs-CZ" });
        expect(renderToStaticMarkup(<ClipboardControls />)).toContain("Uchování: i po zavření aplikace");
    });

    it("keeps session-only retention as the default", () => {
        settings({});
        expect(renderToStaticMarkup(<ClipboardControls />)).toContain("Storage: current session only");
    });

    it("does not advertise a disabled shortcut as usable", () => {
        settings({ "general.hotkey.enabled": false });
        const html = renderToStaticMarkup(<StudioWelcome firstRun onDone={() => undefined} />);
        expect(html).toContain("Launcher shortcut is disabled");
        expect(html).not.toContain("Open your launcher with");
    });

    it.each([undefined, "Application:Notepad"])("retains combobox semantics for active result %s", (activeResultId) => {
        const html = renderToStaticMarkup(
            <SearchBar
                resultsListId="studio-search-results"
                activeResultId={activeResultId}
                searchBarSize="large"
                searchBarAppearance="auto"
                searchBarPlaceholderText="Search"
                showIcon
            />,
        );
        expect(html).toContain('role="combobox"');
        expect(html).toContain(`aria-expanded="${Boolean(activeResultId)}"`);

        if (activeResultId) {
            expect(html).toContain('aria-activedescendant="studio-result-Application%3ANotepad"');
        } else {
            expect(html).not.toContain("aria-activedescendant");
        }
    });
});
