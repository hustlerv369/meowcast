import type { CommandlineUtility } from "@Core/CommandlineUtility";
import type { SettingsManager } from "@Core/SettingsManager";
import type { CustomWebBrowserActionHandler } from "./CustomWebBrowserActionHandler";

export class MacOsCustomWebBrowserActionHandler implements CustomWebBrowserActionHandler {
    public constructor(
        private readonly settingsManager: SettingsManager,
        private readonly commandlineUtility: CommandlineUtility,
    ) {}

    public isEnabled(): boolean {
        if (this.settingsManager.getValue<boolean>("general.browser.useDefaultWebBrowser", true)) {
            return false;
        }

        return this.getCustomWebBrowserName().length > 0;
    }

    public async openUrl(url: string): Promise<void> {
        const literal = (value: string) => `'${value.replace(/'/g, "'\"'\"'")}'`;
        await this.commandlineUtility.executeCommand(
            `open -a ${literal(this.getCustomWebBrowserName())} ${literal(url)}`,
        );
    }

    private getCustomWebBrowserName(): string {
        return this.settingsManager.getValue<string>("general.browser.customWebBrowserName", "");
    }
}
