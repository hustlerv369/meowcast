import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import type { Settings } from "../Settings";
import type { SettingsWriter } from "./Contract";

export class SettingsFileWriter implements SettingsWriter {
    private pending: Promise<void> = Promise.resolve();
    public constructor(private readonly settingsFilePath: string) {}

    public writeSettings(settings: Settings): Promise<void> {
        return this.writeSettingsToPath(settings, this.settingsFilePath);
    }

    public writeSettingsToPath(settings: Settings, filePath: string): Promise<void> {
        const data = JSON.stringify(SettingsFileWriter.sortSettingsAlphabetically(settings), null, 4);
        const operation = this.pending
            .catch(() => undefined)
            .then(async () => {
                const temporary = `${filePath}.${randomUUID()}.tmp`;

                try {
                    const handle = await open(temporary, "wx", 0o600);

                    try {
                        await handle.writeFile(data, "utf8");
                        await handle.sync();
                    } finally {
                        await handle.close();
                    }

                    await rename(temporary, filePath);
                } catch (error) {
                    await unlink(temporary).catch(() => undefined);
                    throw error;
                }
            });
        this.pending = operation;
        return operation;
    }

    private static sortSettingsAlphabetically(settings: Settings): Settings {
        const result: Settings = {};

        for (const key of Object.keys(settings).sort()) {
            result[key] = settings[key];
        }

        return result;
    }
}
