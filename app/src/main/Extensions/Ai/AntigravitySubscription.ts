import type { SubscriptionStatus } from "@common/Extensions/Ai/SubscriptionStatus";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { subscriptionInput } from "./CodexSubscription";

const FAILURE = "Antigravity could not complete the request. Check your official Antigravity login and try again.";
const ISOLATION_FAILURE = "Antigravity did not confirm a text-only session. No conversation text was sent.";
let verified = false;
let lastFailure: string | undefined;

export const findAntigravityExecutable = (): string | undefined => {
    const executable =
        process.platform === "win32"
            ? join(process.env.LOCALAPPDATA ?? "", "agy", "bin", "agy.exe")
            : join(homedir(), ".local", "bin", "agy");
    return isAbsolute(executable) && existsSync(executable) && statSync(executable).isFile() ? executable : undefined;
};

export const antigravityEnvironment = (source = process.env): NodeJS.ProcessEnv => ({
    ...Object.fromEntries(
        Object.entries(source).filter(([key]) =>
            /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL)$/i.test(
                key,
            ),
        ),
    ),
    AGY_CLI_DISABLE_AUTO_UPDATE: "1",
});

// Official changelog documents both flags; tools:[] alone does not remove default components.
// https://www.antigravity.google/docs/changelog
export const antigravityAgent = (name: string): string => `---
name: ${name}
description: Private text response session
mainAgent: true
subagent: false
inheritCustomizations: false
excludeDefaultComponents: true
tools: []
mcpServers: []
skills: []
plugins: []
commandExecutionPolicy: off
---
# System Prompt
Respond only to the conversation supplied in the next message. Do not use tools.
`;

/** The remaining global CLI hook source is checked, never edited. Auth files are not read. */
const assertNoGlobalHooks = () => {
    const root = join(homedir(), ".gemini");

    if (existsSync(join(root, "config", "hooks.json"))) {
        throw new Error("Antigravity has global hooks configured. Text-only isolation needs a separate CLI profile.");
    }

    const settingsPath = join(root, "antigravity-cli", "settings.json");

    if (existsSync(settingsPath)) {
        if (statSync(settingsPath).size > 1048576) {
            throw new Error(ISOLATION_FAILURE);
        }

        const settings = JSON.parse(readFileSync(settingsPath, "utf8"));

        if (settings.hooks && Object.keys(settings.hooks).length) {
            throw new Error(
                "Antigravity has global hooks configured. Text-only isolation needs a separate CLI profile.",
            );
        }
    }
};

export class AntigravityTextOutput {
    public initialized = false;
    public result: string | undefined;
    public consume(value: Record<string, unknown>): boolean {
        if (value.event === "init") {
            const init = value.init as { tools?: unknown } | undefined;

            if (this.initialized || !Array.isArray(init?.tools) || init.tools.length !== 0) {
                throw new Error(ISOLATION_FAILURE);
            }

            this.initialized = true;
            return true;
        }

        if (!this.initialized) {
            throw new Error(ISOLATION_FAILURE);
        }

        if (value.event === "step_update") {
            const step = value.step_update as
                | { tool_info?: unknown; subagent_info?: unknown; step_type?: string }
                | undefined;

            if (step?.tool_info || step?.subagent_info || step?.step_type === "tool_call") {
                throw new Error("Antigravity attempted a tool call in a text-only session.");
            }
        }

        if (value.event === "result") {
            const result = value.result as { status?: string; response?: unknown } | undefined;

            if (
                result?.status !== "SUCCESS" ||
                typeof result.response !== "string" ||
                !result.response.trim() ||
                result.response.length > 262144
            ) {
                throw new Error(FAILURE);
            }

            this.result = result.response;
        }

        return false;
    }
}

const terminate = async (child: ChildProcessWithoutNullStreams) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
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

export const getAntigravitySubscriptionStatus = async (): Promise<SubscriptionStatus> => ({
    installed: !!findAntigravityExecutable(),
    authenticated: verified,
    models: [{ id: "default", name: "Antigravity default" }],
    ...(!verified
        ? { error: lastFailure ?? "Test the official Antigravity connection to verify account access." }
        : {}),
});

