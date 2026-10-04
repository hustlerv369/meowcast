import type { AssetPathResolver } from "@Core/AssetPathResolver";
import type { Extension } from "@Core/Extension";
import type { SettingsManager } from "@Core/SettingsManager";
import type { Translator } from "@Core/Translator";
import type { UeliCommand } from "@Core/UeliCommand";
import type { SearchResultItem } from "@common/Core";
import type { Image } from "@common/Core/Image";

export class UeliCommandExtension implements Extension {
    public readonly id = "UeliCommand";
    public readonly name = "Meowcast Commands";

    public readonly nameTranslation = {
        key: "extensionName",
        namespace: "extension[UeliCommand]",
    };

    public readonly author = {
        name: "Oliver Schwendener",
        githubUserName: "oliverschwendener",
    };

    public constructor(
        private readonly assetPathResolver: AssetPathResolver,
        private readonly translator: Translator,
        private readonly settingsManager: SettingsManager,
    ) {}

    public async getSearchResultItems(): Promise<SearchResultItem[]> {
        const { t } = this.translator.createT(this.getI18nResources());

        const commonSearchResultItems: SearchResultItem[] = [
            {
                id: "ueliCommand:quit",
                description: t("description"),
                name: t("quitHustleCMD"),
                image: this.getImage(),
                defaultAction: {
                    handlerId: "UeliCommand",
                    argument: <UeliCommand>"quit",
                    description: t("quitHustleCMD"),
                    requiresConfirmation: true,
                    fluentIcon: "DismissCircleRegular",
                    hideWindowAfterInvocation: true,
                },
            },
            {
                id: "ueliCommand:settings",
                description: t("description"),
                name: t("openSettings"),
                image: this.getImage(),
                defaultAction: {
                    handlerId: "UeliCommand",
                    argument: <UeliCommand>"openSettings",
                    description: t("openSettings"),
                    fluentIcon: "SettingsRegular",
                },
            },
            {
                id: "ueliCommand:extensions",
                description: t("description"),
                name: t("openExtensions"),
                image: this.getImage(),
                defaultAction: {
                    handlerId: "UeliCommand",
                    argument: <UeliCommand>"openExtensions",
                    description: t("openExtensions"),
                    fluentIcon: "AppsAddInRegular",
                },
            },
            {
                id: "ueliCommand:centerWindow",
                description: t("description"),
                name: t("centerWindow"),
                image: this.getImage(),
                defaultAction: {
                    handlerId: "UeliCommand",
                    argument: <UeliCommand>"centerWindow",
                    description: t("centerWindow"),
                    fluentIcon: "AppsAddInRegular",
                },
            },
            {
                id: "ueliCommand:rescanExtensions",
                description: t("description"),
                name: t("rescanExtensions"),
                image: this.getImage(),
                defaultAction: {
                    handlerId: "UeliCommand",
                    argument: <UeliCommand>"rescanExtensions",
                    description: t("rescanExtensions"),
                    fluentIcon: "ArrowClockwiseRegular",
                },
            },
        ];

        const hotkeyIsEnabled = this.settingsManager.getValue("general.hotkey.enabled", true);

        const hotkeySearchResultItems: SearchResultItem[] = hotkeyIsEnabled
            ? [
                  {
                      id: "ueliCommand:toggleHotkey",
                      description: t("description"),
                      name: t("disableHotkey"),
                      image: this.getImage(),
                      defaultAction: {
                          handlerId: "UeliCommand",
                          argument: <UeliCommand>"disableHotkey",
                          description: t("disableHotkey"),
                          fluentIcon: "DismissCircleRegular",
                      },
                  },
              ]
            : [
                  {
                      id: "ueliCommand:toggleHotkey",
                      description: t("description"),
                      name: t("enableHotkey"),
                      image: this.getImage(),
                      defaultAction: {
                          handlerId: "UeliCommand",
                          argument: <UeliCommand>"enableHotkey",
                          description: t("enableHotkey"),
                          fluentIcon: "CheckmarkCircleRegular",
                      },
                  },
              ];

        return [...commonSearchResultItems, ...hotkeySearchResultItems];
    }

