import { createAddToFavoritesAction, createRemoveFromFavoritesAction } from "@common/Core";
import { Star20Filled, Star20Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export const FavoriteButton = ({ id, name, isFavorite }: { id: string; name: string; isFavorite: boolean }) => {
    const { t } = useTranslation();
    const [pending, setPending] = useState(false);
    const [failed, setFailed] = useState(false);
    const label = t(isFavorite ? "removeFromFavorites" : "addToFavorites", { ns: "searchResultItemAction" });

    return (
        <button
            type="button"
            className="studio-favorite-button non-draggable-area"
            aria-label={`${label}: ${name}`}
            aria-pressed={isFavorite}
            disabled={pending}
            title={failed ? "Could not save favorite. Try again." : label}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={async (event) => {
                event.stopPropagation();
                setPending(true);
                setFailed(false);

                try {
                    const saved = await window.ContextBridge.invokeAction(
                        isFavorite ? createRemoveFromFavoritesAction({ id }) : createAddToFavoritesAction({ id }),
                    );

                    if (!saved) {
                        setFailed(true);
                    }
                } catch {
                    setFailed(true);
                } finally {
                    setPending(false);
                }
            }}
        >
            {isFavorite ? <Star20Filled aria-hidden="true" /> : <Star20Regular aria-hidden="true" />}
            {failed && (
                <span role="alert" className="studio-favorite-error">
                    Could not save favorite. Try again.
                </span>
            )}
        </button>
    );
};
