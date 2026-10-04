import { describe, expect, it } from "vitest";
import { buildStructuredPrompt } from "../../../common/Extensions/Ai/PromptActions";
import { getAiCopy } from "./AiCopy";

describe("AI language selection", () => {
    it("separates subscription login from a successful test and discloses provider changes", () => {
        for (const language of ["en-US", "cs-CZ"]) {
            const copy = getAiCopy(language);
            expect(copy.subscriptionSignedIn).toContain("Test");
            expect(copy.subscriptionSetup).toContain("{login}");
            expect(copy.providerSwitchWarning).toContain("API");
            expect(copy.subscriptionTestHint).toContain("{client}");
        }
    });

    it("labels connection details as configuration without claiming a successful connection", () => {
        expect(getAiCopy("en-US").aiConnection).toBe("AI connection");
        expect(getAiCopy("cs-CZ").aiConnection).toBe("Připojení AI");
        expect(getAiCopy("en-US").configuredProvider).toBe("Configured provider");
        expect(getAiCopy("cs-CZ").configuredProvider).toBe("Nastavený poskytovatel");

        for (const language of ["en-US", "cs-CZ"]) {
            expect(getAiCopy(language).connectionUnverified).toContain("Test");
            expect(getAiCopy(language).aiConnection).not.toMatch(/connected|připojeno/i);
        }
    });

    it("uses English for missing and unsupported application locales", () => {
        expect(getAiCopy(undefined)).toBe(getAiCopy("en-US"));
        expect(getAiCopy("fr-FR")).toBe(getAiCopy("en-US"));
        expect(getAiCopy("cs-CZ")).not.toBe(getAiCopy("en-US"));
    });

    it("localizes generated section labels without translating user-authored facts", () => {
        const original = "Keep the date 4. 10. and price 700 Kč.";
        const fields = { goal: "Opravit", context: "", constraints: "", output: "" };
        const english = buildStructuredPrompt(original, fields, getAiCopy("en-US"));
        const czech = buildStructuredPrompt(original, fields, getAiCopy("cs-CZ"));
        expect(english).toBe(`${original}\n\nGoal:\nOpravit`);
        expect(czech).toBe(`${original}\n\nCíl:\nOpravit`);
        expect(fields.goal).toBe("Opravit");
    });
});
