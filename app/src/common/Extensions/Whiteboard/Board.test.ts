import { describe, expect, it } from "vitest";
import {
    BOARD_LIMITS,
    commitBoard,
    createHistory,
    emptyBoard,
    redoBoard,
    undoBoard,
    validateBoard,
    type Board,
    type Note,
} from "./Board";
const note = (id = "note-1", text = "Keep the date 4 October"): Note => ({
    id,
    kind: "note",
    color: "#fff0bb",
    x: 10,
    y: 20,
    text,
});
const withNote = (id = "note-1"): Board => ({ version: 1, elements: [note(id)] });

describe("Whiteboard data and history", () => {
    it("round-trips persisted notes and strokes without aliasing input points", () => {
        const source: Board = {
            version: 1,
            elements: [
                note(),
                {
                    id: "stroke-1",
                    kind: "stroke",
                    color: "#27313f",
                    width: 4,
                    points: [
                        { x: 1, y: 2 },
                        { x: 15, y: 8 },
                    ],
                },
            ],
        };
        const parsed = validateBoard(JSON.parse(JSON.stringify(source)));
        expect(parsed).toEqual(source);
        expect(parsed?.elements[1]).not.toBe(source.elements[1]);
    });
    it("rejects invalid coordinates, unknown colors, duplicate ids and oversized notes", () => {
        expect(validateBoard({ version: 1, elements: [note(), note()] })).toBeNull();
        expect(validateBoard({ version: 1, elements: [{ ...note(), x: NaN }] })).toBeNull();
        expect(validateBoard({ version: 1, elements: [{ ...note(), color: "url(https://example.com)" }] })).toBeNull();
        expect(validateBoard({ version: 1, elements: [note("long", "x".repeat(601))] })).toBeNull();
    });
    it("enforces total points, element count and UTF-8 storage bytes", () => {
        const stroke = {
            id: "s",
            kind: "stroke",
            color: "#27313f",
            width: 4,
            points: Array.from({ length: 1500 }, () => ({ x: 2, y: 3 })),
        };
        expect(
            validateBoard({ version: 1, elements: Array.from({ length: 5 }, (_, i) => ({ ...stroke, id: `s-${i}` })) }),
        ).toBeNull();
        expect(
            validateBoard({ version: 1, elements: Array.from({ length: 201 }, (_, i) => note(`n-${i}`)) }),
        ).toBeNull();
        expect(
            validateBoard({
                version: 1,
                elements: Array.from({ length: 200 }, (_, i) => note(`n-${i}`, "漢".repeat(600))),
            }),
        ).toBeNull();
    });
    it("undoes clear and discards the redo branch after a new edit", () => {
        const drawing = commitBoard(createHistory(), withNote());
        const cleared = commitBoard(drawing, emptyBoard());
        const restored = undoBoard(cleared);
        expect(restored.present).toEqual(withNote());
        expect(redoBoard(restored).present).toEqual(emptyBoard());
        expect(commitBoard(restored, withNote("new-note")).future).toEqual([]);
    });
    it("bounds history and ignores invalid commits without losing the current board", () => {
        let history = createHistory();

        for (let i = 0; i < 30; i++) {
            history = commitBoard(history, withNote(`n-${i}`));
        }

        expect(history.past).toHaveLength(BOARD_LIMITS.history);
        expect(commitBoard(history, { version: 2, elements: [] } as unknown as Board)).toBe(history);
    });
});
