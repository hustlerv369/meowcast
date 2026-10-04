import type { SearchResultItem } from "@common/Core";

export const getPreviousSearchResultItemId = (
    currentlySelectedItemId: string,
    searchResultItems: SearchResultItem[],
): string => {
    if (searchResultItems.length === 0) {
        return "";
    }

    const currentIndex = searchResultItems.findIndex(
        (searchResultItem) => searchResultItem.id === currentlySelectedItemId,
    );

    if (currentIndex <= 0) {
        return searchResultItems[searchResultItems.length - 1].id;
    }

    return searchResultItems[currentIndex - 1].id;
};
