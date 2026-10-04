import { ClipboardControls } from "@Core/Components/ClipboardControls";
import { MeowmateAutostart } from "@Core/Settings/Pages/General/MeowmateAutostart";
import { SettingGroup } from "@Core/Settings/SettingGroup";
import { Link } from "react-router";

export const ClipboardHistorySettings = () => (
    <SettingGroup title="Clipboard History">
        <p>
            Search saved copies with <kbd>cb</kbd> in the launcher. Recording starts only after you enable it.
        </p>
        <ClipboardControls inline />
    </SettingGroup>
);

export const MeowmateSettings = () => (
    <SettingGroup title="Meowmate">
        <MeowmateAutostart />
        <p>
            Choose the companion theme, dock visibility and AI connections inside Meowmate. Its connections are separate
            from the launcher.
        </p>
        <Link to="/">General startup and shortcut settings</Link>
    </SettingGroup>
);

const guides = {
    EmojiPicker: {
        title: "Emoji Picker",
        description:
            "Type a colon and an emoji name in the launcher, such as :smile. Select a result to copy it. There are no separate emoji preferences in this preview.",
    },
    Notes: {
        title: "Notes",
        description:
            "Open Notes from the launcher to create, search and edit your local notes. Changes save automatically. There are no separate notebook preferences in this preview.",
    },
    UeliCommand: {
        title: "Meowcast Commands",
        description:
            "These built-in commands open settings, rescan applications and control the launcher. Configure startup and the launcher shortcut in General settings.",
    },
    Whiteboard: {
        title: "Whiteboard",
        description:
            "Open Whiteboard from the launcher. Pen color, drawing tools, sticky notes and PNG export are in its toolbar. There are no separate whiteboard preferences in this preview.",
    },
};

export const BuiltInToolSettings = ({ extensionId }: { extensionId: keyof typeof guides }) => {
    const guide = guides[extensionId];
    return (
        <SettingGroup title={guide.title}>
            <p>{guide.description}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Link to="/">General startup and shortcut settings</Link>
                <Link to="/appearance">Appearance settings</Link>
                <Link to="/extensions">Enable or disable tools</Link>
            </div>
        </SettingGroup>
    );
};
