import type { Net, Session } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createPrivateNet, protectSession, shouldBlockNetwork } from "./NetworkPrivacy";
describe("Network privacy", () => {
    it("blocks provider fetch and request before they leave the app", async () => {
        const fetch = vi.fn(),
            request = vi.fn();
        const net = createPrivateNet({ fetch, request } as unknown as Net, () => true);
        await expect(net.fetch("https://example.test")).rejects.toThrow("Offline mode");
        expect(() => net.request("https://example.test")).toThrow("Offline mode");
        expect(fetch).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });
    it("re-evaluates live state for every call", async () => {
        let offline = false;
        const fetch = vi.fn().mockResolvedValue("ok");
        const net = createPrivateNet({ fetch } as unknown as Net, () => offline);
        expect(await net.fetch("https://example.test")).toBe("ok");
        offline = true;
        await expect(net.fetch("https://example.test")).rejects.toThrow("Offline mode");
        expect(fetch).toHaveBeenCalledOnce();
    });
    it("blocks remote HTTP and websocket resources, preserving local bundled files", () => {
        for (const url of ["https://example.test", "http://localhost:123", "ws://example.test", "wss://example.test"]) {
            expect(shouldBlockNetwork(url, true)).toBe(true);
        }

        expect(shouldBlockNetwork("file:///app/search.html", true)).toBe(false);
        expect(shouldBlockNetwork("https://example.test", false)).toBe(false);
    });
    it("guards renderer traffic through the default session", () => {
        const onBeforeRequest = vi.fn();
        protectSession({ webRequest: { onBeforeRequest } } as unknown as Session, () => true);
        const callback = vi.fn();
        onBeforeRequest.mock.calls[0][1]({ url: "https://example.test" }, callback);
        expect(callback).toHaveBeenCalledWith({ cancel: true });
    });
});
