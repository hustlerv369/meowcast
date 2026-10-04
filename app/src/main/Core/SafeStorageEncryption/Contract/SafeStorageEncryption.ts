/**
 * Offers methods to encrypt and decrypt strings.
 */
export interface SafeStorageEncryption {
    /**
     * Encrypts a string. Throws if secure encryption is unavailable; plaintext is never returned.
     * @param plainText The string to encrypt.
     * @returns The encrypted string.
     */
    encryptString(plainText: string): string;

    /**
     * Decrypts a string. Returns an empty string for unavailable encryption or unreadable ciphertext.
     * @param encryptedText The string to decrypt.
     * @returns The decrypted string.
     */
    decryptString(encryptedText: string): string;
}
