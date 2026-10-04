import type { SubscriptionStatus } from "@common/Extensions/Ai/SubscriptionStatus";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { subscriptionInput } from "./CodexSubscription";

const FAILURE = "Gemini could not complete the request. Check your Google subscription login and try again.";
// Isolation semantics were inspected in this installed release. Fail closed after CLI upgrades.
const AUDITED_VERSION = "0.53.1";
const MODELS = [{ id: "default", name: "Gemini CLI default" }];
let verified = false;
let lastFailure: string | undefined;

/** Match known failures without exposing CLI diagnostics, account details or paths. */
export const geminiFailureMessage = (diagnostic: string): string => {
    if (/IneligibleTierError|client is no longer supported for Gemini Code Assist for individuals/i.test(diagnostic)) {
        return "Google no longer supports this Gemini CLI connection for individual accounts. Use another connection; Antigravity requires a separate integration.";
    }

    if (/invalid_grant|reauthentication|login required|not authenticated|no credentials/i.test(diagnostic)) {
        return "Your Gemini CLI Google login needs attention. Sign in through the official CLI, then test again.";
    }

    if (/RESOURCE_EXHAUSTED|quota exceeded|rate limit/i.test(diagnostic)) {
        return "Your Gemini account reached its current usage limit. Try again later or choose another connection.";
    }

    return FAILURE;
};

export const findGeminiInstallation = (): { node: string; entry: string } | undefined => {
    const nodeName = process.platform === "win32" ? "node.exe" : "node";
    const directories = (process.env.PATH ?? "").split(delimiter).filter(isAbsolute);
    const node = directories
        .map((dir) => join(dir, nodeName))
        .find((path) => existsSync(path) && statSync(path).isFile());

    if (!node) {
        return undefined;
    }

    const roots = [
        ...(process.env.APPDATA ? [join(process.env.APPDATA, "npm", "node_modules", "@google", "gemini-cli")] : []),
        join(dirname(node), "node_modules", "@google", "gemini-cli"),
        join(dirname(node), "..", "lib", "node_modules", "@google", "gemini-cli"),
    ];

    for (const root of roots) {
        try {
            const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
            const entry = join(root, "bundle", "gemini.js");

            if (
                manifest.name === "@google/gemini-cli" &&
                manifest.version === AUDITED_VERSION &&
                statSync(entry).isFile()
            ) {
                return { node: realpathSync(node), entry: realpathSync(entry) };
            }
        } catch {
            // Continue through known official npm installation locations.
        }
    }

    return undefined;
};

export const geminiSettings = (sentinel: string) => ({
    security: { auth: { selectedType: "oauth-personal", enforcedType: "oauth-personal", useExternal: false } },
    hooksConfig: { enabled: false },
    skills: { enabled: false },
    tools: { core: [], discoveryCommand: "", callCommand: "", sandbox: false },
    ide: { enabled: false },
    mcp: { serverCommand: "", allowed: [sentinel] },
    context: { fileName: sentinel, includeDirectories: [], loadMemoryFromIncludeDirectories: false },
    experimental: { enableAgents: false, autoMemory: false, extensionReloading: false, taskTracker: false },
    general: { checkpointing: { enabled: false }, plan: { enabled: false }, sessionRetention: { enabled: false } },
    // A private empty cwd/.env stops lookup before it can reach the user's home .env.
    advanced: { ignoreLocalEnv: false },
    telemetry: { enabled: false },
    privacy: { usageStatisticsEnabled: false },
});

export const geminiEnvironment = (cwd: string, source = process.env): NodeJS.ProcessEnv => {
    const env = Object.fromEntries(
        Object.entries(source).filter(([key]) =>
            /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL)$/i.test(
                key,
            ),
        ),
    );

    // Empty owned values also prevent the CLI's home .env loader from restoring API credentials.
    return {
        ...env,
        GEMINI_API_KEY: "",
        GOOGLE_API_KEY: "",
        GOOGLE_APPLICATION_CREDENTIALS: "",
        GOOGLE_GENAI_USE_VERTEXAI: "",
        GOOGLE_CLOUD_PROJECT: "",
        GOOGLE_CLOUD_LOCATION: "",
        GEMINI_CLI_HOME: homedir(),
        GEMINI_CLI_NO_RELAUNCH: "1",
        GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(cwd, "settings.json"),
        GEMINI_CLI_SYSTEM_DEFAULTS_PATH: join(cwd, "defaults.json"),
        GEMINI_SYSTEM_MD: join(cwd, "system.md"),
        GEMINI_WRITE_SYSTEM_MD: "false",
        NODE_OPTIONS: "",
        NODE_PATH: "",
        NO_BROWSER: "1",
    };
};