    public getImage(): Image {
        return {
            url: `file://${this.assetPathResolver.getExtensionAssetPath(this.id, "app-icon-dark.png")}`,
            urlOnDarkBackground: `file://${this.assetPathResolver.getExtensionAssetPath(this.id, "app-icon-dark.png")}`,
            urlOnLightBackground: `file://${this.assetPathResolver.getExtensionAssetPath(this.id, "app-icon-light.png")}`,
        };
    }

    public isSupported(): boolean {
        return true;
    }

    public getSettingDefaultValue() {
        return undefined;
    }

    public getSettingKeysTriggeringRescan() {
        return ["general.language", "general.hotkey.enabled"];
    }

    public getI18nResources() {
        return {
            "en-US": {
                extensionName: "Meowcast Commands",
                description: "Meowcast Command",
                openSettings: "Open Meowcast settings",
                openExtensions: "Browse Meowcast extensions",
                centerWindow: "Center Meowcast window",
                quitHustleCMD: "Quit Meowcast",
                rescanExtensions: "Rescan extensions",
                disableHotkey: "Disable hotkey",
                enableHotkey: "Enable hotkey",
            },
            "de-CH": {
                extensionName: "Meowcast Befehle",
                description: "Meowcast Befehl",
                openSettings: "Meowcast-Einstellungen öffnen",
                openExtensions: "Meowcast-Erweiterungen durchsuchen",
                centerWindow: "Meowcast-Fenster zentrieren",
                quitHustleCMD: "Meowcast Beenden",
                rescanExtensions: "Erweiterungen neu scannen",
                disableHotkey: "Tastenkombination deaktivieren",
                enableHotkey: "Tastenkombination aktivieren",
            },
            "ja-JP": {
                extensionName: "Meowcastコマンド",
                description: "Meowcastコマンド",
                openSettings: "Meowcast設定を開く | Open Meowcast settings",
                openExtensions: "Meowcast拡張機能を開く | Browse Meowcast extensions",
                centerWindow: "入力パネルを中央に移動 | Center Meowcast window",
                quitHustleCMD: "Meowcastを終了 | Quit Meowcast",
                rescanExtensions: "拡張機能を再読み込み | Rescan extensions",
                disableHotkey: "ホットキーを無効にする | Disable hotkey",
                enableHotkey: "ホットキーを有効にする | Enable hotkey",
            },
            "ko-KR": {
                extensionName: "Meowcast 명령어",
                description: "Meowcast 명령어",
                openSettings: "Meowcast 설정 열기",
                openExtensions: "Meowcast 확장 프로그램 열기",
                centerWindow: "Meowcast 창 중앙에 배치",
                quitHustleCMD: "Meowcast 종료",
                rescanExtensions: "확장 프로그램 재탐색",
                disableHotkey: "단축키 비활성화",
                enableHotkey: "단축키 활성화",
            },
            "zh-CN": {
                extensionName: "Meowcast 命令",
                description: "Meowcast 命令",
                openSettings: "打开 Meowcast 设置",
                openExtensions: "浏览 Meowcast 扩展",
                centerWindow: "Meowcast 窗口居中",
                quitHustleCMD: "退出 Meowcast",
                rescanExtensions: "重新扫描扩展",
                disableHotkey: "禁用热键",
                enableHotkey: "启用热键",
            },
            "zh-TW": {
                extensionName: "Meowcast 指令",
                description: "Meowcast 指令",
                openSettings: "開啟 Meowcast 設定",
                openExtensions: "瀏覽 Meowcast 擴充套件",
                centerWindow: "Meowcast 視窗置中",
                quitHustleCMD: "結束 Meowcast",
                rescanExtensions: "重新掃描擴充套件",
                disableHotkey: "停用快捷鍵",
                enableHotkey: "啟用快捷鍵",
            },
        };
    }
}
