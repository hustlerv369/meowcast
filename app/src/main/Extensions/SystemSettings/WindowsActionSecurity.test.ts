import type { SearchResultItemAction } from "@common/Core";
import type { PowershellUtility } from "@Core/PowershellUtility";
import { describe, expect, it, vi } from "vitest";
import { OpenAsAdministrator } from "../ApplicationSearch/Windows/OpenAsAdministrator";
import { WindowsControlPanelActionHandler } from "../WindowsControlPanel/WindowsControlPanelActionHandler";
import { WindowsSystemSettingActionHandler } from "./WindowsSystemSettingActionHandler";

describe("Windows action argument boundaries", () => {
    it("keeps apostrophes and PowerShell expressions inside literal arguments", async () => {
        const executeCommand = vi.fn().mockResolvedValue("");
        const utility = { executeCommand } as unknown as PowershellUtility;
        const argument = "C:\\O'Brien\\a';$(Get-Date);'file.exe";
        const action = { argument } as SearchResultItemAction;
        await new OpenAsAdministrator(utility).invokeAction(action);
        await new WindowsControlPanelActionHandler(utility).invokeAction(action);
        expect(executeCommand.mock.calls.map(([command]) => command)).toEqual([
            "Start-Process -Verb runas 'C:\\O''Brien\\a'';$(Get-Date);''file.exe'",
            "Show-ControlPanelItem -Name 'C:\\O''Brien\\a'';$(Get-Date);''file.exe'",
        ]);
    });

    it.each(['ms-settings:display";calc.exe', "$(Get-Date)", "file:///C:/a.exe", "ms-settings:display\ncalc.exe"])(
        "rejects invalid settings target %s",
        async (argument) => {
            const executeCommand = vi.fn();
            const handler = new WindowsSystemSettingActionHandler({ executeCommand } as unknown as PowershellUtility);
            await expect(handler.invokeAction({ argument } as SearchResultItemAction)).rejects.toThrow(
                "Invalid Windows settings URI.",
            );
            expect(executeCommand).not.toHaveBeenCalled();
        },
    );

    it.each(["ms-settings:", "ms-settings:display", "ms-settings:signinoptions-launchfaceenrollment"])(
        "allows settings URI %s",
        async (argument) => {
            const executeCommand = vi.fn().mockResolvedValue("");
            await new WindowsSystemSettingActionHandler({
                executeCommand,
            } as unknown as PowershellUtility).invokeAction({ argument } as SearchResultItemAction);
            expect(executeCommand).toHaveBeenCalledWith(`Start-Process '${argument}'`);
        },
    );
});
