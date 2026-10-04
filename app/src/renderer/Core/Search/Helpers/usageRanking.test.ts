import type { SearchResultItem } from "@common/Core";
import { describe, expect, it } from "vitest";
import { incrementItemUsage, maxUsageEntries, rankByUsage, readItemUsage } from "./usageRanking";

describe("launcher usage ranking", () => {
    it("ranks frequent items before alphabetical unused items without mutating the source", () => {
        const items = [
            { id: "a", name: "Alpha" },
            { id: "z", name: "Zulu" },
            { id: "b", name: "Beta" },
        ] as SearchResultItem[];
        expect(rankByUsage(items, { z: 3 }).map(({ id }) => id)).toEqual(["z", "a", "b"]);
        expect(items.map(({ id }) => id)).toEqual(["a", "z", "b"]);
    });

    it("reloads persisted counts and increments the same item", () => {
        const persisted = JSON.parse(JSON.stringify(incrementItemUsage({}, "app")));
        expect(incrementItemUsage(persisted, "app")).toEqual({ app: 2 });
    });

    it("rejects corrupted settings and invalid counts", () => {
        expect(readItemUsage(null)).toEqual({});
        expect(readItemUsage([])).toEqual({});
        expect(readItemUsage({ a: -1, b: "9", c: Infinity, d: 1.2, e: 2 })).toEqual({ e: 2 });
    });

    it("bounds storage while making room for a newly used item", () => {
        const full = Object.fromEntries(Array.from({ length: maxUsageEntries + 50 }, (_, i) => [`app-${i}`, 1]));
        const next = incrementItemUsage(full, "new-app");
        expect(Object.keys(next)).toHaveLength(maxUsageEntries);
        expect(next["new-app"]).toBe(1);
    });

    it("handles inherited property names as plain item IDs", () => {
        expect(incrementItemUsage({}, "constructor")).toEqual({ constructor: 1 });
        expect(Object.hasOwn(incrementItemUsage({}, "__proto__"), "__proto__")).toBe(true);
    });
});
