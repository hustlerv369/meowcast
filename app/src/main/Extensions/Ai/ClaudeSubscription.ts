import type { SubscriptionStatus } from "@common/Extensions/Ai/SubscriptionStatus";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { subscriptionEnvironment, subscriptionInput } from "./CodexSubscription";

const FAILURE = "Claude Code rejected the request. Update the official Claude Code CLI and check your subscription.";
const ORGANIZATION_BLOCKED =
    "Your organization has disabled Claude Code subscription access. Ask your administrator to enable it.";
export const safeClaudeError = (error: unknown): Error =>
    new Error(error instanceof Error && error.message === ORGANIZATION_BLOCKED ? ORGANIZATION_BLOCKED : FAILURE);
export const claudeEnvironment = (env = process.env): NodeJS.ProcessEnv =>
    Object.fromEntries(
        Object.entries(subscriptionEnvironment(env)).filter(
            ([key]) =>
                !key.toUpperCase().startsWith("ANTHROPIC_") &&
                !key.toUpperCase().startsWith("CLAUDE_") &&
                ![
                    "CLAUDECODE",
                    "AWS_PROFILE",
                    "AWS_ACCESS_KEY_ID",
                    "AWS_SECRET_ACCESS_KEY",
                    "GOOGLE_APPLICATION_CREDENTIALS",
                ].includes(key.toUpperCase()),
        ),
    );
export const findClaudeExecutable = (): string | undefined => {
    const name = process.platform === "win32" ? "claude.exe" : "claude";
    const candidates = [
        join(homedir(), ".local", "bin", name),
        ...(process.env.PATH ?? "")
            .split(delimiter)
            .filter(isAbsolute)
            .map((dir) => join(dir, name)),
    ];

    for (const candidate of candidates) {
        try {
            if (existsSync(candidate) && statSync(candidate).isFile()) {
                return realpathSync(candidate);
            }
        } catch {
            /* Search next candidate. */
        }
    }

    return undefined;
};

export const claudeAuthenticated = (status: unknown): boolean => {
    const value = status as {
        loggedIn?: boolean;
        apiProvider?: string;
        authMethod?: string;
        subscriptionType?: string;
    } | null;
    return (
        !!value &&
        value.loggedIn === true &&
        value.apiProvider === "firstParty" &&
        ["claude.ai", "oauth", "oauth_token"].includes(value.authMethod ?? "") &&
        typeof value.subscriptionType === "string" &&
        !!value.subscriptionType
    );
};

export const claudeTextArguments = (): string[] => [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--no-session-persistence",
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--disable-slash-commands",
    "--setting-sources",
    "",
    "--settings",
    JSON.stringify({
        disableAllHooks: true,
        enabledPlugins: {},
        apiKeyHelper: "",
        claudeMdExcludes: ["**"],
        autoMemoryEnabled: false,
        forceLoginMethod: "claudeai",
    }),
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
];

/** Bounded CLI stream. Only text content may leave this parser. */
export class ClaudeTextOutput {
    public result: string | undefined;
    private output = "";
    public consume(event: Record<string, unknown>): string | undefined {
        if (event.type === "stream_event") {
            const stream = event.event as {
                type?: string;
                content_block?: { type?: string };
                delta?: { type?: string; text?: string };
            };

            if (stream?.type === "content_block_start" && stream.content_block?.type === "tool_use") {
                throw new Error("Claude requested a tool. This connection supports text only.");
            }

            if (stream?.delta?.type === "text_delta" && typeof stream.delta.text === "string") {
                this.output += stream.delta.text;

                if (this.output.length > 262144) {
                    throw new Error(FAILURE);
                }

                return stream.delta.text;
            }
        }

        if (event.type === "assistant") {
            const message = event.message as { content?: Array<{ type?: string }> };

            if (message?.content?.some((item) => item.type === "tool_use")) {
                throw new Error("Claude requested a tool. This connection supports text only.");
            }
        }

        if (event.type === "result") {
            if (
                event.is_error === true &&
                typeof event.result === "string" &&
                event.result.includes("Your organization has disabled Claude subscription access for Claude Code")
            ) {
                throw new Error(ORGANIZATION_BLOCKED);
            }

            if (
                event.subtype !== "success" ||
                event.is_error === true ||
                typeof event.result !== "string" ||
                !event.result.trim() ||
                event.result.length > 262144
            ) {
                throw new Error(FAILURE);
            }

            this.result = event.result;
        }

        return undefined;
    }
}

