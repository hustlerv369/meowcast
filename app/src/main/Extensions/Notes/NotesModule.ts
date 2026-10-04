import type { ExtensionBootstrapResult } from "../ExtensionBootstrapResult";
import type { ExtensionModule } from "../ExtensionModule";
import { NotesExtension } from "./NotesExtension";
export class NotesModule implements ExtensionModule {
    public bootstrap(): ExtensionBootstrapResult {
        return { extension: new NotesExtension() };
    }
}
