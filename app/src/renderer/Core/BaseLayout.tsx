import type { KeyboardEvent, ReactNode, RefObject } from "react";

type BaseLayoutProps = {
    header?: ReactNode;
    contentRef?: RefObject<HTMLDivElement | null>;
    content: ReactNode;
    footer?: ReactNode;
    onKeyDown?: (event: KeyboardEvent) => void;
};

export const BaseLayout = ({ header, content, contentRef, footer, onKeyDown }: BaseLayoutProps) => {
    return (
        <div className="studio-layout" onKeyDown={onKeyDown} tabIndex={-1}>
            {header}
            <div className="studio-content" ref={contentRef}>
                {content}
            </div>
            {footer}
        </div>
    );
};
