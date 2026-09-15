import { expect, test, vi } from "vite-plus/test";
import { createSessionStore } from "../../src/session/session-store";

const storage = () => ({ get: async () => undefined, set: async () => {}, delete: async () => {} });
const provider = (key: string, restore = vi.fn()) => ({
    key,
    version: 2,
    decode: (value: unknown) => {
        if (typeof value !== "string") throw Error("private decoder text");
        return value;
    },
    capture: () => "latest",
    restore,
});

test("missing, rejected and invalid reads are distinct; diagnostics are bounded", async () => {
    const onError = vi.fn();
    const store = createSessionStore({
        storage: {
            ...storage(),
            get: async () => {
                throw Error("credential");
            },
        },
        onError,
    });
    expect(await store.load()).toMatchObject({ status: "failed" });
    expect(JSON.stringify(onError.mock.calls)).not.toContain("credential");
    expect(await createSessionStore({ storage: storage() }).load()).toEqual({ status: "missing" });
    expect(
        await createSessionStore({ storage: { ...storage(), get: async () => "garbage" } }).load(),
    ).toEqual({ status: "invalid" });
});

test("serial saves capture latest state when dequeued and dispose awaits outstanding writes", async () => {
    const releases: (() => void)[] = [];
    const writes: string[] = [];
    let value = "first";
    const store = createSessionStore({
        storage: {
            ...storage(),
            set: async (_key: string, data: string) => {
                writes.push(data);
                await new Promise<void>((resolve) => releases.push(resolve));
            },
        },
    });
    store.register({ ...provider("draft"), capture: () => value });
    const first = store.save();
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    value = "second";
    const second = store.save();
    value = "latest";
    let closed = false;
    const disposal = store.dispose().then(() => {
        closed = true;
    });
    expect(closed).toBe(false);
    releases.shift()!();
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toContain("latest");
    expect(closed).toBe(false);
    releases.shift()!();
    expect(await first).toEqual({ status: "saved" });
    expect(await second).toEqual({ status: "saved" });
    await disposal;
    expect(await store.save()).toEqual({ status: "closed" });
});

test("slice versions migrate or discard independently and duplicate keys reject", async () => {
    const onError = vi.fn();
    const store = createSessionStore({ storage: storage(), onError });
    const good = provider("good"),
        migrated = provider("migrated"),
        old = provider("old"),
        broken = provider("broken");
    store.register(good);
    store.register({
        ...migrated,
        migrate: (value: unknown, version: number) => (version === 1 ? String(value) : undefined),
    });
    store.register(old);
    store.register(broken);
    expect(() => store.register(good)).toThrow(/duplicate/i);
    const result = await store.restore({
        version: 1,
        capturedAt: 1,
        scoped: {},
        slices: {
            good: { version: 2, data: "valid" },
            migrated: { version: 1, data: 3 },
            old: { version: 1, data: "old" },
            broken: { version: 2, data: {} },
        },
    });
    expect(result).toMatchObject({ status: "partial", discarded: ["old", "broken"] });
    expect(good.restore).toHaveBeenCalledWith("valid");
    expect(migrated.restore).toHaveBeenCalledWith("3");
    expect(old.restore).not.toHaveBeenCalled();
    expect(JSON.stringify(onError.mock.calls)).not.toContain("private decoder text");
});

test("a delayed read settles before restore, and failed writes/clear are observable", async () => {
    let resolveRead!: (value: string | undefined) => void;
    const restore = vi.fn();
    const store = createSessionStore({
        storage: {
            ...storage(),
            get: () =>
                new Promise((resolve) => {
                    resolveRead = resolve;
                }),
            set: async () => {
                throw Error("quota");
            },
            delete: async () => {
                throw Error("denied");
            },
        },
    });
    store.register(provider("draft", restore));
    const restoring = store.restore();
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf("function"));
    expect(restore).not.toHaveBeenCalled();
    resolveRead(
        JSON.stringify({
            version: 1,
            capturedAt: 1,
            scoped: {},
            slices: { draft: { version: 2, data: "saved" } },
        }),
    );
    expect(await restoring).toEqual({ status: "restored" });
    expect(restore).toHaveBeenCalledWith("saved");
    expect(await store.save()).toMatchObject({ status: "failed" });
    expect(await store.clear()).toMatchObject({ status: "failed" });
    await store.dispose();
});

test("malformed and duplicate EntryIds fail before navigation and scoped mutation", async () => {
    const apply = vi.fn();
    const store = createSessionStore({
        storage: storage(),
        navigation: { capture: () => undefined, apply, presentKeys: () => [] },
    });
    store.scope.set("retained", "draft");
    for (const navigation of [
        { url: "/", entryId: " " },
        { kind: "leaf", intent: "home", params: {} },
        {
            kind: "stack",
            entries: [1, 2].map(() => ({
                kind: "leaf",
                entryId: "duplicate",
                intent: "home",
                params: {},
            })),
        },
    ]) {
        const result = await store.restore({
            version: 1,
            capturedAt: 1,
            scoped: {},
            slices: {},
            navigation: navigation as never,
        });
        expect(result).toEqual({ status: "invalid" });
    }
    expect(apply).not.toHaveBeenCalled();
    expect(store.scope.get("retained")).toBe("draft");
});
