import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
    antigravityAgent,
    antigravityEnvironment,
    antigravitySubscriptionCompletion,
    AntigravityTextOutput,
} from "./AntigravitySubscription";

const mocked = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocked.spawn }));
vi.mock("node:fs", () => ({
    existsSync: (path: string) => /agy(?:\.exe)?$/i.test(path),
    statSync: () => ({ isFile: () => true }),
    readFileSync: () => "{}",
}));

describe("Antigravity text-only boundary", () => {
    it("sends no input when native init exposes 60 tools, even if another init follows in the same chunk", async () => {
        const child = Object.assign(new EventEmitter(), {
            stdin: new PassThrough(),
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            pid: undefined,
            exitCode: 0,
            signalCode: null,
        });
        const inputs: unknown[] = [];
        child.stdin.on("data", (data) => inputs.push(data));
        mocked.spawn.mockImplementationOnce(() => {
            queueMicrotask(() =>
                child.stdout.write(
                    JSON.stringify({ event: "init", init: { tools: Array(60).fill("tool") } }) +
                        "\n" +
                        JSON.stringify({ event: "init", init: { tools: [] } }) +
                        "\n",
                ),
            );
            return child;
        });
        await expect(
            antigravitySubscriptionCompletion(
                "default",
                "Private system text",
                [{ role: "user", content: "Private conversation" }],
                new AbortController().signal,
                vi.fn(),
            ),
        ).rejects.toThrow("did not confirm a text-only session");
        expect(inputs).toEqual([]);
    });
    it("excludes ambient customizations and default tools rather than only asking for plan mode", () => {
        const agent = antigravityAgent("fixture");
        expect(agent).toContain("inheritCustomizations: false");
        expect(agent).toContain("excludeDefaultComponents: true");
        expect(agent).toContain("tools: []");
        expect(agent).toContain("mcpServers: []");
        expect(agent).toContain("plugins: []");
    });
    it("cannot inherit API keys, endpoints or ADC fallback", () => {
        const env = antigravityEnvironment({
            PATH: "native",
            GEMINI_API_KEY: "secret",
            AGY_ADC_AUTH: "true",
            GEMINI_BASE_URL: "other",
            GOOGLE_APPLICATION_CREDENTIALS: "secret",
            ANTIGRAVITY_CSRF_TOKEN: "secret",
        });
        expect(env).toEqual({ PATH: "native", AGY_CLI_DISABLE_AUTO_UPDATE: "1" });
    });
    it("allows user input only after an explicit empty tool list", () => {
        expect(new AntigravityTextOutput().consume({ event: "init", init: { tools: [] } })).toBe(true);

        for (const init of [{}, { tools: ["view_file"] }, { tools: ["mcp_server"] }, { tools: "" }]) {
            expect(() => new AntigravityTextOutput().consume({ event: "init", init })).toThrow();
        }
    });
    it("rejects out-of-order output and any tool/subagent events", () => {
        expect(() => new AntigravityTextOutput().consume({ event: "result" })).toThrow();

        for (const step_update of [{ tool_info: {} }, { subagent_info: {} }, { step_type: "tool_call" }]) {
            const parser = new AntigravityTextOutput();
            parser.consume({ event: "init", init: { tools: [] } });
            expect(() => parser.consume({ event: "step_update", step_update })).toThrow();
        }
    });
    it("requires an explicit successful bounded final response", () => {
        const parser = new AntigravityTextOutput();
        parser.consume({ event: "init", init: { tools: [] } });
        expect(() => parser.consume({ event: "result", result: { status: "ERROR", response: "partial" } })).toThrow();
        parser.consume({ event: "result", result: { status: "SUCCESS", response: "Text" } });
        expect(parser.result).toBe("Text");
    });
});
