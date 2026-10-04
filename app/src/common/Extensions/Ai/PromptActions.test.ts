import { describe, expect, it } from "vitest";
import { buildActionPrompt, buildStructuredPrompt, parsePromptActions } from "./PromptActions";

describe("offline prompt composer", () => {
    it("preserves original facts and only adds explicitly supplied fields", () => {
        const original = "Cena 700 Kč. Nezměň datum 4. 10.";
        expect(
            buildStructuredPrompt(original, { goal: "Opravit", context: "", constraints: "Bez slibů", output: "" }),
        ).toBe(`${original}\n\nGoal:\nOpravit\n\nConstraints:\nBez slibů`);
    });
    it("keeps source separate and does not require source for free prompts", () => {
        expect(buildActionPrompt("Explain", "example")).toContain("<source>\nexample\n</source>");
        expect(buildActionPrompt("Write a draft", "")).toBe("Write a draft");
    });
    it("rejects malformed saved actions and never interprets imported objects as code", () => {
        expect(
            parsePromptActions([{ id: "custom-1", name: "Draft", instruction: "Write" }, null, { id: "system" }]),
        ).toEqual([{ id: "custom-1", name: "Draft", instruction: "Write" }]);
    });
});
