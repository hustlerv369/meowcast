import { StudioAppearance } from "@Core/Theme/StudioAppearance";
import { SettingGroup } from "../../SettingGroup";
import { SettingGroupList } from "../../SettingGroupList";
import { SearchBarSettings } from "./SearchBarSettings";
import { SearchResultListSettings } from "./SearchResultListSettings";

export const Appearance = () => (
    <SettingGroupList>
        <SettingGroup title="Studio Glass">
            <StudioAppearance />
        </SettingGroup>
        <SearchBarSettings />
        <SearchResultListSettings />
    </SettingGroupList>
);
