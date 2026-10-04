import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import type { ExtensionBootstrapResult } from "../ExtensionBootstrapResult";
import type { ExtensionModule } from "../ExtensionModule";
import { AiExtension } from "./AiExtension";

export class AiModule implements ExtensionModule {
    public bootstrap(moduleRegistry: UeliModuleRegistry): ExtensionBootstrapResult {
        return {
            extension: new AiExtension(
                moduleRegistry.get("Net"),
                moduleRegistry.get("AssetPathResolver"),
                moduleRegistry.get("SettingsManager"),
                moduleRegistry.get("Translator"),
                moduleRegistry.get("EventSubscriber"),
            ),
        };
    }
}
