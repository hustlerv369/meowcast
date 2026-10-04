import { use } from "i18next";
import { initReactI18next } from "react-i18next";
import { createResources } from "./createResources";
import { getCoreResources } from "./getCoreResources";
import { getExtensionResources } from "./getExtensionResources";

let initPromise: Promise<unknown> | undefined;

/**
 * Initialize i18next exactly once per renderer. Calling `init()` on every App render re-fires
 * i18next's synchronous "initialized" event, which updates already-mounted subscribers (e.g.
 * NoResultsFound) during App's render phase — the React "Cannot update a component while rendering
 * a different component" warning. Memoizing the init promise makes re-renders a no-op.
 */
export const useI18n = () => {
    if (!initPromise) {
        initPromise = use(initReactI18next).init({
            resources: createResources([
                ...getCoreResources(),
                ...getExtensionResources(window.ContextBridge.getExtensionResources()),
            ]),
            lng: window.ContextBridge.getSettingValue("general.language", "en-US"),
            fallbackLng: "en-US",
        });
    }

    return initPromise;
};
