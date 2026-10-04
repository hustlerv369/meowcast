import type { SearchResultItem } from "@common/Core";
import { tokens } from "@fluentui/react-components";
import { useEffect, useRef, useState, type RefObject } from "react";
import { CompactSearchResultListItem } from "./CompactSearchResultListItem";
import { DetailedSearchResultListItem } from "./DetailedSearchResultItem";
import { FavoriteButton } from "./FavoriteButton";
import { elementIsVisible } from "./Helpers";
import type { SearchResultListLayout } from "./SearchResultListLayout";

type SearchResultListItemProps = {
    containerRef: RefObject<HTMLDivElement | null>;
    isSelected: boolean;
    onClick: () => void;
    onDoubleClick: () => void;
    layout: SearchResultListLayout;
    searchResultItem: SearchResultItem;
    scrollBehavior: ScrollBehavior;
    dragAndDropEnabled: boolean;
    isFavorite?: boolean;
};

export const SearchResultListItem = ({
    containerRef,
    isSelected,
    onClick,
    onDoubleClick,
    searchResultItem,
    scrollBehavior,
    layout,
    dragAndDropEnabled,
    isFavorite = false,
}: SearchResultListItemProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState<boolean>(false);

    const scrollIntoViewIfSelectedAndNotVisible = () => {
        if (containerRef.current && ref.current && isSelected && !elementIsVisible(ref.current, containerRef.current)) {
            ref.current?.scrollIntoView({
                behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : scrollBehavior,
                block: "nearest",
            });
        }
    };

    const selectedBackgroundColor = tokens.colorNeutralBackground1Selected;
    const hoveredBackgroundColor = tokens.colorNeutralBackground1Hover;

    useEffect(() => {
        scrollIntoViewIfSelectedAndNotVisible();
    }, [isSelected]);

    return (
        <div
            className="studio-result"
            data-selected={isSelected}
            role="option"
            aria-selected={isSelected}
            id={`studio-result-${encodeURIComponent(searchResultItem.id)}`}
            ref={ref}
            key={searchResultItem.id}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            draggable={dragAndDropEnabled && searchResultItem.dragAndDrop !== undefined}
            onDragStart={({ preventDefault }) => {
                if (dragAndDropEnabled && searchResultItem.dragAndDrop) {
                    preventDefault();
                    window.ContextBridge.ipcRenderer.send("dragStarted", searchResultItem.dragAndDrop);
                }
            }}
            style={{
                position: "relative",
                backgroundColor: isSelected ? selectedBackgroundColor : isHovered ? hoveredBackgroundColor : undefined,
                userSelect: "none",
                borderRadius: tokens.borderRadiusMedium,
                cursor: "pointer",
            }}
        >
            {layout === "compact" && <CompactSearchResultListItem searchResultItem={searchResultItem} />}
            {layout === "detailed" && <DetailedSearchResultListItem searchResultItem={searchResultItem} />}
            <FavoriteButton id={searchResultItem.id} name={searchResultItem.name} isFavorite={isFavorite} />
        </div>
    );
};
