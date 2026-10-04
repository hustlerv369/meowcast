import type { SafeStorageEncryption } from "@Core/SafeStorageEncryption";
import { describe, expect, it, vi } from "vitest";
import type { EventEmitter } from "../EventEmitter";
import type { SettingsReader } from "../SettingsReader";
import type { SettingsWriter } from "../SettingsWriter";
import { SettingsManager } from "./SettingsManager";
const fixture = (initial: Record<string, unknown> = {}, encryptionAvailable = true) => {
    const write = vi.fn(),
        exportWrite = vi.fn(),
        emit = vi.fn();
    const encryption = {
        encryptString: (text: string) => {
            if (!encryptionAvailable) {
                throw new Error("Secure storage unavailable");
            }

            return `encrypted:${text}`;
        },
        decryptString: (text: string) => (text.startsWith("encrypted:") ? text.slice(10) : ""),
    } as SafeStorageEncryption;
    const manager = new SettingsManager(
        {
            readSettings: () => ({ ...initial }),
            readSettingsFromPath: () => ({ "extension[Ai].apiKey": "secret", theme: "safe" }),
        } as SettingsReader,
        { writeSettings: write, writeSettingsToPath: exportWrite } as SettingsWriter,
        { emitEvent: emit } as EventEmitter,
        encryption,
    );
    return { manager, write, exportWrite, emit };
};
describe("Settings privacy boundaries", () => {
    it("refuses cleartext persistence even when renderer omits sensitive flag", async () => {
        const f = fixture({}, false);
        await expect(f.manager.updateValue("extension[Ai].apiKey", "private-key")).rejects.toThrow("unavailable");
        expect(f.write).not.toHaveBeenCalled();
        expect(f.manager.settings).toEqual({});
    });
    it("never broadcasts a decrypted secret", async () => {
        const f = fixture();
        await f.manager.updateValue("extension[Ai].apiKey", "private-key");
        expect(JSON.stringify(f.emit.mock.calls)).not.toContain("private-key");
        expect(f.write.mock.calls[0][0]["extension[Ai].apiKey"]).toBe("encrypted:private-key");
    });
    it("excludes credentials from exports and imports", async () => {
        const f = fixture({ "extension[Ai].apiKey": "encrypted:private-key", theme: "safe" });
        await f.manager.exportSettings("out.json");
        expect(f.exportWrite).toHaveBeenCalledWith({ theme: "safe" }, "out.json");
        await f.manager.importSettings("in.json");
        expect(f.write).toHaveBeenCalledWith({ theme: "safe" });
    });
    it("quarantines legacy cleartext until explicitly replaced or removed", async () => {
        const f = fixture({ "extension[Ai].apiKey": "plaintext" });
        await expect(f.manager.updateValue("theme", "safe")).rejects.toThrow("cannot be decrypted");
        expect(f.write).not.toHaveBeenCalled();
        await f.manager.updateValue("extension[Ai].apiKey", "");
        expect(f.manager.settings).toEqual({ theme: "safe" });
    });
    it("clears persisted credentials before changing destination", async () => {
        const f = fixture({
            "extension[Ai].apiKey": "encrypted:private-key",
            "extension[Ai].baseUrl": "https://old.test",
        });
        await f.manager.updateValue("extension[Ai].baseUrl", "https://new.test");
        expect(f.manager.getValue("extension[Ai].apiKey", "", true)).toBe("");
    });
});
