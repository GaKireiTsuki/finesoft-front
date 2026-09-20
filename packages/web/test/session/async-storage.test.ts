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
        version: 2,
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
            version: 2,
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
        navigation: {
            captureNavigation: () => undefined,
            restoreNavigation: apply,
            presentKeys: () => [],
        },
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

test("capture detaches every channel and explicit persist owns admission-time data while implicit save stays latest", async () => {
    const draft = { nested: { text: "captured" } };
    const scoped = { nested: { note: "captured" } };
    const navigation = {
        kind: "leaf" as const,
        entryId: "entry-a",
        intent: "home",
        params: { nested: { value: "captured" } },
    };
    let release!: () => void;
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
        started = resolve;
    });
    const writes: import("../../src/session/types").SessionSnapshot[] = [];
    const store = createSessionStore({
        now: () => 7,
        storage: {
            ...storage(),
            set: async (_key, data) => {
                writes.push(JSON.parse(data));
                if (writes.length === 1) {
                    started();
                    await new Promise<void>((resolve) => {
                        release = resolve;
                    });
                }
            },
        },
        navigation: {
            captureNavigation: () => navigation,
            restoreNavigation: () => {},
            presentKeys: () => ["entry-a"],
        },
    });
    store.register({ ...provider("draft"), capture: () => draft });
    store.scope.set("entry-a", scoped);
    const first = store.save();
    await firstStarted;
    const snapshot = store.capture();
    const admitted = JSON.parse(JSON.stringify(snapshot));
    const explicit = store.persist(snapshot);
    draft.nested.text = "changed-after-capture";
    scoped.nested.note = "changed-after-capture";
    navigation.params.nested.value = "changed-after-capture";
    expect(snapshot).toEqual(admitted);
    for (const source of [
        draft,
        draft.nested,
        scoped,
        scoped.nested,
        navigation,
        navigation.params.nested,
    ])
        expect(Object.isFrozen(source)).toBe(false);
    // Callers also retain ownership of their snapshot object after persistence admission.
    (snapshot.slices.draft as { data: typeof draft }).data.nested.text = "changed-after-admission";
    (snapshot.scoped["entry-a"] as typeof scoped).nested.note = "changed-after-admission";
    (snapshot.navigation as typeof navigation).params.nested.value = "changed-after-admission";
    const implicit = store.save();
    release();
    expect(await first).toEqual({ status: "saved" });
    expect(await explicit).toEqual({ status: "saved" });
    expect(await implicit).toEqual({ status: "saved" });
    expect(writes[1]).toEqual(admitted);
    expect(writes[2]).toMatchObject({
        slices: { draft: { data: draft } },
        scoped: { "entry-a": scoped },
        navigation,
    });
    await store.dispose();
});

test("capture clone failures isolate invalid providers from valid siblings and diagnostics stay bounded", async () => {
    const onError = vi.fn();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const privateGetter = {
        get value() {
            throw Error("PRIVATE_CAPTURE_ERROR");
        },
    };
    const writes: string[] = [];
    const store = createSessionStore({
        storage: {
            ...storage(),
            set: async (_key, data) => {
                writes.push(data);
            },
        },
        onError,
    });
    store.register({ ...provider("cycle"), capture: () => cycle });
    store.register({ ...provider("getter"), capture: () => privateGetter });
    store.register({ ...provider("good"), capture: () => ({ value: "kept" }) });
    expect(store.capture().slices).toEqual({ good: { version: 2, data: { value: "kept" } } });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(onError.mock.calls)).not.toContain("PRIVATE_CAPTURE_ERROR");
    expect(await store.save()).toEqual({ status: "saved" });
    expect(JSON.parse(writes[0]).slices).toEqual({ good: { version: 2, data: { value: "kept" } } });
    await store.dispose();
});

test("invalid explicit or structural snapshot values fail without writing or poisoning the queue", async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const set = vi.fn(async () => {});
    let navigation: unknown;
    const store = createSessionStore({
        storage: { ...storage(), set },
        navigation: {
            captureNavigation: () => navigation as never,
            restoreNavigation: () => {},
            presentKeys: () => [],
        },
    });
    const snapshot = { version: 1, capturedAt: 7, slices: { bad: cycle }, scoped: {} };
    await expect(store.persist(snapshot)).resolves.toMatchObject({ status: "failed" });
    expect(set).not.toHaveBeenCalled();
    store.scope.set("entry-a", cycle);
    expect(() => store.capture()).toThrow("invalid-snapshot-value");
    expect(await store.save()).toMatchObject({ status: "failed" });
    store.scope.delete("entry-a");
    navigation = { entryId: "entry-a", url: "/", internal: cycle };
    expect(() => store.capture()).toThrow("invalid-snapshot-value");
    expect(await store.save()).toMatchObject({ status: "failed" });
    expect(set).not.toHaveBeenCalled();
    navigation = undefined;
    expect(await store.save()).toEqual({ status: "saved" });
    expect(set).toHaveBeenCalledTimes(1);
    await store.dispose();
    // A closed store must reject admission before inspecting a caller-owned snapshot.
    const getter = vi.fn(() => {
        throw Error("must-not-read");
    });
    Object.defineProperty(snapshot, "scoped", { get: getter });
    expect(await store.persist(snapshot)).toEqual({ status: "closed" });
    expect(getter).not.toHaveBeenCalled();
});
