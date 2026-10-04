import type { SearchResultItem } from "@common/Core";
import { NOTE_LIMITS, validateNote, validNoteId, type Note, type NoteSummary } from "@common/Extensions/Notes/Note";
import type { Extension } from "@Core/Extension";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export class NotesExtension implements Extension {
    public readonly id = "Notes";
    public readonly name = "Notes";
    public readonly author = { name: "Meowcast", githubUserName: "hustlerv369" };
    private queue: Promise<unknown> = Promise.resolve();
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
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="8" y="5" width="32" height="38" rx="7" fill="#dadada"/><path d="M16 16h16M16 24h16M16 32h10" stroke="#383838" stroke-width="3" stroke-linecap="round"/></svg>',
                ),
        };
    }
    public async getSearchResultItems(): Promise<SearchResultItem[]> {
        return [
            {
                id: "Notes:open",
                name: "Notes",
                description: "Write and search your local notebook",
                image: this.getImage(),
                defaultAction: {
                    handlerId: "navigateTo",
                    description: "Open notes",
                    argument: JSON.stringify({ browserWindowId: "search", pathname: "/extension/Notes" }),
                },
            },
        ];
    }
    public invoke(argument: unknown) {
        const task = this.queue.catch(() => undefined).then(() => this.execute(argument));
        this.queue = task.catch(() => undefined);
        return task;
    }
    private directory() {
        return join(app.getPath("userData"), "notes");
    }
    private async read(id: unknown): Promise<Note> {
        if (!validNoteId(id)) {
            throw new Error("Invalid note ID.");
        }

        const file = join(this.directory(), `${id}.json`);
        const info = await stat(file);

        if (info.size > 700_000) {
            throw new Error("Note file exceeds the supported size.");
        }

        const note: unknown = JSON.parse(await readFile(file, "utf8"));

        if (!validateNote(note) || note.id !== id) {
            throw new Error("This note could not be read. Its file has been kept unchanged.");
        }

        return note;
    }
    private async files() {
        await mkdir(this.directory(), { recursive: true });
        return (await readdir(this.directory())).filter(
            (name) => name.endsWith(".json") && validNoteId(name.slice(0, -5)),
        );
    }
    private async write(note: Note) {
        let total = 0;

        for (const file of await this.files()) {
            if (file !== `${note.id}.json`) {
                total += (await stat(join(this.directory(), file))).size;
            }
        }

        const data = JSON.stringify(note);

        if (total + Buffer.byteLength(data, "utf8") > NOTE_LIMITS.notebookBytes) {
            throw new Error("Your notebook has reached its 256 MiB disk limit. Remove notes before saving more.");
        }

        const temporary = join(this.directory(), `${note.id}.${randomUUID()}.tmp`);
        const handle = await open(temporary, "wx", 0o600);

        try {
            try {
                await handle.writeFile(data, "utf8");
                await handle.sync();
            } finally {
                await handle.close();
            }

            await rename(temporary, join(this.directory(), `${note.id}.json`));
        } catch (error) {
            await unlink(temporary).catch(() => undefined);
            throw error;
        }

        return note;
    }
    private async execute(argument: unknown) {
        if (!argument || typeof argument !== "object") {
            throw new Error("Invalid notes request.");
        }

        const request = argument as {
            command?: unknown;
            id?: unknown;
            revision?: unknown;
            title?: unknown;
            body?: unknown;
            query?: unknown;
        };

        if (request.command === "list") {
            if (request.query !== undefined && (typeof request.query !== "string" || request.query.length > 120)) {
                throw new Error("Search is limited to 120 characters.");
            }

            const query = typeof request.query === "string" ? request.query.trim().toLowerCase() : "";
            const matches: NoteSummary[] = [];
            let unreadable = 0;

            for (const file of await this.files()) {
                try {
                    const note = await this.read(file.slice(0, -5));

                    if (!query || `${note.title}\n${note.body}`.toLowerCase().includes(query)) {
                        matches.push({
                            id: note.id,
                            title: note.title,
                            revision: note.revision,
                            updatedAt: note.updatedAt,
                        });
                    }
                } catch {
                    unreadable++;
                }
            }

            matches.sort((a, b) => b.updatedAt - a.updatedAt);
            return { notes: matches.slice(0, NOTE_LIMITS.results), total: matches.length, unreadable };
        }

        if (request.command === "create") {
            return this.write({
                id: randomUUID(),
                title: "Untitled note",
                body: "",
                revision: 1,
                updatedAt: Date.now(),
            });
        }

        if (request.command === "load") {
            return this.read(request.id);
        }

        if (request.command !== "save" && request.command !== "delete") {
            throw new Error("Unknown notes request.");
        }

        const existing = await this.read(request.id);

        if (request.revision !== existing.revision) {
            throw new Error("This note changed elsewhere. Reopen it before saving or deleting.");
        }

        if (request.command === "delete") {
            await unlink(join(this.directory(), `${existing.id}.json`));
            return { deleted: true };
        }

        const note = {
            ...existing,
            title: request.title,
            body: request.body,
            revision: existing.revision + 1,
            updatedAt: Date.now(),
        };

        if (!validateNote(note)) {
            throw new Error("Use a title up to 160 characters and a note up to 100,000 characters.");
        }

        return this.write(note);
    }
}
