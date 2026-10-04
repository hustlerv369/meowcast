import type { Net, Session } from "electron";

export const OFFLINE_MESSAGE = "Offline mode is enabled. Disable it to use network features.";
export const shouldBlockNetwork = (url: string, offline: boolean): boolean => offline && /^(https?|wss?):/i.test(url);

/** Guard the actual Electron boundary; no provider may silently bypass offline mode. */
export const createPrivateNet = (net: Net, isOffline: () => boolean): Net =>
    new Proxy(net, {
        get(target, property) {
            if (property === "fetch") {
                return async (...args: Parameters<Net["fetch"]>) => {
                    if (isOffline()) {
                        throw new Error(OFFLINE_MESSAGE);
                    }

                    return target.fetch(...args);
                };
            }

            if (property === "request") {
                return (...args: Parameters<Net["request"]>) => {
                    if (isOffline()) {
                        throw new Error(OFFLINE_MESSAGE);
                    }

                    return target.request(...args);
                };
            }

            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });

export const protectSession = (session: Session, isOffline: () => boolean): void => {
    session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
        callback({ cancel: shouldBlockNetwork(details.url, isOffline()) });
    });
};
