import { Text } from "@fluentui/react-components";
import type { ReactNode } from "react";

type SectionListProps = {
    title?: string;
    children?: ReactNode;
};

export const SettingGroup = ({ title, children }: SectionListProps) => {
    return (
        <div
            className="studio-setting-group"
            style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
            }}
        >
            {title && (
                <Text className="studio-setting-group-title" weight="semibold" size={400}>
                    {title}
                </Text>
            )}
            {children}
        </div>
    );
};
