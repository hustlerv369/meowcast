import { describe, expect, it } from "vitest";
import { getAiConnectionResult, safeAiFailure } from "./AiConnectionResult";
import { getAiCopy } from "./AiCopy";

describe("AI connection response", () => {
    it("shows the fixed Antigravity isolation failure without exposing diagnostic details", () => {
        expect(safeAiFailure(new Error("secret: Antigravity did not confirm a text-only session"), "Failed")).toBe(
            "Antigravity exposed tools in this session. The connection stopped before sending your conversation.",
        );
    });
    it("shows a fixed actionable policy error without exposing the raw provider message", () => {
        expect(
            safeAiFailure(
                new Error("secret: Your organization has disabled Claude Code subscription access"),
                "Failed",
            ),
        ).toBe("Your organization has disabled Claude Code subscription access. Ask your administrator to enable it.");
        expect(safeAiFailure(new Error("token=secret private body"), "Failed")).toBe("Failed");
    });
    it.each(["", "  \n\t\r", undefined, null, 42])("does not report success for unusable response %j", (answer) => {
        const copy = getAiCopy("en-US");
        expect(getAiConnectionResult(answer, copy)).toEqual({ status: "error", message: copy.emptyResponse });
    });

    it.each(["en-US", "cs-CZ"])("reports nonempty responses with localized status in %s", (language) => {
        const copy = getAiCopy(language);
        expect(getAiConnectionResult(" \nOK\n", copy)).toEqual({ status: "ok", message: copy.responseReceived });
        expect(getAiConnectionResult(" ", copy)).toEqual({ status: "error", message: copy.emptyResponse });
    });
});
