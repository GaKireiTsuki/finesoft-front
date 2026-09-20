import { describe, expect, test } from "vite-plus/test";
import { Container } from "../../src/dependencies/container";
import { createToken } from "../../src/dependencies/token";
import { provide } from "../../src/dependencies/providers";

describe("Container providers", () => {
    test("caches scope providers and disposes owned values", async () => {
        const token = createToken<{ value: number }>("service");
        let disposed = 0;
        const container = new Container();
        container.registerProvider(
            provide({
                token,
                lifetime: "scope",
                create: () => ({ value: 1 }),
                dispose: () => {
                    disposed++;
                },
            }),
        );
        const scope = container.createScope();
        expect(await scope.get(token)).toBe(await scope.get(token));
        await scope.dispose();
        expect(disposed).toBe(1);
        await container.dispose();
    });

    test("rejects undeclared and cyclic dependencies", async () => {
        const a = createToken<number>("a"),
            b = createToken<number>("b");
        const container = new Container();
        container.registerProvider(
            provide({
                token: a,
                lifetime: "runtime",
                dependencies: [b],
                create: async (c) => (await c.get(b)) + 1,
            }),
        );
        container.registerProvider(
            provide({
                token: b,
                lifetime: "runtime",
                dependencies: [a],
                create: async (c) => (await c.get(a)) + 1,
            }),
        );
        await expect(container.get(a)).rejects.toThrow("Cyclic");
        await container.dispose().catch(() => {});
    });
});