const terminate = async (child: ChildProcessWithoutNullStreams) => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
        return;
    }

    if (process.platform !== "win32") {
        try {
            process.kill(-child.pid, "SIGKILL");
        } catch {
            child.kill();
        }

        return;
    }

    await new Promise<void>((resolve) => {
        const killer = spawn(
            join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
            ["/PID", String(child.pid), "/T", "/F"],
            { shell: false, windowsHide: true, stdio: "ignore" },
        );
        const timer = setTimeout(() => {
            child.kill();
            killer.kill();
            resolve();
        }, 3000);
        const done = () => {
            clearTimeout(timer);
            resolve();
        };
        killer.once("exit", done);
        killer.once("error", done);
    });
};

const runClaude = async (
    args: string[],
    input: string,
    signal: AbortSignal,
    onLine?: (line: string) => void,
    timeout = 90000,
): Promise<string> => {
    const executable = findClaudeExecutable();

    if (!executable) {
        throw new Error("Install Claude Code and sign in with your Claude subscription.");
    }

    const cwd = await mkdtemp(join(tmpdir(), "meowcast-claude-"));
    const child = spawn(executable, args, {
        cwd,
        env: claudeEnvironment(),
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: "pipe",
    });

    try {
        return await new Promise<string>((resolve, reject) => {
            let buffer = "";
            let output = "";
            let stopped = false;
            const abort = () => {
                cleanup();
                reject(new Error("Claude request cancelled."));
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error("Claude request timed out."));
            }, timeout);
            const cleanup = () => {
                stopped = true;
                clearTimeout(timer);
                signal.removeEventListener("abort", abort);
            };
            signal.addEventListener("abort", abort, { once: true });
            child.stdout.setEncoding("utf8");
            child.stderr.resume();
            child.stdout.on("data", (data: string) => {
                if (stopped) {
                    return;
                }

                buffer += data;
                output += data;

                if (Buffer.byteLength(buffer) > 1048576 || Buffer.byteLength(output) > 4194304) {
                    cleanup();
                    reject(new Error(FAILURE));
                    return;
                }

                let pos: number;

                while ((pos = buffer.indexOf("\n")) >= 0) {
                    const line = buffer.slice(0, pos);
                    buffer = buffer.slice(pos + 1);

                    if (line.trim() && onLine) {
                        try {
                            onLine(line);
                        } catch (error) {
                            cleanup();
                            reject(safeClaudeError(error));
                            return;
                        }
                    }
                }
            });
            const fail = () => {
                cleanup();
                reject(new Error(FAILURE));
            };
            child.once("error", fail);
            child.stdin.once("error", fail);
            child.once("close", (code) => {
                cleanup();

                if (code !== 0 || signal.aborted) {
                    reject(new Error(FAILURE));
                    return;
                }

                try {
                    if (buffer.trim() && onLine) {
                        onLine(buffer);
                    }

                    resolve(output);
                } catch (error) {
                    reject(safeClaudeError(error));
                }
            });

            if (signal.aborted) {
                abort();
            } else {
                child.stdin.end(input);
            }
        });
    } finally {
        await terminate(child);
        await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
};

export const getClaudeSubscriptionStatus = async (
    signal = new AbortController().signal,
): Promise<SubscriptionStatus> => {
    const installed = !!findClaudeExecutable();

    if (!installed) {
        return {
            installed,
            authenticated: false,
            models: [],
            error: "Install Claude Code and sign in with your Claude subscription.",
        };
    }

    try {
        const output = await runClaude(["auth", "status"], "", signal, undefined, 10000);
        const authenticated = claudeAuthenticated(JSON.parse(output));
        return {
            installed: true,
            authenticated,
            models: authenticated ? [{ id: "default", name: "Claude Code default" }] : [],
            ...(authenticated ? {} : { error: "Sign in with claude auth login --claudeai, then check again." }),
        };
    } catch {
        return { installed: true, authenticated: false, models: [], error: FAILURE };
    }
};

export const claudeSubscriptionCompletion = async (
    model: string,
    systemPrompt: string,
    messages: Array<{ role: string; content: string }>,
    signal: AbortSignal,
    emit: (delta: string) => void,
): Promise<string> => {
    if (model !== "default") {
        throw new Error("Choose Claude Code default in AI settings.");
    }

    const status = await getClaudeSubscriptionStatus(signal);

    if (!status.authenticated) {
        throw new Error(status.error);
    }

    const parser = new ClaudeTextOutput();
    // Prompt content is stdin, not process arguments. No model fallback is supplied.
    await runClaude(
        claudeTextArguments(),
        JSON.stringify({ instructions: systemPrompt, prompt: subscriptionInput(messages) }),
        signal,
        (line) => {
            const delta = parser.consume(JSON.parse(line));

            if (delta) {
                emit(delta);
            }
        },
    );

    if (!parser.result) {
        throw new Error(FAILURE);
    }

    return parser.result;
};
