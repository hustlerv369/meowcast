import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
    assertTextOnlyItem,
    CodexRpc,
    readSubscription,
    subscriptionEnvironment,
    subscriptionInput,
    textOnlyConfig,
} from "./CodexSubscription";

const fixture = (timeout = 1000) => {
    const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: 0,
        signalCode: null,
        pid: undefined,
    });
    const sent: Array<Record<string, unknown>> = [];
    child.stdin.on("data", (data) => sent.push(JSON.parse(data.toString())));
    const controller = new AbortController();
    const rpc = new CodexRpc(child as unknown as ChildProcessWithoutNullStreams, controller.signal, timeout);
    const reply = (value: unknown) => child.stdout.write(JSON.stringify(value) + "\n");
    return { child, sent, controller, rpc, reply };
};

describe("Codex subscription transport", () => {
    it("preserves historical role boundaries instead of upgrading assistant text to user instructions", () => {
        const messages = [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Previous answer" },
            { role: "user", content: "Continue" },
        ];
        expect(subscriptionInput(messages)).toContain(JSON.stringify(messages));
        expect(subscriptionInput([{ role: "user", content: "One prompt" }])).toBe("One prompt");
    });
    it.each(["commandExecution", "mcpToolCall", "fileChange", "webSearch", "unknown"])(
        "fails closed if disabled tool item %s appears",
        (type) => {
            expect(() => assertTextOnlyItem({ item: { type } })).toThrow("text only");
        },
    );
    it.each(["userMessage", "agentMessage", "reasoning"])("allows only text item %s", (type) => {
        expect(() => assertTextOnlyItem({ item: { type } })).not.toThrow();
    });
    it("removes API fallback and foreign thread context from child environment", () => {
        expect(
            subscriptionEnvironment({
                PATH: "tools",
                OPENAI_API_KEY: "hidden",
                CODEX_API_KEY: "hidden",
                OPENAI_BASE_URL: "hidden",
                CODEX_THREAD_ID: "foreign",
                CODEX_HOME: "auth-owner",
                NODE_OPTIONS: "--require unsafe.js",
                NODE_PATH: "unsafe",
            }),
        ).toEqual({ PATH: "tools", CODEX_HOME: "auth-owner" });
    });
    it("disables every configured MCP server including dotted names and tool features", () => {
        const config = textOnlyConfig({ config: { mcp_servers: { "a.b": { url: "hidden" }, other: {} } } });
        expect(config.mcp_servers).toEqual({ "a.b": { enabled: false }, other: { enabled: false } });
        expect(config.web_search).toBe("disabled");
        expect(config["features.hooks"]).toBe(false);
        expect(config["features.shell_tool"]).toBe(false);
        expect(JSON.stringify(config)).not.toContain("hidden");
    });
    it("rejects API-key authentication without consulting model catalog", async () => {
        const f = fixture();
        const result = readSubscription(f.rpc);
        f.reply({ id: f.sent[0].id, result: { account: { type: "apiKey" } } });
        expect(await result).toMatchObject({ installed: true, authenticated: false, models: [] });
        expect(f.sent).toHaveLength(1);
        await f.rpc.close();
    });
    it("returns only actual authenticated catalog models", async () => {
        const f = fixture();
        const result = readSubscription(f.rpc);
        f.reply({ id: f.sent[0].id, result: { account: { type: "chatgpt", email: "private" } } });
        await Promise.resolve();
        f.reply({ id: f.sent[1].id, result: { data: [{ model: "test-model", displayName: "Test model" }] } });
        expect(await result).toEqual({
            installed: true,
            authenticated: true,
            models: [{ id: "test-model", name: "Test model" }],
        });
        await f.rpc.close();
    });
    it("denies server approvals and fails closed", async () => {
        const f = fixture();
        const request = f.rpc.request("thread/start", {});
        f.reply({ id: "server-request", method: "item/commandExecution/requestApproval", params: {} });
        await expect(request).rejects.toThrow("supports text only");
        expect(f.sent[1]).toMatchObject({ id: "server-request", error: { code: -32601 } });
        await f.rpc.close();
    });
    it("reassembles split protocol messages and queues early notifications", async () => {
        const f = fixture();
        const request = f.rpc.request("test", {});
        f.child.stdout.write('{"id":1,"result":');
        f.child.stdout.write('{"ok":true}}\n');
        f.reply({ method: "turn/completed", params: { threadId: "own" } });
        expect(await request).toEqual({ ok: true });
        expect((await f.rpc.event()).method).toBe("turn/completed");
        await f.rpc.close();
    });
    it("cancels outstanding waits", async () => {
        const f = fixture();
        const request = f.rpc.request("pending", {});
        f.controller.abort();
        await expect(request).rejects.toThrow("cancelled");
        await f.rpc.close();
    });
    it("enforces deadline", async () => {
        const f = fixture(10);
        await expect(f.rpc.request("pending", {})).rejects.toThrow("timed out");
        await f.rpc.close();
    });
    it.each(["not-json\n", "x".repeat(1_048_577)])("bounds malformed output", async (data) => {
        const f = fixture();
        const request = f.rpc.request("pending", {});
        f.child.stdout.write(data);
        await expect(request).rejects.toThrow("could not complete");
        await f.rpc.close();
    });
    it("redacts raw RPC errors", async () => {
        const f = fixture();
        const request = f.rpc.request("pending", {});
        f.reply({ id: 1, error: { message: "private-key" } });
        await expect(request).rejects.toThrow("could not complete");
        await f.rpc.close();
    });
});
