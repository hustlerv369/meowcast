import type { PasswordGeneratorSettings } from "@common/Extensions/PasswordGenerator";

export class PasswordGenerator {
    public static generatePassword(settings: PasswordGeneratorSettings): string {
        const baseCharset = this.determineCharset(settings);

        let password = "";
        let previousCharacter = "";

        for (let index = 0; index < settings.passwordLength; index++) {
            let nextCharacter = "";
            let isValid = false;
            let safetyCounter = 0;
            const maxAttempts = Math.max(64, settings.passwordLength * 64);

            while (isValid === false) {
                if (safetyCounter++ > maxAttempts) {
                    throw new Error(
                        "Unable to generate password: constraints cannot be satisfied with the selected settings",
                    );
                }

                isValid = true;
                nextCharacter = this.pickCharacter(
                    index === 0 && settings.beginWithALetter ? baseCharset.letterCharset : baseCharset.completeCharset,
                );

                if (
                    settings.noSequentialCharacters === true &&
                    (previousCharacter.charCodeAt(0) + 1 === nextCharacter.charCodeAt(0) ||
                        previousCharacter.charCodeAt(0) - 1 === nextCharacter.charCodeAt(0))
                ) {
                    isValid = false;
                }

                if (isValid === true && settings.noDuplicateCharacters === true) {
                    const occurrenceCount = (password + previousCharacter).split(nextCharacter).length - 1;

                    if (occurrenceCount > 0) {
                        isValid = false;
                    }
                }
            }

            previousCharacter = nextCharacter;
            password += nextCharacter;
        }

        return password;
    }

    private static pickCharacter(charset: string) {
        if (charset.length === 0) {
            throw new Error("Cannot pick character from empty charset");
        }

        const randomBuffer = new Uint32Array(1);
        crypto.getRandomValues(randomBuffer);

        const randomNumber = randomBuffer[0] / (0xffffffff + 1);
        const index = Math.floor(randomNumber * charset.length);
        return charset.charAt(index);
    }

    private static determineCharset(settings: PasswordGeneratorSettings): {
        completeCharset: string;
        letterCharset: string;
    } {
        const uppercaseCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const lowercaseCharacters = "abcdefghijklmnopqrstuvwxyz";
        const numbers = "0123456789";
        const symbols = settings.symbols;

        let charset: string = "";
        let letterCharset: string = "";

        if (settings.includeUppercaseCharacters === true) {
            charset += uppercaseCharacters;
            letterCharset += uppercaseCharacters;
        }

        if (settings.includeLowercaseCharacters === true) {
            charset += lowercaseCharacters;
            letterCharset += lowercaseCharacters;
        }

        if (settings.includeNumbers === true) {
            charset += numbers;
        }

        if (settings.includeSymbols === true) {
            charset += symbols;
        }

        if (settings.noSimilarCharacters === true) {
            charset = charset.replace(/[01ilo|]/gi, "");
            letterCharset = letterCharset.replace(/[01ilo|]*/gi, "");
        }

        return { completeCharset: charset, letterCharset: letterCharset };
    }
}
