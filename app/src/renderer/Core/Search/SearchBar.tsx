import { Input } from "@fluentui/react-components";
import { SearchRegular } from "@fluentui/react-icons";
import { useContext, type ChangeEvent, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import { ThemeContext } from "../Theme/ThemeContext";
import type { SearchBarAppearance } from "./SearchBarAppearance";
import type { SearchBarSize } from "./SearchBarSize";

type SearchBarProps = {
    refObject?: RefObject<HTMLInputElement | null>;
    searchTerm?: string;
    onSearchTermUpdated?: (searchTerm: string) => void;
    onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
    contentAfter?: ReactElement;
    searchBarSize: SearchBarSize;
    searchBarAppearance: SearchBarAppearance;
    searchBarPlaceholderText: string;
    showIcon: boolean;
    activeResultId?: string;
    resultsListId?: string;
};

export const SearchBar = ({
    searchTerm,
    onSearchTermUpdated,
    refObject,
    onKeyDown,
    contentAfter,
    searchBarAppearance,
    searchBarPlaceholderText,
    searchBarSize,
    showIcon,
    activeResultId,
    resultsListId,
}: SearchBarProps) => {
    const { shouldUseDarkColors } = useContext(ThemeContext);

    const onChange = onSearchTermUpdated
        ? (_: ChangeEvent<HTMLInputElement>, { value }: { value: string }) => onSearchTermUpdated(value)
        : undefined;

    return (
        <Input
            className="studio-search-input non-draggable-area"
            aria-label={searchBarPlaceholderText}
            input={
                resultsListId
                    ? {
                          role: "combobox",
                          "aria-expanded": Boolean(activeResultId),
                          "aria-controls": activeResultId ? resultsListId : undefined,
                          "aria-activedescendant": activeResultId
                              ? `studio-result-${encodeURIComponent(activeResultId)}`
                              : undefined,
                          "aria-autocomplete": "list",
                      }
                    : undefined
            }
            ref={refObject}
            appearance={
                searchBarAppearance === "auto"
                    ? shouldUseDarkColors
                        ? "filled-darker"
                        : "filled-lighter"
                    : searchBarAppearance
            }
            size={searchBarSize}
            value={searchTerm}
            onChange={onChange}
            onKeyDown={onKeyDown}
            contentBefore={showIcon ? <SearchRegular /> : undefined}
            contentAfter={contentAfter}
            placeholder={searchBarPlaceholderText}
        />
    );
};
