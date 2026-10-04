import type { UeliModuleRegistry } from "@Core/ModuleRegistry";
import { describe, expect, it, vi } from "vitest";
import { ActionHandlerModule } from "./ActionHandlerModule";
import type { ActionHandlerRegistry } from "./ActionHandlerRegistry";

describe("action invocation outcome", () => {
    it.each([true, false])("returns success=%s only after the action settles", async (succeeds) => {
        const handle = vi.fn();
        const register = vi.fn();
        const showErrorBox = vi.fn();
        const services = {
            EventEmitter: { emitEvent: vi.fn() },
            IpcMain: { handle },
            Dialog: { showErrorBox },
        };
        const modules = {
            get: (key: keyof typeof services) => services[key],
            register,
        } as unknown as UeliModuleRegistry;
        ActionHandlerModule.bootstrap(modules);
        const registry = register.mock.calls[0][1] as ActionHandlerRegistry;
        let finish!: () => void;
        const pending = new Promise<void>((resolve, reject) => {
            finish = () => (succeeds ? resolve() : reject(new Error("failed")));
        });
        registry.register({ id: "test", invokeAction: () => pending });
        const done = vi.fn();
        const result = handle.mock.calls[0][1](null, { action: { handlerId: "test" } });
        result.then(done);
        await Promise.resolve();
        expect(done).not.toHaveBeenCalled();
        finish();
        await expect(result).resolves.toBe(succeeds);
        expect(showErrorBox).toHaveBeenCalledTimes(succeeds ? 0 : 1);
    });
});
