import {
    BOARD_HEIGHT,
    BOARD_LIMITS,
    BOARD_WIDTH,
    commitBoard,
    createHistory,
    emptyBoard,
    NOTE_COLORS,
    PEN_COLORS,
    redoBoard,
    undoBoard,
    validateBoard,
    type Board,
    type Note,
    type Point,
    type Stroke,
} from "@common/Extensions/Whiteboard/Board";
import { BaseLayout } from "@Core/BaseLayout";
import type { ExtensionProps } from "@Core/ExtensionProps";
import { Header } from "@Core/Header";
import { Button, Textarea } from "@fluentui/react-components";
import { ArrowDownloadRegular, ArrowLeftRegular, ArrowRedoRegular, ArrowUndoRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { drawBoard, hitElement } from "./drawBoard";
import "./Whiteboard.css";

export const Whiteboard = ({ contextBridge, goBack }: ExtensionProps) => {
    const [history, setHistory] = useState(createHistory);
    const [drawing, setDrawing] = useState(false);
    const [ready, setReady] = useState(false);
    const [tool, setTool] = useState<"pen" | "erase" | "note">("pen");
    const [color, setColor] = useState<string>(PEN_COLORS[0]);
    const [width, setWidth] = useState(4);
    const [selected, setSelected] = useState<string | null>(null);
    const [noteText, setNoteText] = useState("");
    const [clearOpen, setClearOpen] = useState(false);
    const [message, setMessage] = useState("");
    const [saveState, setSaveState] = useState("Loading local board...");
    const [exporting, setExporting] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const draftRef = useRef<Stroke | null>(null);
    const boardRef = useRef(history.present);
    const latestSave = useRef(0);
    const noteInput = useRef<HTMLTextAreaElement>(null);
    const board = history.present;
    boardRef.current = board;
    const notes = board.elements.filter((item): item is Note => item.kind === "note");
    const selectedNote = notes.find((note) => note.id === selected);
    const noteDirty = !!selectedNote && selectedNote.text !== noteText;

    useEffect(() => {
        let mounted = true;
        void contextBridge
            .invokeExtension<unknown, { board: Board; recovered: boolean }>("Whiteboard", { command: "load" })
            .then((value) => {
                if (!mounted) {
                    return;
                }

                setHistory(createHistory(validateBoard(value.board) ?? emptyBoard()));
                setReady(true);
                setSaveState(value.recovered ? "Recovery mode: no changes saved" : "Ready on this device");

                if (value.recovered) {
                    setMessage("The saved board could not be read. New changes will replace it.");
                }
            })
            .catch(() => {
                if (mounted) {
                    setMessage("Could not load the board. Reopen Whiteboard to retry.");
                }
            });
        return () => {
            mounted = false;
        };
    }, [contextBridge]);

    useEffect(() => {
        if (canvasRef.current) {
            drawBoard(canvasRef.current, board);
        }
    }, [board]);
    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas) {
            return;
        }

        const observer = new ResizeObserver(() => {
            const current = boardRef.current;
            const draft = draftRef.current;
            drawBoard(canvas, draft ? { ...current, elements: [...current.elements, draft] } : current);
        });
        observer.observe(canvas);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (selectedNote) {
            setNoteText(selectedNote.text);
            noteInput.current?.focus();
        }
    }, [selectedNote?.id]);

    const persist = (next: Board) => {
        const sequence = ++latestSave.current;
        setSaveState("Saving...");
        // Dispatch immediately; main serializes writes so a route reopen sees the latest queued snapshot.
        void contextBridge
            .invokeExtension("Whiteboard", { command: "save", board: next })
            .then(() => {
                if (sequence === latestSave.current) {
                    setSaveState("Saved on this device");
                }
            })
            .catch(() => {
                if (sequence === latestSave.current) {
                    setSaveState("Not saved. Keep this window open and retry.");
                }
            });
    };
    const commit = (next: Board) => {
        const valid = validateBoard(next);

        if (!valid) {
            setMessage("Board limit reached. Remove some marks or shorten the note.");

            if (canvasRef.current) {
                drawBoard(canvasRef.current, boardRef.current);
            }

            return;
        }

        setHistory((current) => commitBoard(current, valid));
        persist(valid);
    };
    const travel = (direction: "undo" | "redo") => {
        if (!ready) {
            return;
        }

        draftRef.current = null;
        const next = direction === "undo" ? undoBoard(history) : redoBoard(history);

        if (next === history) {
            return;
        }

        setHistory(next);
        setSelected(null);
        persist(next.present);
    };
    const addNote = (
        point: Point = { x: 72 + (notes.length % 4) * 230, y: 70 + Math.floor((notes.length % 12) / 4) * 150 },
    ) => {
        const id = crypto.randomUUID();
        const next = {
            ...board,
            elements: [
                ...board.elements,
                {
                    id,
                    kind: "note" as const,
                    color: NOTE_COLORS[notes.length % NOTE_COLORS.length],
                    x: Math.min(BOARD_WIDTH - 220, point.x),
                    y: Math.min(BOARD_HEIGHT - 140, point.y),
                    text: "",
                },
            ],
        };

        if (!validateBoard(next)) {
            setMessage("Board limit reached. Remove an object to add a note.");
            return;
        }

        commit(next);
        setSelected(id);
        setTool("note");
    };
    const pointAt = (event: PointerEvent<HTMLCanvasElement>): Point => {
        const bounds = event.currentTarget.getBoundingClientRect();
        return {
            x: Math.round(
                Math.max(0, Math.min(BOARD_WIDTH, ((event.clientX - bounds.left) / bounds.width) * BOARD_WIDTH)),
            ),
            y: Math.round(
                Math.max(0, Math.min(BOARD_HEIGHT, ((event.clientY - bounds.top) / bounds.height) * BOARD_HEIGHT)),
            ),
        };
    };
    const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!ready || event.button !== 0 || draftRef.current) {
            return;
        }

        const point = pointAt(event);
        const hit = hitElement(board, point);

        if (tool === "erase") {
            if (hit) {
                commit({ ...board, elements: board.elements.filter((item) => item.id !== hit.id) });
            }

            return;
        }

        if (tool === "note") {
            if (hit?.kind === "note") {
                setSelected(hit.id);
                setNoteText(hit.text);
            } else {
                addNote(point);
            }

            return;
        }

        setDrawing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        draftRef.current = { id: crypto.randomUUID(), kind: "stroke", color, width, points: [point] };
        drawBoard(event.currentTarget, { ...board, elements: [...board.elements, draftRef.current] });
    };
    const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
        const draft = draftRef.current;

        if (!draft || !event.currentTarget.hasPointerCapture(event.pointerId)) {
            return;
        }

        const point = pointAt(event);
        const last = draft.points[draft.points.length - 1];

        if (Math.hypot(point.x - last.x, point.y - last.y) < 2) {
            return;
        }

        const existing = board.elements.reduce(
            (sum, item) => sum + (item.kind === "stroke" ? item.points.length : 0),
            0,
        );

        if (draft.points.length >= BOARD_LIMITS.strokePoints || existing + draft.points.length >= BOARD_LIMITS.points) {
            setMessage("Stroke limit reached. Release the pointer; this part is kept.");
            return;
        }

        draft.points.push(point);
        drawBoard(event.currentTarget, { ...board, elements: [...board.elements, draft] });
    };
    const finishStroke = (event: PointerEvent<HTMLCanvasElement>) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
            return;
        }

        const draft = draftRef.current;
        setDrawing(false);
        draftRef.current = null;

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        if (draft) {
            commit({ ...boardRef.current, elements: [...boardRef.current.elements, draft] });
        }
    };
    const exportPng = async () => {
        if (!canvasRef.current) {
            return;
        }

        setExporting(true);
        setMessage("");

        try {
            drawBoard(canvasRef.current, board);
            const result = await contextBridge.invokeExtension<unknown, { exported: boolean }>("Whiteboard", {
                command: "export",
                png: canvasRef.current.toDataURL("image/png"),
            });

            if (result.exported) {
                setMessage("PNG exported.");
            }
        } catch {
            setMessage("Could not export PNG. Choose another location and retry.");
        } finally {
            setExporting(false);
        }
    };

    return (
        <BaseLayout
            header={
                <Header
                    draggable
                    contentBefore={
                        <Button
                            className="non-draggable-area"
                            aria-label="Back to launcher"
                            appearance="subtle"
                            icon={<ArrowLeftRegular />}
                            onClick={goBack}
                        />
                    }
                >
                    <strong>Whiteboard</strong>
                </Header>
            }
            content={
                <div className="wb-studio">
                    <div className="wb-toolbar" role="toolbar" aria-label="Whiteboard tools">
                        <div className="wb-tools">
                            <button disabled={!ready} aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>
                                Pen
                            </button>
                            <button disabled={!ready} aria-pressed={tool === "erase"} onClick={() => setTool("erase")}>
                                Eraser
                            </button>
                            <button disabled={!ready} aria-pressed={tool === "note"} onClick={() => setTool("note")}>
                                Notes
                            </button>
                        </div>
                        <label className="wb-width">
                            Width
                            <select
                                aria-label="Pen width"
                                value={width}
                                onChange={(event) => setWidth(Number(event.target.value))}
                            >
                                {[2, 4, 8, 12].map((value) => (
                                    <option key={value} value={value}>
                                        {value} px
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="wb-colors" aria-label="Pen colors">
                            {PEN_COLORS.map((value, index) => (
                                <button
                                    key={value}
                                    aria-label={`Pen color ${["Graphite", "Blue", "Green", "Rose", "Amber"][index]}`}
                                    aria-pressed={color === value}
                                    onClick={() => setColor(value)}
                                >
                                    <span style={{ background: value }} />
                                    {color === value && <small aria-hidden="true">&#10003;</small>}
                                </button>
                            ))}
                        </div>
                        <Button
                            disabled={!ready || !history.past.length}
                            title="Undo (Ctrl+Z)"
                            aria-label="Undo"
                            icon={<ArrowUndoRegular />}
                            onClick={() => travel("undo")}
                        />
                        <Button
                            disabled={!ready || !history.future.length}
                            title="Redo (Ctrl+Shift+Z)"
                            aria-label="Redo"
                            icon={<ArrowRedoRegular />}
                            onClick={() => travel("redo")}
                        />
                        <Button disabled={!ready} onClick={() => addNote()}>
                            Add note
                        </Button>
                    </div>
                    <div className="wb-workspace">
                        <div className="wb-paper">
                            <canvas
                                ref={canvasRef}
                                width={BOARD_WIDTH}
                                height={BOARD_HEIGHT}
                                aria-label="Whiteboard canvas. Use the pen to draw or add a text note with the toolbar."
                                onPointerDown={pointerDown}
                                onPointerMove={pointerMove}
                                onPointerUp={finishStroke}
                                onPointerCancel={() => {
                                    setDrawing(false);
                                    draftRef.current = null;

                                    if (canvasRef.current) {
                                        drawBoard(canvasRef.current, board);
                                    }
                                }}
                            />
                            {!board.elements.length && !drawing && (
                                <div className="wb-empty">
                                    <strong>A little space to think.</strong>
                                    <span>Draw with the pen or add a note. Everything stays on this device.</span>
                                </div>
                            )}
                        </div>
                        {(selectedNote || notes.length > 0) && (
                            <aside className="wb-notes" aria-label="Text notes">
                                <h2>Notes</h2>
                                <select
                                    aria-label="Choose a note to edit"
                                    value={selected ?? ""}
                                    onChange={(event) => setSelected(event.target.value)}
                                >
                                    <option value="">Choose a note</option>
                                    {notes.map((note, index) => (
                                        <option key={note.id} value={note.id}>
                                            {note.text.slice(0, 24) || `Note ${index + 1}`}
                                        </option>
                                    ))}
                                </select>
                                {selectedNote && (
                                    <>
                                        <Textarea
                                            ref={noteInput}
                                            aria-label="Note text"
                                            value={noteText}
                                            maxLength={BOARD_LIMITS.noteText}
                                            rows={6}
                                            onChange={(_, data) => setNoteText(data.value)}
                                        />
                                        <span>
                                            {noteText.length}/{BOARD_LIMITS.noteText}
                                        </span>
                                        <Button
                                            onClick={() =>
                                                commit({
                                                    ...board,
                                                    elements: board.elements.map((item) =>
                                                        item.id === selected
                                                            ? { ...selectedNote, text: noteText }
                                                            : item,
                                                    ),
                                                })
                                            }
                                        >
                                            Save note
                                        </Button>
                                        <Button
                                            onClick={() => {
                                                commit({
                                                    ...board,
                                                    elements: board.elements.filter((item) => item.id !== selected),
                                                });
                                                setSelected(null);
                                            }}
                                        >
                                            Delete note
                                        </Button>
                                    </>
                                )}
                            </aside>
                        )}
                    </div>
                    {message && (
                        <p className="wb-message" role="status">
                            {message}
                        </p>
                    )}
                    {clearOpen && (
                        <div className="wb-confirm" role="alertdialog" aria-label="Clear whiteboard">
                            <span>Clear every mark and note? You can undo this while the board stays open.</span>
                            <Button
                                onClick={() => {
                                    commit(emptyBoard());
                                    setSelected(null);
                                    setClearOpen(false);
                                }}
                            >
                                Clear board
                            </Button>
                            <Button autoFocus onClick={() => setClearOpen(false)}>
                                Keep board
                            </Button>
                        </div>
                    )}
                </div>
            }
            footer={
                <div className="wb-footer">
                    <span role="status">{noteDirty ? "Note edits are not saved. Choose Save note." : saveState}</span>
                    <div>
                        <Button className="wb-save" disabled={!ready || noteDirty} onClick={() => persist(board)}>
                            Save
                        </Button>
                        <Button
                            className="wb-clear"
                            disabled={!ready || !board.elements.length}
                            onClick={() => setClearOpen(true)}
                        >
                            Clear...
                        </Button>
                        <Button
                            className="wb-export"
                            disabled={!ready || exporting || noteDirty}
                            icon={<ArrowDownloadRegular />}
                            onClick={exportPng}
                        >
                            {exporting ? "Exporting..." : "Export PNG"}
                        </Button>
                    </div>
                </div>
            }
            onKeyDown={(event) => {
                const editing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;

                if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
                    event.preventDefault();
                    travel(event.shiftKey ? "redo" : "undo");
                }

                if (event.key === "Escape") {
                    if (clearOpen) {
                        setClearOpen(false);
                    } else {
                        goBack();
                    }
                }
            }}
        />
    );
};
