import type { BrowserWindow, Rectangle } from "electron";
import { describe, expect, it, vi } from "vitest";
import { applyRoundedWindowRegion, roundedWindowRegion } from "./roundedWindowRegion";

const contains = (rectangles: Rectangle[], x: number, y: number) =>
    rectangles.some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);

describe("native rounded window region", () => {
    it("reports native clipping failure once without crashing initialization or resize", () => {
        let resize = () => undefined;
        const onFailure = vi.fn();
        const setShape = vi.fn(() => {
            throw new Error("unsupported");
        });
        const window = {
            getSize: () => [680, 480],
            setShape,
            isDestroyed: () => false,
            on: (_event: string, callback: () => undefined) => {
                resize = callback;
            },
        };
        expect(() => applyRoundedWindowRegion(window as unknown as BrowserWindow, onFailure)).not.toThrow();
        expect(() => resize()).not.toThrow();
        expect(onFailure).toHaveBeenCalledOnce();
        expect(setShape).toHaveBeenCalledOnce();
    });
    it.each([
        [680, 480],
        [680, 700],
        [940, 700],
        [2, 2],
        [1, 1],
        [13, 11],
    ])("bounds and mirrors the %i by %i window", (width, height) => {
        const region = roundedWindowRegion(width, height);
        expect(region.length).toBeLessThanOrEqual(41);
        expect(contains(region, Math.floor(width / 2), Math.floor(height / 2))).toBe(true);

        for (const rect of region) {
            expect(Object.values(rect).every(Number.isInteger)).toBe(true);
            expect(rect.x).toBeGreaterThanOrEqual(0);
            expect(rect.y).toBeGreaterThanOrEqual(0);
            expect(rect.width).toBeGreaterThan(0);
            expect(rect.height).toBeGreaterThan(0);
            expect(rect.x + rect.width).toBeLessThanOrEqual(width);
            expect(rect.y + rect.height).toBeLessThanOrEqual(height);
            expect(rect.x).toBe(width - rect.x - rect.width);
            expect(region).toContainEqual({ ...rect, y: height - rect.y - rect.height });
        }
    });

    it("excludes every outer corner while keeping edge centers", () => {
        const region = roundedWindowRegion(680, 480);

        for (const [x, y] of [
            [0, 0],
            [679, 0],
            [0, 479],
            [679, 479],
        ]) {
            expect(contains(region, x, y)).toBe(false);
        }

        for (const [x, y] of [
            [340, 0],
            [340, 479],
            [0, 240],
            [679, 240],
        ]) {
            expect(contains(region, x, y)).toBe(true);
        }
    });

    it("bounds malformed dimensions and excessive radius without unbounded allocation", () => {
        expect(roundedWindowRegion(NaN, Infinity)).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
        expect(roundedWindowRegion(-2, 0)).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
        expect(roundedWindowRegion(1000, 1000, Number.MAX_SAFE_INTEGER).length).toBeLessThanOrEqual(513);
        expect(roundedWindowRegion(12.9, 8.9, -1)).toEqual([{ x: 0, y: 0, width: 12, height: 8 }]);
    });

    it("uses current size on initialization and each resize, skips destroyed windows", () => {
        let callback = () => undefined;
        const getSize = vi.fn().mockReturnValue([680, 480]);
        const setShape = vi.fn();
        const isDestroyed = vi.fn().mockReturnValue(false);
        const on = vi.fn((_event, handler) => {
            callback = handler;
        });
        applyRoundedWindowRegion({ getSize, setShape, isDestroyed, on } as unknown as BrowserWindow);
        expect(on).toHaveBeenCalledWith("resize", expect.any(Function));
        expect(setShape).toHaveBeenLastCalledWith(roundedWindowRegion(680, 480));
        getSize.mockReturnValue([940, 700]);
        callback();
        expect(setShape).toHaveBeenLastCalledWith(roundedWindowRegion(940, 700));
        isDestroyed.mockReturnValue(true);
        callback();
        expect(setShape).toHaveBeenCalledTimes(2);
    });
});