export const geminiTextArguments = (entry: string, cwd: string, sentinel: string): string[] => [
    entry,
    "--prompt",
    "Respond to the supplied conversation as a text assistant.",
    "--output-format",
    "json",
    "--extensions",
    "none",
    // An empty allowlist means unrestricted in 0.53.1. This fresh name has no configured server.
    "--allowed-mcp-server-names",
    sentinel,
    "--policy",
    join(cwd, "deny.toml"),
];

export const parseGeminiResponse = (output: string): string => {
    let value: { response?: unknown; error?: unknown } | null;

    try {
        value = JSON.parse(output);
    } catch {
        throw new Error(FAILURE);
    }

    if (
        !value ||
        value.error ||
        typeof value.response !== "string" ||
        !value.response.trim() ||
        value.response.length > 262144
    ) {
        throw new Error(FAILURE);
    }

    return value.response;
};

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

export const getGeminiSubscriptionStatus = async (): Promise<SubscriptionStatus> => ({
    installed: !!findGeminiInstallation(),
    authenticated: verified,
    models: MODELS,
    ...(!verified
        ? {
              error:
                  lastFailure ??
                  "Use Test connection to verify your Gemini CLI Google login. Installation alone does not confirm access.",
          }
        : {}),
});

export const geminiSubscriptionCompletion = async (
    model: string,
    systemPrompt: string,
    messages: Array<{ role: string; content: string }>,
    signal: AbortSignal,
    emit: (delta: string) => void,
): Promise<string> => {
    const installation = findGeminiInstallation();

    if (!installation) {
        throw new Error(`This connection requires the audited Gemini CLI ${AUDITED_VERSION} and Node.js.`);
    }

    if (model !== "default" || signal.aborted) {
        throw new Error("Gemini request cancelled or model unavailable.");
    }

    const input = subscriptionInput(messages);

    if (Buffer.byteLength(input) + Buffer.byteLength(systemPrompt) > 524288) {
        throw new Error("This conversation is too long for the subscription connection.");
    }

    const cwd = await mkdtemp(join(tmpdir(), "meowcast-gemini-"));
    const sentinel = `meowcast-disabled-${randomUUID()}`;
    let child: ChildProcessWithoutNullStreams | undefined;

    try {
        await Promise.all([
            writeFile(join(cwd, "settings.json"), JSON.stringify(geminiSettings(sentinel)), { mode: 0o600 }),
            writeFile(join(cwd, "defaults.json"), "{}", { mode: 0o600 }),
            writeFile(join(cwd, ".env"), "", { mode: 0o600 }),
            writeFile(join(cwd, "system.md"), systemPrompt, { mode: 0o600 }),
            writeFile(join(cwd, "deny.toml"), '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n', {
                mode: 0o600,
            }),
        ]);

        if (signal.aborted) {
            throw new Error("Gemini request cancelled.");
        }

        child = spawn(installation.node, geminiTextArguments(installation.entry, cwd, sentinel), {
            cwd,
            env: geminiEnvironment(cwd),
            shell: false,
            windowsHide: true,
            detached: process.platform !== "win32",
            stdio: "pipe",
        });
        const running = child;
        const output = await new Promise<string>((resolve, reject) => {
            let output = "";
            let diagnostic = "";
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timer);
                signal.removeEventListener("abort", abort);

                if (error) {
                    reject(error);
                } else {
                    resolve(output);
                }
            };
            const abort = () => finish(new Error("Gemini request cancelled."));
            const timer = setTimeout(() => finish(new Error("Gemini request timed out.")), 90000);
            signal.addEventListener("abort", abort, { once: true });
            running.stdout.setEncoding("utf8");
            running.stderr.setEncoding("utf8");
            running.stderr.on("data", (chunk: string) => {
                if (!settled && diagnostic.length < 16384) {
                    diagnostic += chunk.slice(0, 16384 - diagnostic.length);
                }
            });
            running.stdout.on("data", (chunk: string) => {
                if (settled) {
                    return;
                }

                output += chunk;

                if (Buffer.byteLength(output) > 1048576) {
                    finish(new Error(FAILURE));
                }
            });
            running.once("error", () => finish(new Error(FAILURE)));
            running.once("close", (code) =>
                finish(code === 0 ? undefined : new Error(geminiFailureMessage(diagnostic))),
            );
            running.stdin.on("error", () => finish(new Error(FAILURE)));
            running.stdin.end(input);
        });
        const text = parseGeminiResponse(output);
        verified = true;
        lastFailure = undefined;
        emit(text);
        return text;
    } catch (error) {
        verified = false;
        lastFailure = error instanceof Error ? error.message : FAILURE;
        throw error;
    } finally {
        if (child) {
            await terminate(child);
        }

        await rm(cwd, { recursive: true, force: true });
    }
};
