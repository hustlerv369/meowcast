import { spawn } from "node:child_process";

export const MEOWMATE_AUTOSTART_SETTING = "general.meowmateAutoStart";
type StartupResult = "started" | "skipped" | "missing" | "failed";
type StartupDependencies = {
    ready: () => Promise<unknown>;
    supported: () => boolean;
    packaged: () => boolean;
    enabled: () => boolean;
    executable: () => string;
    exists: (path: string) => Promise<unknown>;
    launch: (path: string) => Promise<void>;
};

/** One attempt per app process. No retry loop and no coupling to search scans. */
export class MeowmateStartup {
    private attempt?: Promise<StartupResult>;
    public constructor(private readonly dependencies: StartupDependencies) {}

    public start(): Promise<StartupResult> {
        this.attempt ??= this.run();
        return this.attempt;
    }

    private async run(): Promise<StartupResult> {
        try {
            await this.dependencies.ready();

            if (!this.dependencies.supported() || !this.dependencies.packaged() || !this.dependencies.enabled()) {
                return "skipped";
            }

            const executable = this.dependencies.executable();

            try {
                await this.dependencies.exists(executable);
            } catch {
                return "missing";
            }

            // A preference changed while disk access was pending must still be honored.
            if (!this.dependencies.enabled()) {
                return "skipped";
            }

            await this.dependencies.launch(executable);
            return "started";
        } catch {
            return "failed";
        }
    }
}

export const launchCompanionInBackground = (executable: string): Promise<void> =>
    new Promise((resolve, reject) => {
        const child = spawn(executable, ["--background"], {
            shell: false,
            windowsHide: true,
            detached: true,
            stdio: "ignore",
        });
        child.once("error", () => reject(new Error("Meowmate could not start.")));
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });
