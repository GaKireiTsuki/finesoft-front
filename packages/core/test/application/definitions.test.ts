import { expect, test } from "vite-plus/test";
import {
    createRuntime,
    defineApp,
    defineModule,
    defineOperation,
    implementOperation,
    createToken,
    provide,
} from "../../src/index";

test("binding errors identify duplicates, missing and unknown operations and explicit replacements", async () => {
    const q = defineOperation<number, number>({ id: "q", kind: "query" });
    expect(() => createRuntime({ app: defineApp({ id: "a", operations: [q] }) })).toThrow(
        /Unbound.*q/,
    );
    expect(() => createRuntime({ app: defineApp({ id: "a", operations: [q, q] }) })).toThrow(
        /Duplicate.*q/,
    );
    expect(() =>
        createRuntime({
            app: defineApp({ id: "a", implementations: [implementOperation(q, (n) => n)] }),
        }),
    ).toThrow(/Unknown.*q/);
    const app = defineApp({
        id: "a",
        operations: [q],
        implementations: [implementOperation(q, (n) => n)],
    });
    const runtime = createRuntime({ app, implementations: [implementOperation(q, (n) => n * 2)] });
    expect(await runtime.execute(q, 2)).toBe(4);
    await expect(
        runtime.execute(defineOperation({ id: "q", kind: "query", handler: () => 0 }), undefined),
    ).rejects.toMatchObject({ code: "configuration" });
    await runtime.dispose();
});

test("module dependency references and capability requirements are validated at composition", () => {
    const child = defineModule({ id: "child" });
    const parent = defineModule({ id: "parent", dependsOn: [child] });
    expect(() => createRuntime({ app: defineApp({ id: "a", modules: [parent] }) })).toThrow(
        /Unknown.*child/,
    );
    const fetchOp = defineOperation({
        id: "fetch",
        kind: "query",
        capabilities: ["fetch"],
        handler: () => 1,
    });
    expect(() => createRuntime({ app: defineApp({ id: "a", operations: [fetchOp] }) })).toThrow(
        /capability.*fetch/,
    );
});

test("provider graph rejects unknown, cyclic and transitive runtime to scope dependencies", () => {
    const a = createToken<number>("a"),
        b = createToken<number>("b"),
        c = createToken<number>("c");
    const app = (providers: NonNullable<Parameters<typeof defineApp>[0]["providers"]>) =>
        defineApp({ id: "a", providers });
    expect(() =>
        createRuntime({
            app: app([
                provide({ token: a, lifetime: "runtime", dependencies: [b], create: () => 1 }),
            ]),
        }),
    ).toThrow(/Unknown.*b/);
    expect(() =>
        createRuntime({
            app: app([
                provide({ token: a, lifetime: "scope", dependencies: [b], create: () => 1 }),
                provide({ token: b, lifetime: "scope", dependencies: [a], create: () => 1 }),
            ]),
        }),
    ).toThrow(/Cyclic/);
    expect(() =>
        createRuntime({
            app: app([
                provide({ token: a, lifetime: "runtime", dependencies: [b], create: () => 1 }),
                provide({ token: b, lifetime: "transient", dependencies: [c], create: () => 1 }),
                provide({ token: c, lifetime: "scope", create: () => 1 }),
            ]),
        }),
    ).toThrow(/runtime.*scope/);
});

test("optional definition arrays accept explicit undefined and are copied when present", async () => {
    const operations = [defineOperation({ id: "plain", kind: "query", handler: () => 42 })];
    const app = defineApp({ id: "app", modules: undefined, providers: undefined, operations });
    operations.length = 0;
    const runtime = createRuntime({ app });
    expect(await runtime.execute(app.operations![0], undefined)).toBe(42);
    await runtime.dispose();
});
