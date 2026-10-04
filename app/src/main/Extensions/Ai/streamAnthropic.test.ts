import { describe, expect, it, vi } from "vitest";
import { streamAnthropic } from "./streamAnthropic";

const options = {
    apiKey: "fixture",
    baseUrl: "https://example.test/v1",
    model: "fixture",
    systemPrompt: "Be brief",
    messages: [{ role: "user" as const, content: "Hello" }],
};
describe("Anthropic Messages transport", () => {
    it("uses native headers and body, ignores thinking and streams only text", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValue(
                new Response(
                    'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"private"}}\n\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\ndata: {"type":"message_stop"}\n\n',
                ),
            );
        const emit = vi.fn();
        expect(await streamAnthropic(fetcher, options, new AbortController(), emit)).toBe("Hello");
        const [url, init] = fetcher.mock.calls[0];
        expect(url).toBe("https://example.test/v1/messages");
        expect(init.headers).toEqual({
            "x-api-key": "fixture",
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        });
        expect(JSON.parse(init.body)).toMatchObject({
            system: "Be brief",
            max_tokens: 4096,
            messages: options.messages,
        });
        expect(emit.mock.calls).toEqual([["Hello"]]);
    });
    it("rejects provider stream errors without leaking the error body", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValue(new Response('data: {"type":"error","error":{"message":"secret"}}\n\n'));
        await expect(streamAnthropic(fetcher, options, new AbortController(), vi.fn())).rejects.toThrow(
            "Provider rejected",
        );
    });
    it("requires a complete native stream", async () => {
        const fetcher = vi
            .fn()
            .mockResolvedValue(
                new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n'),
            );
        await expect(streamAnthropic(fetcher, options, new AbortController(), vi.fn())).rejects.toThrow(
            "before the response was complete",
        );
    });
});
