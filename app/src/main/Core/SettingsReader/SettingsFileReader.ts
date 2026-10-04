import { existsSync, readFileSync, renameSync } from "fs";
import type { Settings } from "../Settings";
import type { SettingsReader } from "./Contract";

export class SettingsFileReader implements SettingsReader {
    public constructor(private readonly settingsFilePath: string) {}

    public readSettings(): Settings {
        return this.readSettingsFromPath(this.settingsFilePath);
    }

    public readSettingsFromPath(filePath: string): Settings {
        try {
            return JSON.parse(readFileSync(filePath, "utf-8"));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return {};
            }

            // Only auto-recover the app's OWN settings file: back it up and reset to defaults so a
            // corrupt or momentarily locked file never prevents startup. For arbitrary paths (e.g. a
            // settings file the user picked to import) we must not touch the user's file — surface the
            // error so the import can fail cleanly.
            if (filePath !== this.settingsFilePath) {
                throw error;
            }

            if (existsSync(filePath)) {
                try {
                    const backupPath = `${filePath}.corrupt.${Date.now()}`;
                    renameSync(filePath, backupPath);
                    console.error(
                        `[Meowcast] Settings file at "${filePath}" could not be parsed and was moved to "${backupPath}". Reason: ${(error as Error).message}`,
                    );
                } catch (moveError) {
                    console.error(
                        `[Meowcast] Settings file at "${filePath}" could not be parsed and could not be backed up. Reason: ${(moveError as Error).message}`,
                    );
                }
            }

            // Reset to defaults instead of re-throwing so a corrupt settings file never bricks startup.
            return {};
        }
    }
}
