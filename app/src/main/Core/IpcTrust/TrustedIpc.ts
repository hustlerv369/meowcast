import type { BrowserWindow, IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Event = IpcMainEvent | IpcMainInvokeEvent;
type Listener = (event: Event, ...args: unknown[]) => unknown;
type Options = {
    windows: () => BrowserWindow[];
    rendererDirectory: string;
    isPackaged: boolean;
    devServerUrl?: string;
};

export const createSenderValidator = (options: Options): ((event: Event) => boolean) => {
    const normalized = (value: string) => {
        const url = new URL(value);
        url.hash = "";
        url.search = "";
        return url.href;
    };
    const allowed = new Set(
        ["search.html", "settings.html"].map((file) =>
            normalized(pathToFileURL(join(options.rendererDirectory, file)).href),
        ),
    );

    if (!options.isPackaged && options.devServerUrl) {
        try {
            const base = new URL(options.devServerUrl);

            if (["http:", "https:"].includes(base.protocol) && !base.username && !base.password) {
                for (const file of ["search.html", "settings.html"]) {
                    allowed.add(normalized(`${options.devServerUrl}/${file}`));
                }
            }
        } catch {
            /* An invalid development URL does not grant access. */
        }
    }

    return (event) => {
        try {
            const sender = event?.sender;
            const frame = event?.senderFrame;
            return Boolean(
                sender &&
                frame &&
                !sender.isDestroyed() &&
                frame === sender.mainFrame &&
                options.windows().some((window) => !window.isDestroyed() && window.webContents === sender) &&
                allowed.has(normalized(frame.url)) &&
                allowed.has(normalized(sender.getURL())),
            );
        } catch {
            return false;
        }
    };
};

export const protectIpcMain = (ipc: IpcMain, trusted: (event: Event) => boolean): IpcMain => {
    const registrations: { channel: string; listener: Listener; wrapped: Listener }[] = [];
    const deny = (event: Event) => {
        try {
            (event as IpcMainEvent).returnValue = null;
        } catch {
            /* Malformed events fail closed. */
        }
    };
    const proxy = new Proxy(ipc, {
        get(target, property) {
            if (["on", "addListener", "once", "prependListener", "prependOnceListener"].includes(String(property))) {
                return (channel: string, listener: Listener) => {
                    const once = property === "once" || property === "prependOnceListener";
                    const wrapped: Listener = (event, ...args) => {
                        if (!trusted(event)) {
                            deny(event);
                            return;
                        }

                        if (once) {
                            target.removeListener(channel, wrapped);
                            const index = registrations.findIndex((r) => r.wrapped === wrapped);

                            if (index >= 0) {
                                registrations.splice(index, 1);
                            }
                        }

                        return listener.call(proxy, event, ...args);
                    };
                    registrations.push({ channel, listener, wrapped });

                    if (String(property).startsWith("prepend")) {
                        target.prependListener(channel, wrapped);
                    } else {
                        target.on(channel, wrapped);
                    }

                    return proxy;
                };
            }

            if (property === "handle" || property === "handleOnce") {
                return (channel: string, listener: Listener) =>
                    target.handle(channel, (event, ...args) => {
                        if (!trusted(event)) {
                            throw new Error("IPC sender is not trusted");
                        }

                        if (property === "handleOnce") {
                            target.removeHandler(channel);
                        }

                        return listener(event, ...args);
                    });
            }

            if (property === "removeListener" || property === "off") {
                return (channel: string, listener: Listener) => {
                    const index = registrations.findLastIndex((r) => r.channel === channel && r.listener === listener);

                    if (index >= 0) {
                        target.removeListener(channel, registrations.splice(index, 1)[0].wrapped);
                    } else {
                        target.removeListener(channel, listener);
                    }

                    return proxy;
                };
            }

            if (property === "removeAllListeners") {
                return (channel?: string) => {
                    for (let i = registrations.length - 1; i >= 0; i--) {
                        if (channel === undefined || registrations[i].channel === channel) {
                            registrations.splice(i, 1);
                        }
                    }

                    if (channel === undefined) {
                        target.removeAllListeners();
                    } else {
                        target.removeAllListeners(channel);
                    }

                    return proxy;
                };
            }

            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    return proxy;
};
