import { BOARD_HEIGHT, BOARD_WIDTH, type Board, type Point } from "@common/Extensions/Whiteboard/Board";

export const drawBoard = (canvas: HTMLCanvasElement, board: Board) => {
    const ctx = canvas.getContext("2d");

    if (!ctx) {
        return;
    }

    const scale = canvas.getBoundingClientRect().width / BOARD_WIDTH;
    const noteFontSize = Math.min(40, Math.max(24, Math.ceil(14 / (scale || 1))));
    const noteLineHeight = Math.ceil(noteFontSize * 1.25);
    const noteLineCount = Math.max(1, Math.floor(110 / noteLineHeight));

    ctx.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.fillStyle = "#fafbfc";
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const item of board.elements) {
        if (item.kind === "stroke") {
            ctx.strokeStyle = item.color;
            ctx.fillStyle = item.color;
            ctx.lineWidth = item.width;
            ctx.beginPath();

            if (item.points.length === 1) {
                ctx.arc(item.points[0].x, item.points[0].y, item.width / 2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                item.points.forEach((point, index) =>
                    index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y),
                );
                ctx.stroke();
            }
        } else {
            ctx.fillStyle = item.color;
            ctx.beginPath();
            ctx.roundRect(item.x, item.y, 220, 140, 14);
            ctx.fill();
            ctx.fillStyle = "#27313f";
            ctx.font = `400 ${noteFontSize}px ${getComputedStyle(canvas).fontFamily}`;
            ctx.textBaseline = "top";
            const lines: string[] = [];

            for (const paragraph of (item.text || "New note").split("\n")) {
                let line = "";

                for (const word of paragraph.split(/\s+/)) {
                    const candidate = line ? line + " " + word : word;

                    if (ctx.measureText(candidate).width <= 190) {
                        line = candidate;
                        continue;
                    }

                    if (line) {
                        lines.push(line);
                        line = "";
                    }

                    for (const character of word) {
                        if (line && ctx.measureText(line + character).width > 190) {
                            lines.push(line);
                            line = "";
                        }

                        line += character;
                    }
                }

                lines.push(line);
            }

            lines
                .slice(0, noteLineCount)
                .forEach((line, index) =>
                    ctx.fillText(
                        index === noteLineCount - 1 && lines.length > noteLineCount ? line.slice(0, -2) + "..." : line,
                        item.x + 15,
                        item.y + 15 + index * noteLineHeight,
                    ),
                );
        }
    }
};

const distanceToSegment = (p: Point, a: Point, b: Point) => {
    const length = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length)) : 0;
    return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
};
export const hitElement = (board: Board, point: Point) =>
    [...board.elements]
        .reverse()
        .find((item) =>
            item.kind === "note"
                ? point.x >= item.x && point.x <= item.x + 220 && point.y >= item.y && point.y <= item.y + 140
                : item.points.some(
                      (p, index) => distanceToSegment(point, p, item.points[index + 1] ?? p) <= item.width / 2 + 10,
                  ),
        );
