import { NOTE_LIMITS, type Note } from "@common/Extensions/Notes/Note";
import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesExtension } from "./NotesExtension";
const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("electron", () => ({ app: { getPath: () => state.directory } }));
beforeEach(async () => {
    state.directory = await mkdtemp(join(tmpdir(), "meowcast-notes-test-"));
});
afterEach(async () => {
    await rm(state.directory, { recursive: true, force: true });
});
const create = async (extension: NotesExtension) => (await extension.invoke({ command: "create" })) as Note;

describe("local Notes storage", () => {
    it("creates, saves, searches and reloads plaintext after extension restart", async () => {
        const extension = new NotesExtension();
        const first = await create(extension);
        const saved = (await extension.invoke({
            command: "save",
            ...first,
            title: "Release draft",
            body: "A private checklist",
        })) as Note;
        expect(saved.revision).toBe(2);
        const restarted = new NotesExtension();
        expect(await restarted.invoke({ command: "load", id: first.id })).toEqual(saved);
        const result = await restarted.invoke({ command: "list", query: "CHECKLIST" });
        expect(result).toMatchObject({ total: 1, unreadable: 0, notes: [{ title: "Release draft" }] });
        expect((await readdir(join(state.directory, "notes"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    });
    it("rejects invalid IDs, oversized fields, unknown commands and invalid search", async () => {
        const extension = new NotesExtension();
        const note = await create(extension);

        for (const request of [
            null,
            { command: "oops" },
            { command: "load", id: "../settings" },
            { command: "list", query: "x".repeat(121) },
            { command: "save", ...note, body: "x".repeat(NOTE_LIMITS.body + 1) },
            { command: "save", ...note, title: null },
        ]) {
            await expect(extension.invoke(request)).rejects.toThrow();
        }

        expect(await extension.invoke({ command: "load", id: note.id })).toEqual(note);
    });
    it("serializes writes and rejects stale revisions instead of overwriting", async () => {
        const extension = new NotesExtension();
        const note = await create(extension);
        const writes = await Promise.allSettled([
            extension.invoke({ command: "save", ...note, body: "first" }),
            extension.invoke({ command: "save", ...note, body: "stale" }),
        ]);
        expect(writes.map((item) => item.status)).toEqual(["fulfilled", "rejected"]);
        expect(await extension.invoke({ command: "load", id: note.id })).toMatchObject({ body: "first", revision: 2 });
    });
    it("never resurrects a deleted note through a queued old autosave", async () => {
        const extension = new NotesExtension();
        const note = await create(extension);
        const operations = await Promise.allSettled([
            extension.invoke({ command: "delete", id: note.id, revision: note.revision }),
            extension.invoke({ command: "save", ...note, body: "late" }),
        ]);
        expect(operations.map((item) => item.status)).toEqual(["fulfilled", "rejected"]);
        expect(await extension.invoke({ command: "list" })).toMatchObject({ total: 0 });
    });
    it("preserves corrupt files and reports unreadable notes", async () => {
        const extension = new NotesExtension();
        const note = await create(extension);
        const file = join(state.directory, "notes", `${note.id}.json`);
        await writeFile(file, "corrupt data");
        expect(await extension.invoke({ command: "list" })).toMatchObject({ unreadable: 1 });
        await expect(extension.invoke({ command: "save", ...note, body: "replacement" })).rejects.toThrow();
        expect(await readFile(file, "utf8")).toBe("corrupt data");
    });
    it("enforces aggregate disk capacity without a paid note-count gate", async () => {
        const extension = new NotesExtension();
        const note = await create(extension);
        await truncate(join(state.directory, "notes", `${note.id}.json`), NOTE_LIMITS.notebookBytes);
        await expect(create(extension)).rejects.toThrow("256 MiB");
    });
});
