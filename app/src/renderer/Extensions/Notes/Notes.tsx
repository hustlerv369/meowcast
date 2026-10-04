import { NOTE_LIMITS, type Note, type NoteSummary } from "@common/Extensions/Notes/Note";
import type { ExtensionProps } from "@Core/ExtensionProps";
import { useEffect, useRef, useState } from "react";
import { BaseLayout } from "../../Core/BaseLayout";
import { Header } from "../../Core/Header";
import "./Notes.css";

export const Notes = ({ contextBridge, goBack }: ExtensionProps) => {
    const [notes, setNotes] = useState<NoteSummary[]>([]);
    const [note, setNote] = useState<Note | null>(null);
    const current = useRef<Note | null>(null);
    const dirty = useRef(false);
    const saving = useRef<Promise<boolean> | null>(null);
    const [query, setQuery] = useState("");
    const queryRef = useRef(query);
    queryRef.current = query;
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("Loading notes…");
    const [error, setError] = useState("");
    const [listHint, setListHint] = useState("");
    const [confirmDelete, setConfirmDelete] = useState(false);
    const listSequence = useRef(0);
    const request = <T,>(argument: unknown) => contextBridge.invokeExtension<unknown, T>("Notes", argument);
    const refresh = async () => {
        const sequence = ++listSequence.current;
        const result = await request<{ notes: NoteSummary[]; total: number; unreadable: number }>({
            command: "list",
            query: queryRef.current,
        });

        if (sequence === listSequence.current) {
            setNotes(result.notes);
            setListHint(
                result.unreadable
                    ? `${result.unreadable} unreadable note files were left unchanged.`
                    : result.total > NOTE_LIMITS.results
                      ? `Showing the latest ${NOTE_LIMITS.results} matches. Narrow your search to find older notes.`
                      : "",
            );
        }
    };
    const flush = async (): Promise<boolean> => {
        if (saving.current) {
            const okay = await saving.current;
            return okay ? flush() : false;
        }

        const snapshot = current.current;

        if (!snapshot || !dirty.current) {
            return true;
        }

        setStatus("Saving…");
        const operation = request<Note>({ command: "save", ...snapshot })
            .then((saved) => {
                const latest = current.current;

                if (latest?.id === saved.id) {
                    dirty.current = latest.title !== snapshot.title || latest.body !== snapshot.body;
                    current.current = { ...latest, revision: saved.revision, updatedAt: saved.updatedAt };
                    setNote(current.current);
                }

                setStatus(dirty.current ? "Unsaved changes" : "Saved on this device");
                setError("");
                void refresh().catch(() => undefined);
                return true;
            })
            .catch(() => {
                setError(
                    "Could not save. Your text is still here. Retry Save; if another window changed this note, reopen it after copying your text.",
                );
                setStatus("Not saved");
                return false;
            })
            .finally(() => {
                saving.current = null;
            });
        saving.current = operation;
        return (await operation) ? flush() : false;
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            void refresh()
                .then(() => {
                    if (!current.current && !saving.current) {
                        setStatus("Ready on this device");
                    }
                })
                .catch(() => setError("Could not read the notebook. Reopen Notes to retry."));
        }, 180);
        return () => clearTimeout(timer);
    }, [query]);

    useEffect(() => {
        if (!dirty.current || error) {
            return;
        }

        const timer = setTimeout(() => {
            void flush();
        }, 650);
        return () => clearTimeout(timer);
    }, [note?.title, note?.body]);

    const select = async (id?: string) => {
        setBusy(true);

        try {
            if (!(await flush())) {
                return;
            }

            const loaded = await request<Note>(id ? { command: "load", id } : { command: "create" });
            current.current = loaded;
            dirty.current = false;
            setNote(loaded);
            setConfirmDelete(false);
            setError("");
            setStatus("Saved on this device");
            await refresh();
        } catch {
            setError("Could not open this note. Existing files have not been replaced.");
        } finally {
            setBusy(false);
        }
    };
    const edit = (field: "title" | "body", value: string) => {
        if (!current.current) {
            return;
        }

        current.current = { ...current.current, [field]: value };
        dirty.current = true;
        setNote(current.current);
        setStatus("Unsaved changes");
    };
    const remove = async () => {
        setBusy(true);

        try {
            if (!(await flush()) || !current.current) {
                return;
            }

            await request({ command: "delete", id: current.current.id, revision: current.current.revision });
            current.current = null;
            dirty.current = false;
            setNote(null);
            setConfirmDelete(false);
            setStatus("Note deleted");
            await refresh();
        } catch {
            setError("Could not delete this note. Reopen it and try again.");
        } finally {
            setBusy(false);
        }
    };
    const leave = async () => {
        if (busy) {
            return;
        }

        setBusy(true);

        try {
            if (await flush()) {
                goBack();
            }
        } finally {
            setBusy(false);
        }
    };
    return (
        <BaseLayout
            header={
                <Header
                    draggable
                    contentBefore={
                        <button
                            className="studio-button non-draggable-area"
                            disabled={busy}
                            onClick={() => void leave()}
                        >
                            Back
                        </button>
                    }
                >
                    <strong>Notes</strong>
                </Header>
            }
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();

                    if (confirmDelete) {
                        setConfirmDelete(false);
                    } else {
                        void leave();
                    }
                }

                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    void flush();
                }
            }}
            content={
                <div className="notes-workspace">
                    <aside className="notes-sidebar" aria-label="Notebook">
                        <button className="studio-button" disabled={busy} onClick={() => void select()}>
                            New note
                        </button>
                        <label>
                            Search notes
                            <input
                                type="search"
                                value={query}
                                maxLength={120}
                                onChange={(event) => setQuery(event.target.value)}
                            />
                        </label>
                        <div className="notes-list">
                            {notes.map((item) => (
                                <button
                                    key={item.id}
                                    disabled={busy}
                                    aria-pressed={note?.id === item.id}
                                    onClick={() => void select(item.id)}
                                >
                                    {item.title || "Untitled note"}
                                </button>
                            ))}
                        </div>
                        {!notes.length && <p>No notes found.</p>}
                        {listHint && <p>{listHint}</p>}
                    </aside>
                    <section className="notes-editor" aria-label="Note editor">
                        {note ? (
                            <>
                                <label>
                                    Title
                                    <input
                                        value={note.title}
                                        maxLength={NOTE_LIMITS.title}
                                        disabled={busy}
                                        onChange={(event) => edit("title", event.target.value)}
                                    />
                                </label>
                                <label className="notes-body">
                                    Note
                                    <textarea
                                        value={note.body}
                                        maxLength={NOTE_LIMITS.body}
                                        disabled={busy}
                                        onChange={(event) => edit("body", event.target.value)}
                                    />
                                </label>
                                <div className="notes-actions">
                                    <button className="studio-button" disabled={busy} onClick={() => void flush()}>
                                        Save
                                    </button>
                                    <button
                                        className="studio-button"
                                        disabled={busy}
                                        onClick={() => setConfirmDelete(true)}
                                    >
                                        Delete note
                                    </button>
                                </div>
                                {confirmDelete && (
                                    <div role="group" aria-label="Confirm deletion">
                                        <p>Permanently delete this note?</p>
                                        <button className="studio-button" disabled={busy} onClick={() => void remove()}>
                                            Delete permanently
                                        </button>
                                        <button className="studio-button" onClick={() => setConfirmDelete(false)}>
                                            Keep note
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <p className="notes-empty">Keep an idea, a draft or a checklist. Create a note to start.</p>
                        )}
                        <p role="status">{status}</p>
                        {error && <p role="alert">{error}</p>}
                    </section>
                </div>
            }
            footer={
                <p className="notes-privacy">
                    Local plain text. No cloud sync or paid note limit. Up to 100,000 characters per note and 256 MiB
                    per notebook. Autosaves after typing; check “Saved” before closing.
                </p>
            }
        />
    );
};