export const antigravitySubscriptionCompletion = async (
    model: string,
    systemPrompt: string,
    messages: Array<{ role: string; content: string }>,
    signal: AbortSignal,
    emit: (delta: string) => void,
): Promise<string> => {
    const executable = findAntigravityExecutable();

    if (!executable) {
        throw new Error("Install the official Antigravity CLI and sign in with your Google account.");
    }

    if (model !== "default" || signal.aborted) {
        throw new Error("Antigravity request cancelled or model unavailable.");
    }

    assertNoGlobalHooks();
    const input =
        JSON.stringify({ event: "user", message: { content: `${systemPrompt}\n\n${subscriptionInput(messages)}` } }) +
        "\n";

    if (Buffer.byteLength(input) > 524288) {
        throw new Error("This conversation is too long for this connection.");
    }

    const cwd = await mkdtemp(join(tmpdir(), "meowcast-agy-"));
    const name = `meowcast-text-${randomUUID()}`;
    let child: ChildProcessWithoutNullStreams | undefined;

    try {
        const privateRoot = join(cwd, "private-customizations");
        await Promise.all([
            mkdir(join(cwd, ".gemini")),
            mkdir(join(cwd, ".agents", "agents"), { recursive: true }),
            mkdir(join(privateRoot, "agents"), { recursive: true }),
        ]);
        await Promise.all([
            writeFile(
                join(cwd, ".gemini", "config.json"),
                JSON.stringify({ personal_customization_dir: privateRoot }),
                { mode: 0o600 },
            ),
            writeFile(join(cwd, ".agents", "agents", `${name}.md`), antigravityAgent(name), { mode: 0o600 }),
            writeFile(join(privateRoot, "agents", `${name}.md`), antigravityAgent(name), { mode: 0o600 }),
        ]);

        if (signal.aborted) {
            throw new Error("Antigravity request cancelled.");
        }

        child = spawn(
            executable,
            [
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--agent",
                name,
                "--mode",
                "plan",
                "--disable-slash-commands",
                "--print-timeout",
                "90s",
                "--log-file",
                join(cwd, "cli.log"),
            ],
            {
                cwd,
                env: antigravityEnvironment(),
                shell: false,
                windowsHide: true,
                detached: process.platform !== "win32",
                stdio: "pipe",
            },
        );
        const running = child;
        const result = await new Promise<string>((resolve, reject) => {
            const parser = new AntigravityTextOutput();
            let buffer = "";
            let size = 0;
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timer);
                clearTimeout(handshake);
                signal.removeEventListener("abort", abort);

                if (error) {
                    reject(error);
                } else if (parser.result) {
                    resolve(parser.result);
                } else {
                    reject(new Error(FAILURE));
                }
            };
            const abort = () => finish(new Error("Antigravity request cancelled."));
            const timer = setTimeout(() => finish(new Error("Antigravity request timed out.")), 90000);
            const handshake = setTimeout(() => finish(new Error(ISOLATION_FAILURE)), 20000);
            signal.addEventListener("abort", abort, { once: true });

            if (signal.aborted) {
                abort();
                return;
            }

            running.stderr.resume();
            running.stdout.setEncoding("utf8");
            running.stdout.on("data", (chunk: string) => {
                if (settled) {
                    return;
                }

                size += Buffer.byteLength(chunk);

                if (size > 2097152) {
                    finish(new Error(FAILURE));
                    return;
                }

                buffer += chunk;
                let end: number;

                while ((end = buffer.indexOf("\n")) >= 0) {
                    if (settled || signal.aborted) {
                        return;
                    }

                    const line = buffer.slice(0, end).trim();
                    buffer = buffer.slice(end + 1);

                    if (!line) {
                        continue;
                    }

                    try {
                        if (parser.consume(JSON.parse(line))) {
                            clearTimeout(handshake);
                            // Never send private conversation content until the runtime proves zero tools.
                            running.stdin.write(input);
                        }

                        if (parser.result) {
                            running.stdin.end();
                            finish();
                        }
                    } catch (error) {
                        finish(error instanceof Error && !(error instanceof SyntaxError) ? error : new Error(FAILURE));
                        return;
                    }
                }
            });
            running.once("error", () => finish(new Error(FAILURE)));
            running.once("close", () => finish());
            running.stdin.on("error", () => finish(new Error(FAILURE)));
        });
        verified = true;
        lastFailure = undefined;
        emit(result);
        return result;
    } catch (error) {
        verified = false;
        lastFailure = error instanceof Error ? error.message : FAILURE;
        throw error;
    } finally {
        if (child) {
            await terminate(child);
        }

        await rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
};
