import { EventEmitter } from "node:events";
import type * as NodeFs from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
    geminiEnvironment,
    geminiFailureMessage,
    geminiSettings,
    geminiSubscriptionCompletion,
    geminiTextArguments,
    getGeminiSubscriptionStatus,
    parseGeminiResponse,
} from "./GeminiSubscription";

const mocked = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocked.spawn }));
vi.mock("node:fs", async (original) => ({
    ...(await original<typeof NodeFs>()),
    existsSync: () => true,
    statSync: () => ({ isFile: () => true }),
    realpathSync: (path: string) => path,
    readFileSync: () => JSON.stringify({ name: "@google/gemini-cli", version: "0.53.1" }),
}));

describe("Gemini subscription isolation", () => {
    it("reports the confirmed retired-client block without leaking raw diagnostics", () => {
        const message = geminiFailureMessage(
            "Error authenticating: IneligibleTierError: private@example.com C:\\private\\oauth.json",
        );
        expect(message).toContain("no longer supports");
        expect(message).toContain("individual accounts");
        expect(message).not.toContain("private");
        expect(geminiFailureMessage("invalid_grant private@example.com")).toContain("login needs attention");
        expect(geminiFailureMessage("RESOURCE_EXHAUSTED private@example.com")).toContain("usage limit");
        expect(geminiFailureMessage("private@example.com")).not.toContain("private");
    });
    it("keeps only OS environment and owns auth, system settings and launcher switches", () => {
        const env = geminiEnvironment("private", {
            PATH: "node",
            SystemRoot: "windows",
            GEMINI_API_KEY: "secret",
            GOOGLE_API_KEY: "secret",
            GOOGLE_GENAI_USE_VERTEXAI: "true",
            GEMINI_CLI_HOME: "foreign",
            CODE_ASSIST_ENDPOINT: "foreign",
            NODE_OPTIONS: "--require foreign",
            HTTPS_PROXY: "foreign",
            CLOUD_SHELL: "true",
        });
        expect(env.PATH).toBe("node");
        expect(env.GEMINI_API_KEY).toBe("");
        expect(env.GOOGLE_API_KEY).toBe("");
        expect(env.GOOGLE_GENAI_USE_VERTEXAI).toBe("");
        expect(env.NODE_OPTIONS).toBe("");
        expect(env.CODE_ASSIST_ENDPOINT).toBeUndefined();
        expect(env.HTTPS_PROXY).toBeUndefined();
        expect(env.CLOUD_SHELL).toBeUndefined();
        expect(env.GEMINI_CLI_HOME).not.toBe("foreign");
        expect(env.GEMINI_CLI_NO_RELAUNCH).toBe("1");
        expect(env.NO_BROWSER).toBe("1");
    });
    it("forces Google OAuth and removes hooks, skills, builtins and discovered commands", () => {
        const settings = geminiSettings("private-sentinel");
        expect(settings.security.auth).toEqual({
            selectedType: "oauth-personal",
            enforcedType: "oauth-personal",
            useExternal: false,
        });
        expect(settings.hooksConfig.enabled).toBe(false);
        expect(settings.skills.enabled).toBe(false);
        expect(settings.tools).toEqual({ core: [], discoveryCommand: "", callCommand: "", sandbox: false });
        expect(settings.mcp).toEqual({ serverCommand: "", allowed: ["private-sentinel"] });
        expect(settings.context.includeDirectories).toEqual([]);
        expect(settings.experimental.enableAgents).toBe(false);
    });
    it("uses a nonempty random-name allowlist and explicit no extensions, not unrestricted empty MCP list", () => {
        const args = geminiTextArguments("official.js", "private", "unconfigured-id");
        expect(args[0]).toBe("official.js");
        expect(args[args.indexOf("--extensions") + 1]).toBe("none");
        expect(args[args.indexOf("--allowed-mcp-server-names") + 1]).toBe("unconfigured-id");
        expect(args).not.toContain("--yolo");
        expect(args).not.toContain("--model");
    });
    it("accepts only bounded successful text, never error payloads or empty output", () => {
        expect(parseGeminiResponse(JSON.stringify({ response: "Hello" }))).toBe("Hello");

        for (const value of [
            { response: "" },
            { response: "partial", error: { message: "sensitive" } },
            {},
            { response: "a".repeat(262145) },
        ]) {
            expect(() => parseGeminiResponse(JSON.stringify(value))).toThrow();
        }

        expect(() => parseGeminiResponse("malformed")).toThrow();
    });
    it("runs only a shell-free isolated process, verifies response and removes its private files", async () => {
        const child = Object.assign(new EventEmitter(), {
            stdin: new PassThrough(),
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            exitCode: 0,
            signalCode: null,
            pid: undefined,
        });
        let cwd = "";
        let filesChecked: Promise<void> | undefined;
        mocked.spawn.mockImplementationOnce((_node, _args, options) => {
            cwd = options.cwd;
            expect(options.shell).toBe(false);
            expect(options.windowsHide).toBe(true);
            filesChecked = Promise.all([
                readFile(join(cwd, ".env"), "utf8"),
                readFile(join(cwd, "settings.json"), "utf8"),
            ]).then(([env, settings]) => {
                expect(env).toBe("");
                expect(JSON.parse(settings).hooksConfig.enabled).toBe(false);
            });
            child.stdin.on("finish", () => {
                child.stdout.write(JSON.stringify({ response: "Verified text" }));
                child.emit("close", 0);
            });
            return child;
        });
        const emit = vi.fn();
        expect(
            await geminiSubscriptionCompletion(
                "default",
                "Text only",
                [{ role: "user", content: "Hello" }],
                new AbortController().signal,
                emit,
            ),
        ).toBe("Verified text");
        await filesChecked;
        expect(emit).toHaveBeenCalledWith("Verified text");
        expect((await getGeminiSubscriptionStatus()).authenticated).toBe(true);
        await expect(stat(cwd)).rejects.toThrow();
    });
    it("does not invoke a process for cancelled requests or unsupported model overrides", async () => {
        mocked.spawn.mockClear();
        const controller = new AbortController();
        controller.abort();
        await expect(geminiSubscriptionCompletion("default", "", [], controller.signal, vi.fn())).rejects.toThrow();
        await expect(
            geminiSubscriptionCompletion("invented", "", [], new AbortController().signal, vi.fn()),
        ).rejects.toThrow();
        expect(mocked.spawn).not.toHaveBeenCalled();
    });
});
