import { Body1, Caption1 } from "@fluentui/react-components";
import type { ReactElement } from "react";

type SettingSectionProps = {
    label: string;
    description?: string;
    control: ReactElement;
};

export const Setting = ({ control, label, description }: SettingSectionProps) => {
    return (
        <div className="studio-setting-row">
            <div
                className="studio-setting-row-inner"
                style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div className="studio-setting-label" style={{ flex: "1 1 0" }}>
                    <div>
                        <Body1>{label}</Body1>
                    </div>
                    <div style={{ textWrap: "wrap" }}>
                        <Caption1>{description}</Caption1>
                    </div>
                </div>
                <div className="studio-setting-control" style={{ flex: "0 0 auto" }}>
                    {control}
                </div>
            </div>
        </div>
    );
};
