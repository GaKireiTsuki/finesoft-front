import { describe, expect, test } from "vite-plus/test";
import { Container } from "../../src/dependencies/container";

describe("Container.unregister", () => {
    test("removes a registration so resolve falls back to parent", () => {
        const parent = new Container();
        parent.register("theme", () => "light");

        const child = parent.createScope();
        child.register("theme", () => "dark");
        expect(child.resolve("theme")).toBe("dark");

        const removed = child.unregister("theme");
        expect(removed).toBe(true);
        expect(child.resolve("theme")).toBe("light");
    });

    test("returns false when the key was never registered on this container", () => {
        const parent = new Container();
        parent.register("theme", () => "light");
        const child = parent.createScope();

        // theme is only on parent — child.unregister must not affect parent
        expect(child.unregister("theme")).toBe(false);
        expect(parent.resolve("theme")).toBe("light");
    });

    test("is idempotent", () => {
        const container = new Container();
        container.register("k", () => 1);
        expect(container.unregister("k")).toBe(true);
        expect(container.unregister("k")).toBe(false);
        expect(container.has("k")).toBe(false);
    });
});
