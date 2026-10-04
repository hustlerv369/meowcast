import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSetting } from "./useSetting";

// Minimal hook host: these tests exercise asynchronous IPC ordering, not rendering.
const host = vi.hoisted(() => ({ value: "light", effects: [] as (() => unknown)[] }));
vi.mock("react", () => ({
    useState: (initial: string) => {
        host.value = initial;
        return [initial, (value: string) => (host.value = value)];
    },
    useRef: (current: unknown) => ({ current }),
    useEffect: (effect: () => unknown) => host.effects.push(effect),
}));

const deferred = () => {
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
};

describe("useSetting persistence", () => {
    const write = vi.fn();
    const on = vi.fn();

    beforeEach(() => {
        host.effects = [];
        write.mockReset();
        on.mockReset();
        vi.stubGlobal("window", {
            ContextBridge: {
                getSettingValue: () => "light",
                updateSettingValue: write,
                ipcRenderer: { on, off: vi.fn() },
            },
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("applies theme broadcasts from another window without a local write", () => {
        useSetting({ key: "appearance.themeSource", defaultValue: "light" });
        host.effects.forEach((effect) => effect());
        expect(on.mock.calls[0][0]).toBe("settingUpdated[appearance.themeSource]");
        on.mock.calls[0][1](undefined, { value: "dark" });
        expect(host.value).toBe("dark");
        expect(write).not.toHaveBeenCalled();
    });

    it("restores the saved choice when an optimistic write fails", async () => {
        const pending = deferred();
        write.mockReturnValue(pending.promise);
        const setting = useSetting({ key: "appearance.themeSource", defaultValue: "light" });
        const result = setting.updateValue("dark");
        expect(host.value).toBe("dark");
        pending.reject(new Error("disk full"));
        await expect(result).rejects.toThrow("disk full");
        expect(host.value).toBe("light");
    });

    it("does not undo a newer successful choice when an older write fails late", async () => {
        const older = deferred();
        const newer = deferred();
        write.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
        const setting = useSetting({ key: "appearance.themeSource", defaultValue: "light" });
        const oldResult = setting.updateValue("dark");
        const newResult = setting.updateValue("system");
        newer.resolve();
        await newResult;
        older.reject(new Error("old failure"));
        await expect(oldResult).rejects.toThrow("old failure");
        expect(host.value).toBe("system");
    });

    it("retains an authoritative IPC update when a pending write subsequently fails", async () => {
        const pending = deferred();
        write.mockReturnValue(pending.promise);
        const setting = useSetting({ key: "appearance.themeSource", defaultValue: "light" });
        host.effects.forEach((effect) => effect());
        const result = setting.updateValue("dark");
        on.mock.calls[0][1](undefined, { value: "system" });
        pending.reject(new Error("write failed"));
        await expect(result).rejects.toThrow("write failed");
        expect(host.value).toBe("system");
    });
});
