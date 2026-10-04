import darkIcon from "../../../../assets/Core/AppIconFilePathResolver/app-icon-dark.png";

/** Canonical cat-head mark, with no tile or background behind its transparent silhouette. */
export const StudioWordmark = ({ iconUrl }: { iconUrl?: string }) => {
    return (
        <span className="studio-wordmark">
            <span
                className="studio-brand-icon"
                style={{ maskImage: `url("${iconUrl ?? darkIcon}")` }}
                aria-hidden="true"
            />
            Meowcast
        </span>
    );
};
