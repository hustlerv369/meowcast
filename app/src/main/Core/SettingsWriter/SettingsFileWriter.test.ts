import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../Settings";
import { SettingsFileWriter } from "./SettingsFileWriter";

const settingsFilePath = join(__dirname, "settings.json");

const settings: Settings = {
    key1: "value1",
    key2: "value2",
    key3: "value3",
};

const removeFileIfExists = (filePath: string) => {
    if (existsSync(filePath)) {
        unlinkSync(filePath);
    }
};

describe(SettingsFileWriter, () => {
    beforeEach(() => removeFileIfExists(settingsFilePath));
    afterEach(() => removeFileIfExists(settingsFilePath));

    it("should write settings to a JSON file", async () => {
        const settingsFileWriter = new SettingsFileWriter(settingsFilePath);
        await settingsFileWriter.writeSettings(settings);

        expect(readFileSync(settingsFilePath, "utf-8")).toEqual(JSON.stringify(settings, null, 4));
    });

    it("serializes overlapping writes and snapshots each requested value", async () => {
        const writer = new SettingsFileWriter(settingsFilePath);
        const mutable = { value: "first" };
        const first = writer.writeSettings(mutable);
        mutable.value = "second";
        const second = writer.writeSettings(mutable);
        await Promise.all([first, second]);
        expect(JSON.parse(readFileSync(settingsFilePath, "utf8"))).toEqual({ value: "second" });
    });

    it("recovers after a rejected export without blocking later settings saves", async () => {
        const writer = new SettingsFileWriter(settingsFilePath);
        await expect(writer.writeSettingsToPath(settings, "/foo/bar")).rejects.toThrow();
        await writer.writeSettings(settings);
        expect(JSON.parse(readFileSync(settingsFilePath, "utf8"))).toEqual(settings);
    });

    it("should return a rejected promise when trying to write a JSON file to an inaccessible file path", async () => {
        await expect(new SettingsFileWriter("/foo/bar").writeSettings(settings)).rejects.toThrowError();
    });
});
