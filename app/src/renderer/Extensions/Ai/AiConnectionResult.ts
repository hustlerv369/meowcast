/** A completed request only proves a usable response when it contains text. */
export const getAiConnectionResult = (
    answer: unknown,
    copy: { responseReceived: string; emptyResponse: string },
): { status: "ok" | "error"; message: string } =>
    typeof answer === "string" && answer.trim()
        ? { status: "ok", message: copy.responseReceived }
        : { status: "error", message: copy.emptyResponse };

/** Recognize fixed backend diagnostics, never display arbitrary provider bodies or IPC errors. */
export const safeAiFailure = (error: unknown, fallback: string): string => {
    const message = error instanceof Error ? error.message : "";

    if (message.includes("Your organization has disabled Claude Code subscription access")) {
        return "Your organization has disabled Claude Code subscription access. Ask your administrator to enable it.";
    }

    if (message.includes("Antigravity") && /no longer support/.test(message)) {
        return "Google no longer supports this Gemini CLI login. Use the Gemini API connection or a supported client; no API fallback was used.";
    }

    if (message.includes("Antigravity did not confirm a text-only session")) {
        return "Antigravity exposed tools in this session. The connection stopped before sending your conversation.";
    }

    if (message.includes("Antigravity has global hooks configured")) {
        return "Antigravity has global hooks configured. This text-only connection needs an isolated CLI profile.";
    }

    if (message.includes("Offline mode is enabled")) {
        return "Offline mode is enabled. Turn it off before sending an AI request.";
    }

    return fallback;
};
