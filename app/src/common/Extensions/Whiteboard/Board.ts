export const BOARD_WIDTH = 1200;
export const BOARD_HEIGHT = 760;
export const BOARD_LIMITS = {
    elements: 200,
    points: 6000,
    strokePoints: 1500,
    noteText: 600,
    bytes: 256000,
    history: 20,
};
export const PEN_COLORS = ["#27313f", "#4466a8", "#3b7968", "#ad4f66", "#9a702c"] as const;
export const NOTE_COLORS = ["#fff0bb", "#d9eee5", "#e4eafb", "#f6dfe6"] as const;
export type Point = { x: number; y: number };
export type Stroke = { id: string; kind: "stroke"; color: string; width: number; points: Point[] };
export type Note = { id: string; kind: "note"; color: string; x: number; y: number; text: string };
export type BoardElement = Stroke | Note;
export type Board = { version: 1; elements: BoardElement[] };
export type BoardHistory = { past: Board[]; present: Board; future: Board[] };
export const emptyBoard = (): Board => ({ version: 1, elements: [] });
export const createHistory = (board = emptyBoard()): BoardHistory => ({ past: [], present: board, future: [] });
const coordinate = (value: unknown, max: number): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;

export const validateBoard = (value: unknown): Board | null => {
    if (!value || typeof value !== "object") {
        return null;
    }

    const board = value as Partial<Board>;

    if (board.version !== 1 || !Array.isArray(board.elements) || board.elements.length > BOARD_LIMITS.elements) {
        return null;
    }

    const ids = new Set<string>();
    const elements: BoardElement[] = [];
    let points = 0;

    for (const entry of board.elements) {
        if (
            !entry ||
            typeof entry !== "object" ||
            typeof entry.id !== "string" ||
            !/^[\w-]{1,80}$/.test(entry.id) ||
            ids.has(entry.id)
        ) {
            return null;
        }

        ids.add(entry.id);

        if (entry.kind === "stroke") {
            if (
                !(PEN_COLORS as readonly string[]).includes(entry.color) ||
                !Number.isInteger(entry.width) ||
                entry.width < 1 ||
                entry.width > 16 ||
                !Array.isArray(entry.points) ||
                entry.points.length < 1 ||
                entry.points.length > BOARD_LIMITS.strokePoints
            ) {
                return null;
            }

            points += entry.points.length;

            if (
                points > BOARD_LIMITS.points ||
                entry.points.some((p) => !p || !coordinate(p.x, BOARD_WIDTH) || !coordinate(p.y, BOARD_HEIGHT))
            ) {
                return null;
            }

            elements.push({
                id: entry.id,
                kind: "stroke",
                color: entry.color,
                width: entry.width,
                points: entry.points.map((p) => ({ x: p.x, y: p.y })),
            });
        } else if (entry.kind === "note") {
            if (
                !(NOTE_COLORS as readonly string[]).includes(entry.color) ||
                !coordinate(entry.x, BOARD_WIDTH - 220) ||
                !coordinate(entry.y, BOARD_HEIGHT - 140) ||
                typeof entry.text !== "string" ||
                entry.text.length > BOARD_LIMITS.noteText
            ) {
                return null;
            }

            elements.push({ id: entry.id, kind: "note", color: entry.color, x: entry.x, y: entry.y, text: entry.text });
        } else {
            return null;
        }
    }

    const result: Board = { version: 1, elements };
    return new TextEncoder().encode(JSON.stringify(result)).byteLength <= BOARD_LIMITS.bytes ? result : null;
};

export const commitBoard = (history: BoardHistory, next: Board): BoardHistory => {
    const board = validateBoard(next);

    if (!board || JSON.stringify(history.present) === JSON.stringify(board)) {
        return history;
    }

    return { past: [...history.past, history.present].slice(-BOARD_LIMITS.history), present: board, future: [] };
};
export const undoBoard = (history: BoardHistory): BoardHistory =>
    history.past.length
        ? {
              past: history.past.slice(0, -1),
              present: history.past[history.past.length - 1],
              future: [history.present, ...history.future].slice(0, BOARD_LIMITS.history),
          }
        : history;
export const redoBoard = (history: BoardHistory): BoardHistory =>
    history.future.length
        ? {
              past: [...history.past, history.present].slice(-BOARD_LIMITS.history),
              present: history.future[0],
              future: history.future.slice(1),
          }
        : history;
