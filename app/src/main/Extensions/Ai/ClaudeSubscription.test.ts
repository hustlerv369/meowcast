import { describe, expect, it } from "vitest";
import {
    claudeAuthenticated,
    claudeEnvironment,
    claudeTextArguments,
    ClaudeTextOutput,
    safeClaudeError,
} from "./ClaudeSubscription";

describe("Claude subscription", () => {
    it("removes API, OAuth override and third-party routing environment", () => {
        expect(
            claudeEnvironment({
                PATH: "tools",
                ANTHROPIC_API_KEY: "secret",
                ANTHROPIC_BASE_URL: "other",
                CLAUDE_CODE_OAUTH_TOKEN: "secret",
                CLAUDE_CONFIG_DIR: "other",
                CLAUDECODE: "1",
                NODE_OPTIONS: "--require unsafe.js",
                NODE_PATH: "unsafe",
                CLAUDE_CODE_USE_VERTEX: "1",
                CODEX_THREAD_ID: "foreign",
            }),
        ).toEqual({ PATH: "tools" });
    });
    it("requires official first-party subscription OAuth proof", () => {
        const status = { loggedIn: true, apiProvider: "firstParty", authMethod: "claude.ai", subscriptionType: "max" };
        expect(claudeAuthenticated(status)).toBe(true);
        expect(claudeAuthenticated({ ...status, authMethod: "api_key" })).toBe(false);
        expect(claudeAuthenticated({ ...status, subscriptionType: "" })).toBe(false);
        expect(claudeAuthenticated({ ...status, apiProvider: "vertex" })).toBe(false);
        expect(claudeAuthenticated({ ...status, loggedIn: false })).toBe(false);
        expect(claudeAuthenticated(null)).toBe(false);
    });
    it("uses documented no-tools isolation without bare API mode or fallback model", () => {
        const args = claudeTextArguments();
        expect(args[args.indexOf("--tools") + 1]).toBe("");
        expect(args[args.indexOf("--setting-sources") + 1]).toBe("");
        expect(args).toContain("--strict-mcp-config");
        expect(args).toContain("--disable-slash-commands");
        expect(args).toContain("--no-session-persistence");
        expect(args).not.toContain("--bare");
        expect(args).not.toContain("--fallback-model");
        expect(JSON.parse(args[args.indexOf("--settings") + 1])).toMatchObject({
            disableAllHooks: true,
            autoMemoryEnabled: false,
            claudeMdExcludes: ["**"],
            forceLoginMethod: "claudeai",
        });
    });
    it("streams text and requires a successful final protocol result", () => {
        const output = new ClaudeTextOutput();
        expect(output.consume({ type: "stream_event", event: { delta: { type: "text_delta", text: "Hello" } } })).toBe(
            "Hello",
        );
        expect(output.result).toBeUndefined();
        output.consume({ type: "result", subtype: "success", is_error: false, result: "Hello" });
        expect(output.result).toBe("Hello");
    });
    it.each(["error_during_execution", "error_max_turns"])("does not accept terminal %s", (subtype) => {
        expect(() => new ClaudeTextOutput().consume({ type: "result", subtype, result: "partial" })).toThrow();
    });
    it("rejects empty result and tools before rendering them", () => {
        expect(() =>
            new ClaudeTextOutput().consume({
                type: "result",
                subtype: "success",
                is_error: true,
                result: "Provider rejection",
            }),
        ).toThrow("Claude Code rejected the request.");
        expect(() => new ClaudeTextOutput().consume({ type: "result", subtype: "success", result: " " })).toThrow();
        expect(() =>
            new ClaudeTextOutput().consume({
                type: "stream_event",
                event: { type: "content_block_start", content_block: { type: "tool_use" } },
            }),
        ).toThrow("text only");
        expect(() =>
            new ClaudeTextOutput().consume({ type: "assistant", message: { content: [{ type: "tool_use" }] } }),
        ).toThrow("text only");
    });
    it("bounds response text", () => {
        expect(() =>
            new ClaudeTextOutput().consume({
                type: "stream_event",
                event: { delta: { type: "text_delta", text: "x".repeat(262145) } },
            }),
        ).toThrow();
    });
    it("explains recognized organization restrictions without exposing provider text", () => {
        const fixed =
            "Your organization has disabled Claude Code subscription access. Ask your administrator to enable it.";
        expect(safeClaudeError(new Error(fixed)).message).toBe(fixed);
        expect(safeClaudeError(new Error("private@example.test")).message).not.toContain("private@example.test");
        expect(() =>
            new ClaudeTextOutput().consume({
                type: "result",
                subtype: "success",
                is_error: true,
                result: "Your organization has disabled Claude subscription access for Claude Code private@example.test",
            }),
        ).toThrow(
            "Your organization has disabled Claude Code subscription access. Ask your administrator to enable it.",
        );
    });
});
