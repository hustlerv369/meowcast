import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import type { ExtensionBootstrapResult } from "../ExtensionBootstrapResult";
import type { ExtensionModule } from "../ExtensionModule";
import { ClipboardHistoryExtension } from "./ClipboardHistoryExtension";

export class ClipboardHistoryModule implements ExtensionModule {
    public bootstrap(moduleRegistry: UeliModuleRegistry): ExtensionBootstrapResult {
        return {
            extension: new ClipboardHistoryExtension(
                moduleRegistry.get("App"),
                moduleRegistry.get("AssetPathResolver"),
                moduleRegistry.get("Translator"),
                moduleRegistry.get("SettingsManager"),
            ),
        };
    }
}
