import type { AssetPathResolver } from "@Core/AssetPathResolver";
import type { SettingsManager } from "@Core/SettingsManager";
import type { Translator } from "@Core/Translator";
import type { App } from "electron";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClipboardHistoryExtension } from "./ClipboardHistoryExtension";
const fixture = vi.hoisted(() => ({ text: "", encrypted: true, poll: () => {}, directory: "" }));
vi.mock("electron", () => ({
    clipboard: { readText: () => fixture.text, availableFormats: () => [] },
    safeStorage: {
        isEncryptionAvailable: () => fixture.encrypted,
        encryptString: (text: string) => Buffer.from("TEST-ENCRYPTED:" + text),
        decryptString: (buffer: Buffer) => {
            if (!buffer.toString().startsWith("TEST-ENCRYPTED:")) {
                throw new Error("Not encrypted");
            }

            return buffer.toString().slice(15);
        },
    },
}));
let values: Record<string, unknown>;
const instance = () =>
    new ClipboardHistoryExtension(
        { getPath: () => fixture.directory } as unknown as App,
        {} as AssetPathResolver,
        {} as Translator,
        {
            getValue: (key: string, fallback: unknown) => values[key] ?? fallback,
            updateValue: async (key: string, value: unknown) => {
                values[key] = value;
            },
        } as unknown as SettingsManager,
    );
beforeEach(async () => {
    fixture.directory = await mkdtemp(join(tmpdir(), "meowcast-clipboard-test-"));
    fixture.text = "";
    fixture.encrypted = true;
    values = {};
    vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void) => {
        fixture.poll = callback;
        return 1;
    }) as unknown as typeof setInterval);
});
afterEach(async () => {
    vi.restoreAllMocks();
    await rm(fixture.directory, { recursive: true, force: true });
});
const copy = (text: string) => {
    fixture.text = text;
    fixture.poll();
};

describe("clipboard capacity and retention", () => {
    it("persists only encrypted bytes and restores the latest queued snapshot", async () => {
        values["clipboard.persistHistory"] = true;
        values["clipboard.recording"] = true;
        const extension = instance();
        copy("first saved fixture");
        copy("second saved fixture");
        await extension.invoke({ command: "status" });
        expect(
            (await readFile(join(fixture.directory, "clipboard-history.json"), "utf8")).startsWith("TEST-ENCRYPTED:"),
        ).toBe(true);
        expect(await instance().invoke({ command: "status" })).toMatchObject({ count: 2 });
    });
    it("requires recording opt-in and validates capacity without silently accepting arbitrary numbers", async () => {
        const extension = instance();
        copy("not recorded");
        expect(await extension.invoke({ command: "status" })).toMatchObject({
            recording: false,
            count: 0,
            capacity: 300,
        });

        for (const capacity of [0, -1, 999999, "1000", NaN]) {
            await expect(extension.invoke({ command: "capacity", capacity })).rejects.toThrow();
        }

        await expect(extension.invoke({ command: "mystery" })).rejects.toThrow();
        await extension.invoke({ command: "capacity", capacity: 1000 });
        await extension.invoke({ command: "enable" });

        for (let index = 0; index < 350; index++) {
            copy(`entry ${index}`);
        }

        expect(await extension.invoke({ command: "status" })).toMatchObject({ count: 350, capacity: 1000 });
        await extension.invoke({ command: "capacity", capacity: 300 });
        expect(await extension.invoke({ command: "status" })).toMatchObject({ count: 350 });
        copy("capacity rolls over on next copy");
        expect(await extension.invoke({ command: "status" })).toMatchObject({ count: 300 });
    });
    it("restores encrypted old entries without an age expiry and preserves a lowered capacity until next copy", async () => {
        values["clipboard.persistHistory"] = true;
        const entries = Array.from({ length: 350 }, (_, index) => ({ text: `old ${index}`, copiedAt: 1 }));
        await writeFile(join(fixture.directory, "clipboard-history.json"), "TEST-ENCRYPTED:" + JSON.stringify(entries));
        expect(await instance().invoke({ command: "status" })).toMatchObject({ count: 350, capacity: 300 });
    });
    it("serializes persistence then clear so pending writes cannot resurrect cleared history", async () => {
        values["clipboard.persistHistory"] = true;
        values["clipboard.recording"] = true;
        const extension = instance();
        copy("first");
        copy("second");
        await extension.invoke({ command: "clear" });
        await expect(readFile(join(fixture.directory, "clipboard-history.json"))).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(await extension.invoke({ command: "status" })).toMatchObject({ count: 0 });
    });
    it("never writes plaintext if OS encryption is unavailable", async () => {
        values["clipboard.persistHistory"] = true;
        values["clipboard.recording"] = true;
        fixture.encrypted = false;
        const extension = instance();
        copy("fixture private text");
        expect(await extension.invoke({ command: "status" })).toMatchObject({ count: 1, encryptionAvailable: false });
        await expect(readFile(join(fixture.directory, "clipboard-history.json"))).rejects.toMatchObject({
            code: "ENOENT",
        });
    });
});
