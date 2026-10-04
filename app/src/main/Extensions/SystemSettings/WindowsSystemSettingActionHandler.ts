import type { ActionHandler } from "@Core/ActionHandler";
import type { PowershellUtility } from "@Core/PowershellUtility";
import type { SearchResultItemAction } from "@common/Core";

export class WindowsSystemSettingActionHandler implements ActionHandler {
    public readonly id = "WindowsSystemSetting";

    public constructor(private readonly powershellUtility: PowershellUtility) {}

    public async invokeAction({ argument }: SearchResultItemAction): Promise<void> {
        if (!/^ms-settings:[a-z0-9-]*$/i.test(argument)) {
            throw new Error("Invalid Windows settings URI.");
        }

        await this.powershellUtility.executeCommand(`Start-Process '${argument}'`);
    }
}
