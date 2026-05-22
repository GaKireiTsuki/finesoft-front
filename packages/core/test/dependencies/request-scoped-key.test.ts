import { describe, expect, test } from "vite-plus/test";
import { Container } from "../../src/dependencies/container";
import { defineRequestScopedKey } from "../../src/dependencies/request-scoped-key";

interface User {
    name: string;
}

describe("defineRequestScopedKey", () => {
    test("set / get round-trip on a bare container", () => {
        const KEY = defineRequestScopedKey<User>("app.user");
        const container = new Container();

        expect(KEY.get(container)).toBeUndefined();
        KEY.set(container, { name: "alice" });
        expect(KEY.get(container)?.name).toBe("alice");
    });

    test("accepts an object with `container`, like middleware context", () => {
        const KEY = defineRequestScopedKey<number>("app.count");
        const container = new Container();
        const ctx = { container };

        KEY.set(ctx, 7);
        expect(KEY.get(ctx)).toBe(7);
    });

    test("two containers do not leak values into each other", () => {
        const KEY = defineRequestScopedKey<User>("app.user");
        const a = new Container();
        const b = new Container();

        KEY.set(a, { name: "alice" });
        KEY.set(b, { name: "bob" });

        expect(KEY.get(a)?.name).toBe("alice");
        expect(KEY.get(b)?.name).toBe("bob");
    });

    test("clear() removes the registration on this container only", () => {
        const KEY = defineRequestScopedKey<string>("app.role");
        const parent = new Container();
        const child = parent.createScope();

        KEY.set(parent, "guest");
        KEY.set(child, "admin");

        expect(KEY.clear(child)).toBe(true);
        // child no longer overrides; falls back to parent
        expect(KEY.get(child)).toBe("guest");
        expect(KEY.get(parent)).toBe("guest");
    });

    test("overwriting set replaces the previous value", () => {
        const KEY = defineRequestScopedKey<string>("app.locale");
        const container = new Container();

        KEY.set(container, "en");
        KEY.set(container, "ja");
        expect(KEY.get(container)).toBe("ja");
    });
});
