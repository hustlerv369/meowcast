import type { Net } from "electron";
import { describe, expect, it, vi } from "vitest";
import { streamCompletion } from "./streamCompletion";
const options = {
    apiKey: "secret-key",
    baseUrl: "https://example.test/v1",
    model: "test",
    systemPrompt: "",
    messages: [{ role: "user" as const, content: "private question" }],
};
const response = (chunks: string[]) =>
    new Response(
        new ReadableStream({
            start(c) {
                chunks.forEach((s) => c.enqueue(new TextEncoder().encode(s)));
                c.close();
            },
        }),
    );
describe("streamCompletion", () => {
    it("decodes chunk boundaries and only emits content", async () => {
        const emit = vi.fn();
        const fetcher = vi
            .fn()
            .mockResolvedValue(
                response([
                    'data: {"choices":[{"delta":{"content":"A"}}]}\n',
                    '\ndata: {"choices":[{"delta":{"content":"B"}}]}\n\ndata: [DONE]\n\n',
                ]),
            );
        expect(await streamCompletion(fetcher, options, new AbortController(), emit)).toBe("AB");
        expect(emit.mock.calls).toEqual([["A"], ["B"]]);
        expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    });
    it("redacts provider error body", async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response("secret-key private question", { status: 401 }));
        await expect(streamCompletion(fetcher, options, new AbortController(), vi.fn())).rejects.toThrow("HTTP 401");
    });
    it("rejects cleartext and credential URLs before sending", async () => {
        const fetcher = vi.fn();

        for (const baseUrl of ["http://example.test", "https://user:pass@example.test"]) {
            await expect(
                streamCompletion(fetcher, { ...options, baseUrl }, new AbortController(), vi.fn()),
            ).rejects.toThrow("HTTPS");
        }

        expect(fetcher).not.toHaveBeenCalled();
    });
    it("rejects truncated streams", async () => {
        await expect(
            streamCompletion(
                vi.fn().mockResolvedValue(response(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])),
                options,
                new AbortController(),
                vi.fn(),
            ),
        ).rejects.toThrow("before the response was complete");
    });
    it("times out and sanitizes network errors", async () => {
        const fetcher = ((_url: unknown, init: RequestInit) =>
            new Promise((_r, reject) =>
                init.signal!.addEventListener("abort", () => reject(new Error("secret-key"))),
            )) as Net["fetch"];
        await expect(streamCompletion(fetcher, options, new AbortController(), vi.fn(), 5)).rejects.toThrow(
            "timed out",
        );
    });
    it("stops an active request", async () => {
        const controller = new AbortController();
        const fetcher = ((_url: unknown, init: RequestInit) =>
            new Promise((_r, reject) => {
                init.signal!.addEventListener("abort", () => reject(new Error("private")));
                queueMicrotask(() => controller.abort());
            })) as Net["fetch"];
        await expect(streamCompletion(fetcher, options, controller, vi.fn())).rejects.toThrow("stopped");
    });
});
