import type { InstantSearchResultItems, SearchResultItem } from "@common/Core";
import { describe, expect, it } from "vitest";
import { getSearchResult } from "./getSearchResult";

describe(getSearchResult, () => {
    it("keeps favorites first, followed by most used items on the empty launcher", () => {
        const items = [
            { id: "a", name: "Alpha" },
            { id: "b", name: "Beta" },
            { id: "z", name: "Zulu" },
        ] as SearchResultItem[];
        const result = getSearchResult({
            searchEngineId: "fuzzysort",
            favoriteSearchResultItemIds: ["b"],
            excludedSearchResultItemIds: [],
            instantSearchResultItems: { before: [], after: [] },
            searchResultItems: items,
            searchTerm: "",
            fuzziness: 0.5,
            maxSearchResultItems: 2,
            itemUsage: { a: 1, b: 2, z: 10 },
        });
        expect(
            Object.values(result)
                .flat()
                .map(({ id }) => id),
        ).toEqual(["b", "z", "a"]);
    });

    it("does not override explicit search relevance with usage counts", () => {
        const args = {
            searchEngineId: "fuzzysort" as const,
            favoriteSearchResultItemIds: [],
            excludedSearchResultItemIds: [],
            instantSearchResultItems: { before: [], after: [] },
            searchResultItems: [
                { id: "a", name: "Notes" },
                { id: "b", name: "Notepad" },
            ] as SearchResultItem[],
            searchTerm: "Notes",
            fuzziness: 0.5,
            maxSearchResultItems: 20,
        };
        expect(getSearchResult({ ...args, itemUsage: { b: 1000 } })).toEqual(getSearchResult(args));
    });
    it("should return an array of instant search result items, favorites and other matches if a search term is given", () => {
        const instantSearchResultItems: InstantSearchResultItems = {
            before: <SearchResultItem[]>[
                { id: "instant1-before", name: "Instant Item 1 before" },
                { id: "instant2-before", name: "Instant Item 2 before" },
                { id: "instant3-before", name: "Instant Item 3 before" },
            ],
            after: <SearchResultItem[]>[
                { id: "instant1-after", name: "Instant Item 1 after" },
                { id: "instant2-after", name: "Instant Item 2 after" },
                { id: "instant3-after", name: "Instant Item 3 after" },
            ],
        };

        const searchResultItems = <SearchResultItem[]>[
            { id: "item1", name: "Item 1" },
            { id: "item2", name: "Item 2" },
            { id: "item3", name: "Item 3" },
            { id: "invalid4", name: "Invalid 4" },
            { id: "invalid5", name: "Invalid 5" },
        ];

        const excludedItemIds = ["item1"];

        const actual = getSearchResult({
            searchEngineId: "Fuse.js",
            favoriteSearchResultItemIds: ["item3"],
            excludedSearchResultItemIds: excludedItemIds,
            instantSearchResultItems,
            searchResultItems,
            searchTerm: "item",
            fuzziness: 0.5,
            maxSearchResultItems: 5,
        });

        expect(actual).toEqual({
            favorites: [{ id: "item3", name: "Item 3" }],
            searchResults: [
                ...instantSearchResultItems.before,
                { id: "item2", name: "Item 2" },
                ...instantSearchResultItems.after,
            ],
        });
    });

    it("should return a list of favorites and other items (sorted alphabetically) if no search term is given", () => {
        const item1 = <SearchResultItem>{ id: "item1", name: "Item 1" };
        const item2 = <SearchResultItem>{ id: "item2", name: "Item 2" };
        const item3 = <SearchResultItem>{ id: "item3", name: "Item 3" };
        const item4 = <SearchResultItem>{ id: "item4", name: "Item 4" };
        const item5 = <SearchResultItem>{ id: "item5", name: "Item 5" };

        const actual = getSearchResult({
            searchEngineId: "fuzzysort",
            favoriteSearchResultItemIds: ["item2", "item3"],
            excludedSearchResultItemIds: ["item1"],
            instantSearchResultItems: {
                before: <SearchResultItem[]>[
                    { id: "instant1-before", name: "Instant Item 1 before" },
                    { id: "instant2-before", name: "Instant Item 2 before" },
                    { id: "instant3-before", name: "Instant Item 3 before" },
                ],
                after: <SearchResultItem[]>[
                    { id: "instant1-after", name: "Instant Item 1 after" },
                    { id: "instant2-after", name: "Instant Item 2 after" },
                    { id: "instant3-after", name: "Instant Item 3 after" },
                ],
            },
            searchResultItems: [item5, item1, item3, item2, item4],
            searchTerm: "",
            fuzziness: 0, // will be ignored
            maxSearchResultItems: 3,
        });

        expect(actual).toEqual({
            favorites: [item2, item3],
            searchResults: [item4, item5],
        });
    });
});
