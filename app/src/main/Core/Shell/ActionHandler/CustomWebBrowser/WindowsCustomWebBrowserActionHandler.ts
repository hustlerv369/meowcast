import type { PowershellUtility } from "@Core/PowershellUtility";
import type { SettingsManager } from "@Core/SettingsManager";
import type { CustomWebBrowserActionHandler } from "./CustomWebBrowserActionHandler";

export class WindowsCustomWebBrowserActionHandler implements CustomWebBrowserActionHandler {
    public constructor(
        private readonly powershellUtility: PowershellUtility,
        private readonly settingsManager: SettingsManager,
    ) {}

    public isEnabled(): boolean {
        if (this.settingsManager.getValue<boolean>("general.browser.useDefaultWebBrowser", true)) {
            return false;
        }

        return this.getExecutableFilePath().length > 0 && this.getCommandlineArguments().includes("{{url}}");
    }

    public async openUrl(url: string): Promise<void> {
        const escapeForPowerShellSingleQuoted = (value: string) => value.replace(/'/g, "''");

        const filePath = escapeForPowerShellSingleQuoted(this.getExecutableFilePath());
        const argumentsLine = escapeForPowerShellSingleQuoted(this.getCommandlineArguments().replace("{{url}}", url));

        await this.powershellUtility.executeCommand(
            `Start-Process -FilePath '${filePath}' -ArgumentList '${argumentsLine}'`,
        );
    }

    private getExecutableFilePath(): string {
        return this.settingsManager.getValue<string>("general.browser.customWebBrowser.executableFilePath", "");
    }

    private getCommandlineArguments(): string {
        return this.settingsManager.getValue<string>(
            "general.browser.customWebBrowser.commandlineArguments",
            "{{url}}",
        );
    }
}
