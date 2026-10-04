import type { SafeStorageEncryption } from "@Core/SafeStorageEncryption";
import type { EventEmitter } from "../EventEmitter";
import type { Settings } from "../Settings";
import type { SettingsReader } from "../SettingsReader";
import type { SettingsWriter } from "../SettingsWriter";
import type { SettingsManager as SettingsManagerInterface } from "./Contract";

export class SettingsManager implements SettingsManagerInterface {
    public readonly settings: Settings;
    private readonly sensitiveKeys = new Set<string>();
    private readonly unreadableSecrets = new Set<string>();
    private isSecret(key: string): boolean {
        return this.sensitiveKeys.has(key) || /api.?key|token|password|secret|credential/i.test(key);
    }

    public constructor(
        private readonly settingsReader: SettingsReader,
        private readonly settingsWriter: SettingsWriter,
        private readonly eventEmitter: EventEmitter,
        private readonly safeStorageEncryption: SafeStorageEncryption,
    ) {
        this.settings = this.settingsReader.readSettings();

        // Quarantine unreadable/legacy credentials; never re-persist them or silently destroy encrypted values.
        for (const key of Object.keys(this.settings)) {
            if (
                this.isSecret(key) &&
                (typeof this.settings[key] !== "string" ||
                    !this.safeStorageEncryption.decryptString(this.settings[key] as string))
            ) {
                this.unreadableSecrets.add(key);
            }
        }
    }

    public getValue<T>(key: string, defaultValue: T, isSensitive?: boolean): T {
        if (isSensitive) {
            this.sensitiveKeys.add(key);
        }

        if (Object.keys(this.settings).includes(key)) {
            const value = this.settings[key] as T;
            return isSensitive || this.isSecret(key) ? this.decryptValue<T>(value as string) : value;
        }

        return defaultValue;
    }

    public async updateValue<T>(key: string, value: T, isSensitive?: boolean): Promise<void> {
        if (isSensitive) {
            this.sensitiveKeys.add(key);
        }

        // A key saved for one host must never be sent to a newly configured provider.
        if ((key === "extension[Ai].provider" || key === "extension[Ai].baseUrl") && this.settings[key] !== value) {
            delete this.settings["extension[Ai].apiKey"];
            this.unreadableSecrets.delete("extension[Ai].apiKey");
        }

        const sensitive = isSensitive || this.isSecret(key);

        if (sensitive && value === "") {
            delete this.settings[key];
        } else {
            this.settings[key] = sensitive ? this.encryptValue<T>(value) : value;
        }

        this.unreadableSecrets.delete(key);
        const visibleValue = sensitive ? undefined : value;
        this.eventEmitter.emitEvent("settingUpdated", { key, value: visibleValue });
        this.eventEmitter.emitEvent(`settingUpdated[${key}]`, { value: visibleValue });
        await this.saveChanges();
    }

    public async importSettings(filePath: string): Promise<void> {
        const importSettings = this.settingsReader.readSettingsFromPath(filePath);
        await this.settingsWriter.writeSettings(
            Object.fromEntries(Object.entries(importSettings).filter(([key]) => !this.isSecret(key))),
        );
    }

    public async exportSettings(filePath: string): Promise<void> {
        await this.settingsWriter.writeSettingsToPath(
            Object.fromEntries(Object.entries(this.settings).filter(([key]) => !this.isSecret(key))),
            filePath,
        );
    }

    public async resetAllSettings(): Promise<void> {
        this.unreadableSecrets.clear();

        for (const key of Object.keys(this.settings)) {
            delete this.settings[key];
        }

        await this.saveChanges();
    }

    private async saveChanges(): Promise<void> {
        if (this.unreadableSecrets.size) {
            throw new Error("Stored credentials cannot be decrypted. Remove or replace them before saving settings.");
        }

        await this.settingsWriter.writeSettings(this.settings);
    }

    private encryptValue<T>(plainText: T): T {
        return this.safeStorageEncryption.encryptString(plainText as string) as T;
    }

    private decryptValue<T>(encryptedValue: string): T {
        return this.safeStorageEncryption.decryptString(encryptedValue) as T;
    }
}
