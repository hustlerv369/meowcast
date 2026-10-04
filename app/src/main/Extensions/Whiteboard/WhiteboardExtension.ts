import type { SearchResultItem } from "@common/Core";
import {
    BOARD_HEIGHT,
    BOARD_LIMITS,
    BOARD_WIDTH,
    emptyBoard,
    validateBoard,
} from "@common/Extensions/Whiteboard/Board";
import type { Extension } from "@Core/Extension";
import { app, BrowserWindow, dialog, nativeImage, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export class WhiteboardExtension implements Extension {
    public readonly id = "Whiteboard";
    public readonly name = "Whiteboard";
    public readonly author = { name: "Meowcast", githubUserName: "hustlerv369" };
    private recoveryRequired = false;
    private saving: Promise<unknown> = Promise.resolve();
    public isSupported() {
        return true;
    }
    public getSettingDefaultValue() {
        return undefined;
    }
    public getI18nResources() {
        return {};
    }
    public getImage() {
        return {
            url:
                "data:image/svg+xml," +
                encodeURIComponent(
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="5" y="8" width="38" height="28" rx="7" fill="#e4eafb"/><path d="m13 27 9-10 6 8 7-6M18 41h12" fill="none" stroke="#4466a8" stroke-width="3" stroke-linecap="round"/></svg>',
                ),
        };
    }
    public async getSearchResultItems(): Promise<SearchResultItem[]> {
        return [
            {
                id: "Whiteboard:open",
                name: "Whiteboard",
                description: "Draw, sketch and keep sticky notes offline",
                image: this.getImage(),
                defaultAction: {
                    handlerId: "navigateTo",
                    description: "Open whiteboard",
                    argument: JSON.stringify({ browserWindowId: "search", pathname: "/extension/Whiteboard" }),
                },
            },
        ];
    }
    public async invoke(argument: unknown, sender?: WebContents) {
        if (!argument || typeof argument !== "object") {
            throw new Error("Invalid whiteboard request.");
        }

        const request = argument as { command?: string; board?: unknown; png?: string };
        const file = join(app.getPath("userData"), "whiteboard.json");

        if (request.command === "load") {
            await this.saving;

            try {
                const info = await stat(file);

                if (info.size > BOARD_LIMITS.bytes) {
                    throw new Error("Board too large.");
                }

                const board = validateBoard(JSON.parse(await readFile(file, "utf8")));

                if (!board) {
                    throw new Error("Invalid board.");
                }

                return { board, recovered: false };
            } catch (error) {
                const recovered = (error as NodeJS.ErrnoException).code !== "ENOENT";
                this.recoveryRequired ||= recovered;
                return { board: emptyBoard(), recovered };
            }
        }

        if (request.command === "save") {
            const board = validateBoard(request.board);

            if (!board) {
                throw new Error("Whiteboard exceeds the supported limits.");
            }

            const json = JSON.stringify(board);

            if (Buffer.byteLength(json, "utf8") > BOARD_LIMITS.bytes) {
                throw new Error("Whiteboard exceeds the storage limit.");
            }

            const task = this.saving
                .catch(() => undefined)
                .then(async () => {
                    await mkdir(app.getPath("userData"), { recursive: true });

                    if (this.recoveryRequired) {
                        await copyFile(file, file + ".recovery-" + randomUUID(), constants.COPYFILE_EXCL);
                        this.recoveryRequired = false;
                    }

                    const temporary = file + ".tmp";
                    await writeFile(temporary, json, { encoding: "utf8", mode: 0o600 });
                    await rename(temporary, file);
                    return { saved: true };
                });
            this.saving = task.catch(() => undefined);
            return task;
        }

        if (request.command === "export") {
            if (
                !sender ||
                typeof request.png !== "string" ||
                request.png.length > 6000000 ||
                !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(request.png)
            ) {
                throw new Error("Invalid image.");
            }

            const buffer = Buffer.from(request.png.slice("data:image/png;base64,".length), "base64");

            if (
                buffer.length < 24 ||
                buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
                buffer.readUInt32BE(16) !== BOARD_WIDTH ||
                buffer.readUInt32BE(20) !== BOARD_HEIGHT
            ) {
                throw new Error("Invalid image dimensions.");
            }

            const image = nativeImage.createFromBuffer(buffer);

            if (image.isEmpty()) {
                throw new Error("Invalid image.");
            }

            const window = BrowserWindow.fromWebContents(sender);

            if (!window) {
                throw new Error("Whiteboard window unavailable.");
            }

            const result = await dialog.showSaveDialog(window, {
                title: "Export whiteboard",
                defaultPath: "Meowcast-whiteboard.png",
                filters: [{ name: "PNG image", extensions: ["png"] }],
            });

            if (result.canceled || !result.filePath) {
                return { exported: false };
            }

            const temporary = result.filePath + ".tmp-" + randomUUID();
            const handle = await open(temporary, "wx", 0o600);

            try {
                try {
                    await handle.writeFile(image.toPNG());
                } finally {
                    await handle.close();
                }

                await rename(temporary, result.filePath);
            } catch (error) {
                await unlink(temporary).catch(() => undefined);
                throw error;
            }

            return { exported: true };
        }

        throw new Error("Unknown whiteboard request.");
    }
}
