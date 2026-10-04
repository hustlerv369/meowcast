import type { PasswordGeneratorSettings } from "@common/Extensions/PasswordGenerator";
import { PasswordGeneratorDefaultSymbols } from "@common/Extensions/PasswordGenerator";
import { describe, expect, it } from "vitest";
import { PasswordGenerator } from "./PasswordGenerator";

describe(PasswordGenerator, () => {
    describe(PasswordGenerator.generatePassword, () => {
        const validateSymbols = (password: string, settings: PasswordGeneratorSettings): boolean => {
            const symbolsOnly = password.replace(/[a-z0-9]/gi, "");

            if (settings.includeSymbols === false && symbolsOnly.length > 0) {
                return false;
            }

            for (const symbol of Array.from(symbolsOnly)) {
                if (settings.symbols.indexOf(symbol) < 0) {
                    return false;
                }
            }

            return true;
        };

        const validateDuplicateCharacters = (password: string): boolean => {
            const characterSet = new Set<string>();

            for (const character of password) {
                if (characterSet.has(character)) {
                    return true;
                }

                characterSet.add(character);
            }

            return false;
        };

        const validateSequentialCharacters = (password: string): boolean => {
            let previousCharacter = "";

            for (const character of password) {
                if (
                    previousCharacter.charCodeAt(0) + 1 === character.charCodeAt(0) ||
                    previousCharacter.charCodeAt(0) - 1 === character.charCodeAt(0)
                ) {
                    return true;
                }

                previousCharacter = character;
            }

            return false;
        };

        const validatePasswords = (passwords: string[], settings: PasswordGeneratorSettings): boolean => {
            if (passwords.length !== settings.quantity) {
                return false;
            }

            for (const password of passwords) {
                if (password.length !== settings.passwordLength) {
                    return false;
                }

                if (settings.includeUppercaseCharacters === false && /[A-Z]/.test(password) === true) {
                    return false;
                }

                if (settings.includeLowercaseCharacters === false && /[a-z]/.test(password) === true) {
                    return false;
                }

                if (settings.includeNumbers === false && /[0-9]/.test(password) === true) {
                    return false;
                }

                if (validateSymbols(password, settings) === false) {
                    return false;
                }

                if (settings.beginWithALetter === true && /[a-z]/i.test(password.charAt(0)) === false) {
                    return false;
                }

                if (settings.noSimilarCharacters === true && /[01ilo|]/gi.test(password) === true) {
                    return false;
                }

                if (settings.noDuplicateCharacters === true && validateDuplicateCharacters(password) === true) {
                    return false;
                }

                if (settings.noSequentialCharacters === true && validateSequentialCharacters(password) === true) {
                    return false;
                }
            }

            return true;
        };

        it.each([
            [
                <PasswordGeneratorSettings>{
                    command: "pw",
                    quantity: 100,
                    passwordLength: 24,
                    includeUppercaseCharacters: true,
                    includeLowercaseCharacters: true,
                    includeNumbers: true,
                    includeSymbols: true,
                    symbols: PasswordGeneratorDefaultSymbols,
                    beginWithALetter: false,
                    noSimilarCharacters: false,
                    noDuplicateCharacters: false,
                    noSequentialCharacters: false,
                },
            ],
            [
                <PasswordGeneratorSettings>{
                    command: "pw",
                    quantity: 100,
                    passwordLength: 24,
                    includeUppercaseCharacters: true,
                    includeLowercaseCharacters: true,
                    includeNumbers: true,
                    includeSymbols: true,
                    symbols: PasswordGeneratorDefaultSymbols,
                    beginWithALetter: true,
                    noSimilarCharacters: true,
                    noDuplicateCharacters: false,
                    noSequentialCharacters: false,
                },
            ],
            [
                <PasswordGeneratorSettings>{
                    command: "pw",
                    quantity: 100,
                    passwordLength: 24,
                    includeUppercaseCharacters: true,
                    includeLowercaseCharacters: true,
                    includeNumbers: true,
                    includeSymbols: true,
                    symbols: PasswordGeneratorDefaultSymbols,
                    beginWithALetter: true,
                    noSimilarCharacters: false,
                    noDuplicateCharacters: true,
                    noSequentialCharacters: false,
                },
            ],
            [
                <PasswordGeneratorSettings>{
                    command: "pw",
                    quantity: 100,
                    passwordLength: 24,
                    includeUppercaseCharacters: true,
                    includeLowercaseCharacters: true,
                    includeNumbers: true,
                    includeSymbols: true,
                    symbols: PasswordGeneratorDefaultSymbols,
                    beginWithALetter: false,
                    noSimilarCharacters: false,
                    noDuplicateCharacters: false,
                    noSequentialCharacters: true,
                },
            ],
            [
                <PasswordGeneratorSettings>{
                    command: "pw",
                    quantity: 100,
                    passwordLength: 24,
                    includeUppercaseCharacters: false,
                    includeLowercaseCharacters: false,
                    includeNumbers: false,
                    includeSymbols: true,
                    symbols: "+-*/",
                    beginWithALetter: false,
                    noSimilarCharacters: false,
                    noDuplicateCharacters: false,
                    noSequentialCharacters: false,
                },
            ],
        ])("passwords should be valid compared to the settings", (settings) => {
            expect(
                validatePasswords(
                    Array.from({ length: settings.quantity }, () => PasswordGenerator.generatePassword(settings)),
                    settings,
                ),
            ).toEqual(true);
        });
    });
});
