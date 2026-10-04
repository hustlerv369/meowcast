import type { Note } from "@common/Extensions/Notes/Note";
import type { ExtensionProps } from "@Core/ExtensionProps";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notes } from "./Notes";

// Headless hook host exercises the component's real event handlers and IPC ordering.
const host = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as (() => unknown)[] }));
vi.mock("react", () => ({
    useState: (initial: unknown) => {
        const index = host.cursor++;

        if (!(index in host.slots)) {
            host.slots[index] = initial;
        }

        return [host.slots[index], (value: unknown) => (host.slots[index] = value)];
    },
    useRef: (initial: unknown) => {
        const index = host.cursor++;

        if (!(index in host.slots)) {
            host.slots[index] = { current: initial };
        }

        return host.slots[index];
    },
    useEffect: (effect: () => unknown) => host.effects.push(effect),
}));

type Element = { type: unknown; props: Record<string, unknown> };
const elements = (value: unknown): Element[] => {
    if (Array.isArray(value)) {
        return value.flatMap(elements);
    }

    if (!value || typeof value !== "object" || !("props" in value)) {
        return [];
    }

    const element = value as Element;
    return [element, ...Object.values(element.props).flatMap(elements)];
};
const deferred = () => {
    let resolve!: (value: Note) => void;
    const promise = new Promise<Note>((done) => (resolve = done));
    return { promise, resolve };
};
const tick = async () => {
    for (let index = 0; index < 20; index++) {
        await Promise.resolve();
    }
};

describe("Notes editor interactions", () => {
    const original: Note = { id: "note", title: "Draft", body: "", revision: 1, updatedAt: 1 };
    const invoke = vi.fn();
    const goBack = vi.fn();
    const render = () => {
        host.cursor = 0;
        host.effects = [];
        return Notes({ contextBridge: { invokeExtension: invoke }, goBack } as unknown as ExtensionProps);
    };
    const button = (label: string) =>
        elements(render()).find((node) => node.type === "button" && node.props.children === label)!;
    const click = (label: string) => (button(label).props.onClick as () => void)();
    const type = (body: string) => {
        const input = elements(render()).find((node) => node.type === "textarea")!;
        (input.props.onChange as (event: unknown) => void)({ target: { value: body } });
    };
    const escape = () => {
        const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
        render().props.onKeyDown(event);
        expect(event.stopPropagation).toHaveBeenCalled();
    };
    const saves = () => invoke.mock.calls.filter(([, argument]) => argument.command === "save");

    beforeEach(async () => {
        host.slots = [];
        invoke.mockReset().mockImplementation(async (_, argument) => {
            if (argument.command === "create") {
                return original;
            }

            if (argument.command === "save") {
                return { ...argument, revision: argument.revision + 1 };
            }

            return { notes: [], total: 0, unreadable: 0 };
        });
        goBack.mockReset();
        click("New note");
        await tick();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("autosaves after the typing delay without requiring a button click", async () => {
        vi.useFakeTimers();
        type("automatic draft");
        render();
        const cleanup = host.effects.at(-1)!() as () => void;
        await vi.advanceTimersByTimeAsync(649);
        expect(saves()).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(saves()[0][1].body).toBe("automatic draft");
        cleanup();
    });

    it("drains edits made during an in-flight save using the new revision", async () => {
        const pending = deferred();
        type("first");
        invoke.mockImplementationOnce(() => pending.promise);
        click("Save");
        type("latest");
        pending.resolve({ ...original, body: "first", revision: 2 });
        await tick();
        expect(saves().map(([, argument]) => [argument.body, argument.revision])).toEqual([
            ["first", 1],
            ["latest", 2],
        ]);
        expect(elements(render()).find((node) => node.type === "textarea")?.props.value).toBe("latest");
    });

    it.each(["Back", "Escape"])("waits for saving before %s navigation", async (action) => {
        const pending = deferred();
        type("keep me");
        invoke.mockImplementationOnce(() => pending.promise);

        if (action === "Back") {
            click("Back");
        } else {
            escape();
        }

        expect(goBack).not.toHaveBeenCalled();
        expect(button("Back").props.disabled).toBe(true);
        pending.resolve({ ...original, body: "keep me", revision: 2 });
        await tick();
        expect(goBack).toHaveBeenCalledTimes(1);
    });

    it("keeps text and blocks navigation on save failure, then permits explicit retry", async () => {
        type("recoverable");
        invoke.mockRejectedValueOnce(new Error("disk full"));
        click("Back");
        await tick();
        expect(goBack).not.toHaveBeenCalled();
        expect(elements(render()).find((node) => node.type === "textarea")?.props.value).toBe("recoverable");
        expect(elements(render()).some((node) => node.props.role === "alert")).toBe(true);
        click("Save");
        await tick();
        expect(elements(render()).some((node) => node.props.role === "alert")).toBe(false);
        click("Back");
        await tick();
        expect(goBack).toHaveBeenCalledTimes(1);
    });

    it.each(["Keep note", "Escape"])("cancels deletion with %s without deleting or leaving", (action) => {
        click("Delete note");

        if (action === "Escape") {
            escape();
        } else {
            click(action);
        }

        expect(elements(render()).some((node) => node.props["aria-label"] === "Confirm deletion")).toBe(false);
        expect(invoke.mock.calls.some(([, argument]) => argument.command === "delete")).toBe(false);
        expect(goBack).not.toHaveBeenCalled();
    });
});
