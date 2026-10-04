import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { launchCompanionInBackground, MeowmateStartup } from "./MeowmateStartup";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));

const setup = () => {
    const dependencies = {
        ready: vi.fn(async () => {}),
        supported: vi.fn(() => true),
        packaged: vi.fn(() => true),
        enabled: vi.fn(() => true),
        executable: vi.fn(() => "C:/app/resources/meowmate/coucou.exe"),
        exists: vi.fn(async () => {}),
        launch: vi.fn(async () => {}),
    };
    return { dependencies, startup: new MeowmateStartup(dependencies) };
};

describe("Meowmate autostart", () => {
    beforeEach(() => vi.clearAllMocks());

    it("waits for app readiness and launches only once across concurrent and later calls", async () => {
        const { dependencies, startup } = setup();
        let ready!: () => void;
        dependencies.ready.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    ready = resolve;
                }),
        );
        const first = startup.start();
        expect(startup.start()).toBe(first);
        expect(dependencies.launch).not.toHaveBeenCalled();
        ready();
        expect(await first).toBe("started");
        expect(await startup.start()).toBe("started");
        expect(dependencies.launch).toHaveBeenCalledExactlyOnceWith("C:/app/resources/meowmate/coucou.exe");
    });

    it.each(["supported", "packaged", "enabled"] as const)("skips when %s is false", async (condition) => {
        const { dependencies, startup } = setup();
        dependencies[condition].mockReturnValue(false);
        expect(await startup.start()).toBe("skipped");
        expect(dependencies.exists).not.toHaveBeenCalled();
        expect(dependencies.launch).not.toHaveBeenCalled();
    });

    it("skips missing payload without a retry loop", async () => {
        const { dependencies, startup } = setup();
        dependencies.exists.mockRejectedValue(new Error("private path"));
        expect(await startup.start()).toBe("missing");
        expect(await startup.start()).toBe("missing");
        expect(dependencies.exists).toHaveBeenCalledOnce();
        expect(dependencies.launch).not.toHaveBeenCalled();
    });

    it("honors opt-out while checking disk", async () => {
        const { dependencies, startup } = setup();
        dependencies.exists.mockImplementation(async () => {
            dependencies.enabled.mockReturnValue(false);
        });
        expect(await startup.start()).toBe("skipped");
        expect(dependencies.launch).not.toHaveBeenCalled();
    });

    it("contains startup failure without repeating the launch", async () => {
        const { dependencies, startup } = setup();
        dependencies.launch.mockRejectedValue(new Error("private path"));
        expect(await startup.start()).toBe("failed");
        expect(await startup.start()).toBe("failed");
        expect(dependencies.launch).toHaveBeenCalledOnce();
    });

    it("uses only the fixed background argument and detaches the companion without killing it", async () => {
        const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
        mocks.spawn.mockReturnValue(child);
        const launch = launchCompanionInBackground("C:/app/coucou.exe");
        expect(mocks.spawn).toHaveBeenCalledWith("C:/app/coucou.exe", ["--background"], {
            shell: false,
            windowsHide: true,
            detached: true,
            stdio: "ignore",
        });
        child.emit("spawn");
        await launch;
        expect(child.unref).toHaveBeenCalledOnce();
    });

    it("does not leak process error details", async () => {
        const child = new EventEmitter();
        mocks.spawn.mockReturnValue(child);
        const launch = launchCompanionInBackground("C:/app/coucou.exe");
        child.emit("error", new Error("private path"));
        await expect(launch).rejects.toThrow("Meowmate could not start.");
    });
});
