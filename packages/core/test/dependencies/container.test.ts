import { describe, expect, test, vi } from "vite-plus/test";
import { Container } from "../../src/dependencies/container";

describe("Container", () => {
    test("caches singleton registrations by default", () => {
        const container = new Container();
        const factory = vi.fn(() => ({ token: "singleton" }));

        container.register("service", factory);

        expect(container.resolve("service")).toBe(container.resolve("service"));
        expect(factory).toHaveBeenCalledTimes(1);
    });

    test("supports transient registrations", () => {
        const container = new Container();
        const factory = vi.fn(() => ({ token: Symbol("transient") }));

        container.register("service", factory, false);

        expect(container.resolve("service")).not.toBe(container.resolve("service"));
        expect(factory).toHaveBeenCalledTimes(2);
    });

    test("allows child scopes to inherit and override parent registrations", () => {
        const parent = new Container();
        const child = parent.createScope();

        parent.register("theme", () => "light");

        expect(child.has("theme")).toBe(true);
        expect(child.resolve("theme")).toBe("light");

        child.register("theme", () => "dark");

        expect(child.resolve("theme")).toBe("dark");
        expect(parent.resolve("theme")).toBe("light");
    });

    test("overwrites existing registrations for the same key", () => {
        const container = new Container();

        container.register("token", () => "first");
        container.register("token", () => "second");

        expect(container.resolve("token")).toBe("second");
    });

    test("detects circular singleton dependencies", () => {
        const container = new Container();

        container.register("a", () => container.resolve("b"));
        container.register("b", () => container.resolve("a"));

        expect(() => container.resolve("a")).toThrow(/Circular dependency detected/);
    });

    test("clears registrations when disposed", () => {
        const container = new Container();

        container.register("token", () => "value");
        expect(container.resolve("token")).toBe("value");

        container.dispose();

        expect(container.has("token")).toBe(false);
        expect(() => container.resolve("token")).toThrow(/No registration/);
    });
});
