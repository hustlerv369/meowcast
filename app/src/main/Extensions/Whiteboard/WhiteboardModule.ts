import type { ExtensionBootstrapResult } from "../ExtensionBootstrapResult";
import type { ExtensionModule } from "../ExtensionModule";
import { WhiteboardExtension } from "./WhiteboardExtension";
export class WhiteboardModule implements ExtensionModule {
    public bootstrap(): ExtensionBootstrapResult {
        return { extension: new WhiteboardExtension() };
    }
}
