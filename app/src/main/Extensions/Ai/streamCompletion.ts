/* eslint-disable preserve-caught-error -- Caught provider errors may contain credentials or user text. */
import type { Net } from "electron";
import { OFFLINE_MESSAGE } from "../../Core/NetworkPrivacy/NetworkPrivacy";

type Options = {
    apiKey: string;
    baseUrl: string;
    model: string;
    systemPrompt: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    protocol?: "openai" | "anthropic";
};
/** A fixed deadline and bounded event buffer apply to the entire stream, not just headers. */
export const streamCompletion = async (
    fetcher: Net["fetch"],
    options: Options,
    controller: AbortController,
    emit: (delta: string) => void,
    timeoutMs = 90000,
): Promise<string> => {
    if (!options.apiKey) {
        throw new Error("API key not configured or secure storage unavailable.");
    }

    let endpoint: URL;

    try {
        endpoint = new URL(
            `${options.baseUrl.replace(/\/$/, "")}/${options.protocol === "anthropic" ? "messages" : "chat/completions"}`,
        );
    } catch {
        throw new Error("Configure a valid HTTPS API base URL.");
    }

    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new Error("API endpoint must use HTTPS without credentials, query or fragment.");
    }

    if (!options.model.trim()) {
        throw new Error("Select a model first.");
    }

    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
        const response = await fetcher(endpoint.toString(), {
            method: "POST",
            redirect: "error",
            signal: controller.signal,
            headers:
                options.protocol === "anthropic"
                    ? {
                          "x-api-key": options.apiKey,
                          "anthropic-version": "2023-06-01",
                          "Content-Type": "application/json",
                      }
                    : { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: options.model,
                stream: true,
                ...(options.protocol === "anthropic"
                    ? { max_tokens: 4096, system: options.systemPrompt, messages: options.messages }
                    : { messages: [{ role: "system", content: options.systemPrompt }, ...options.messages] }),
            }),
        });

        if (!response.ok) {
            throw new Error(
                `Provider returned HTTP ${response.status}. Check your connection settings and account limits.`,
            );
        }

        if (!response.body) {
            throw new Error("Provider returned no stream.");
        }

        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "",
            answer = "",
            done = false;

        while (!done) {
            const chunk = await reader.read();

            if (chunk.done) {
                break;
            }

            buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r/g, "");

            if (buffer.length > 1000000) {
                throw new Error("Provider stream exceeded the safety limit.");
            }

            let boundary: number;

            while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                const event = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const data = event
                    .split("\n")
                    .filter((line) => line.startsWith("data:"))
                    .map((line) => line.slice(5).trimStart())
                    .join("\n");

                if (!data) {
                    continue;
                }

                if (data.trim() === "[DONE]") {
                    done = true;
                    break;
                }

                let parsed: {
                    type?: string;
                    delta?: { type?: string; text?: unknown };
                    choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string | null }>;
                    error?: unknown;
                };

                try {
                    parsed = JSON.parse(data);
                } catch {
                    throw new Error("Provider returned an invalid stream.");
                }

                if (parsed.error) {
                    throw new Error("Provider rejected the request. Check your account and model.");
                }

                if (options.protocol === "anthropic" && parsed.type === "message_stop") {
                    done = true;
                    break;
                }

                const delta =
                    options.protocol === "anthropic"
                        ? parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta"
                            ? parsed.delta.text
                            : undefined
                        : parsed.choices?.[0]?.delta?.content;

                if (typeof delta === "string") {
                    answer += delta;

                    if (answer.length > 1000000) {
                        throw new Error("Response exceeded the safety limit.");
                    }

                    emit(delta);
                }
            }
        }

        if (controller.signal.aborted) {
            throw new Error("Request stopped.");
        }

        if (!done) {
            throw new Error("Connection ended before the response was complete.");
        }

        return answer;
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(timedOut ? "Request timed out. Try again." : "Request stopped.");
        }

        // Never surface provider response bodies, URLs, network errors, or request data.
        const message = error instanceof Error ? error.message : "";

        if (
            message === OFFLINE_MESSAGE ||
            /^(Provider (returned|stream|rejected)|Response exceeded|Connection ended)/.test(message)
        ) {
            throw new Error(message);
        }

        throw new Error("Could not reach the provider. Check your connection settings.");
    } finally {
        clearTimeout(timer);
        await reader?.cancel().catch(() => undefined);
    }
};
