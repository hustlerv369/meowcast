import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import type { ExtensionBootstrapResult } from "../ExtensionBootstrapResult";
import type { ExtensionModule } from "../ExtensionModule";
import { EmojiPickerExtension } from "./EmojiPickerExtension";

export class EmojiPickerModule implements ExtensionModule {
    public bootstrap(moduleRegistry: UeliModuleRegistry): ExtensionBootstrapResult {
        return {
            extension: new EmojiPickerExtension(
                moduleRegistry.get("AssetPathResolver"),
                moduleRegistry.get("Translator"),
            ),
        };
    }
}
