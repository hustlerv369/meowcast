export const NOTE_LIMITS = { title: 160, body: 100_000, notebookBytes: 256 * 1024 * 1024, results: 200 } as const;
export type Note = { id: string; title: string; body: string; revision: number; updatedAt: number };
export type NoteSummary = Omit<Note, "body">;
export const validNoteId = (id: unknown): id is string =>
    typeof id === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);
export const validateNote = (value: unknown): value is Note => {
    if (!value || typeof value !== "object") {
        return false;
    }

    const note = value as Note;
    return (
        validNoteId(note.id) &&
        typeof note.title === "string" &&
        note.title.length <= NOTE_LIMITS.title &&
        typeof note.body === "string" &&
        note.body.length <= NOTE_LIMITS.body &&
        Number.isSafeInteger(note.revision) &&
        note.revision >= 1 &&
        Number.isFinite(note.updatedAt) &&
        note.updatedAt >= 0
    );
};
