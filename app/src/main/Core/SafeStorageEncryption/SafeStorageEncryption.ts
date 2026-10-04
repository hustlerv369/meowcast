import type { SafeStorage } from "electron";
import type { SafeStorageEncryption as SafeStorageEncryptionInterface } from "./Contract";

export class SafeStorageEncryption implements SafeStorageEncryptionInterface {
    public constructor(private readonly safeStorage: SafeStorage) {}
    private available(): boolean {
        return (
            this.safeStorage.isEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend?.() !== "basic_text"
        );
    }
    public encryptString(plainText: string): string {
        if (!this.available()) {
            throw new Error("Secure storage unavailable. Secret was not saved.");
        }

        try {
            return this.safeStorage.encryptString(plainText).toString("base64");
        } catch {
            throw new Error("Secure storage failed. Secret was not saved.");
        }
    }
    public decryptString(encryptedText: string): string {
        if (!encryptedText) {
            return "";
        }

        if (!this.available()) {
            return "";
        }

        try {
            return this.safeStorage.decryptString(Buffer.from(encryptedText, "base64"));
        } catch {
            return "";
        } // Never interpret legacy plaintext as a secret.
    }
}
