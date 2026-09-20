vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { describe, expect, test } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { vi } from "vite-plus/test";
import { createNavigationScopedState, createSessionStore } from "@finesoft/web";
import { FakeElement, FakeEvent, stubDomGlobals } from "./fake-dom";
import { createDomRestore } from "../src/dom-restore";

// Register Event + CustomEvent + document globals before any DOM usage.
stubDomGlobals();

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a FakeElement tree from a simple declarative spec.
 * Each spec entry maps to one element; child specs are appended in order.
 *
 * Supported fields:
 *   tag      — element tag (default "div")
 *   attrs    — Record<string,string>  (each key → setAttribute)
 *   value    — string (sets .value property after attrs; equivalent to setAttribute("value",…) but
 *              also keeps the mutable .value in sync for input elements that don't use attribute)
 *   checked  — boolean (sets .checked prop)
 *   open     — boolean (sets .open prop — <details>)
 *   children — nested ElementSpec[]
 */
interface ElementSpec {
    tag?: string;
    attrs?: Record<string, string>;
    value?: string;
    checked?: boolean;
    open?: boolean;
    children?: ElementSpec[];
}

function buildEl(spec: ElementSpec): FakeElement {
    const el = new FakeElement(spec.tag ?? "div");
    for (const [k, v] of Object.entries(spec.attrs ?? {})) {
        el.setAttribute(k, v);
    }
    // Explicit prop overrides (allow value="" even when setAttribute("value","x") was called above)
    if (spec.value !== undefined) el.value = spec.value;
    if (spec.checked !== undefined) el.checked = spec.checked;
    if (spec.open !== undefined) el.open = spec.open;
    for (const childSpec of spec.children ?? []) {
        el.appendChild(buildEl(childSpec));
    }
    return el;
}

/**
 * Build an island container: `data-fs-entry` + `data-fs-key` + a `data-restore-root`
 * wrapper child populated with the given child elements.
 *
 * Usage:
 *   island("home {}", [
 *     { tag: "input", attrs: { name: "note" }, value: "draft" }
 *   ])
 */
function island(key: string, childSpecs: ElementSpec[]): FakeElement {
    const root = new FakeElement("div");
    root.setAttribute("data-restore-root", "");
    for (const spec of childSpecs) {
        root.appendChild(buildEl(spec));
    }
    const c = new FakeElement("div");
    c.setAttribute("data-fs-entry", "");
    c.setAttribute("data-fs-key", key);
    c.appendChild(root);
    return c;
}

// Cast helpers: the DOM stubs return FakeElement; the dom-restore code types them as HTMLElement.
// These force the cast so TypeScript is happy in test assertions.
function asHTMLElement(el: FakeElement): HTMLElement {
    return el as unknown as HTMLElement;
}

test("DOM restore and later edits follow the scope replaced by session restoration", async () => {
    const store = createSessionStore({
        storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    });
    const original = store.scope;
    const restore = createDomRestore({
        get scope() {
            return store.scope;
        },
    });
    const entry = island("entry", [{ tag: "input", attrs: { name: "note" }, value: "" }]);
    try {
        await store.restore({
            version: 2,
            capturedAt: 1,
            slices: {},
            scoped: {
                entry: { __dom: { fields: { note: "restored draft" } } },
            },
        });
        expect(store.scope).not.toBe(original);
        restore.restoreEntry(asHTMLElement(entry));
        const input = entry.querySelector("[name]") as FakeElement;
        expect(input.value).toBe("restored draft");
        input.value = "edited draft";
        restore.captureEntry(asHTMLElement(entry));
        expect(store.capture().scoped.entry).toMatchObject({
            __dom: { fields: { note: "edited draft" } },
        });
        expect(original.get("entry")).toBeUndefined();
    } finally {
        restore.dispose();
        await store.dispose();
    }
});

// ---------------------------------------------------------------------------
// Capture tests
// ---------------------------------------------------------------------------

describe("dom-restore — 捕获", () => {
    test("捕获 data-restore-root 内带 name 的输入值进 scope[key].__dom.fields", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const c = island("home {}", [{ tag: "input", attrs: { name: "note" }, value: "draft" }]);

        dr.captureEntry(asHTMLElement(c));

        const dom = (scope.get("home {}") as { __dom?: { fields?: Record<string, unknown> } })
            .__dom;
        expect(dom?.fields).toEqual({ note: "draft" });
    });

    test("排除 password / data-restore-ignore / 无 key 字段", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const c = island("k {}", [
            // password → excluded
            { tag: "input", attrs: { name: "pw", type: "password" }, value: "secret" },
            // data-restore-ignore → excluded
            { tag: "input", attrs: { name: "ign", "data-restore-ignore": "" }, value: "x" },
            // no name / no data-restore-key → excluded
            { tag: "input", attrs: {}, value: "nokey" },
            // has name → included
            { tag: "input", attrs: { name: "ok" }, value: "kept" },
        ]);

        dr.captureEntry(asHTMLElement(c));

        const dom = (scope.get("k {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom;
        expect(dom?.fields).toEqual({ ok: "kept" });
    });

    test("捕获 checkbox.checked、details.open、data-restore-key 优先于 name", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const c = island("k {}", [
            // checkbox — name "agree", checked = true
            {
                tag: "input",
                attrs: { type: "checkbox", name: "agree" },
                checked: true,
            },
            // data-restore-key overrides name
            {
                tag: "input",
                attrs: { name: "ignored-name", "data-restore-key": "kk" },
                value: "v",
            },
            // details with data-restore-key, open = true
            {
                tag: "details",
                attrs: { "data-restore-key": "sec" },
                open: true,
            },
        ]);

        dr.captureEntry(asHTMLElement(c));

        const dom = (
            scope.get("k {}") as {
                __dom?: {
                    fields?: Record<string, unknown>;
                    details?: Record<string, boolean>;
                };
            }
        ).__dom;
        expect(dom?.fields).toEqual({ agree: true, kk: "v" });
        expect(dom?.details).toEqual({ sec: true });
    });
});

// ---------------------------------------------------------------------------
// Restore tests
// ---------------------------------------------------------------------------

describe("dom-restore — 回填", () => {
    test("回填输入值并派发合成 input/change（驱动受控绑定）", () => {
        const scope = createNavigationScopedState();
        scope.set("home {}", { __dom: { fields: { note: "restored" } } });
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const c = island("home {}", [{ tag: "input", attrs: { name: "note" }, value: "" }]);

        // Grab the input element and listen for events
        const inputEl = (c as unknown as FakeElement)
            .querySelector("[data-restore-root]")!
            .querySelector("[name]") as unknown as FakeElement;
        const inputEvents: string[] = [];
        inputEl.addEventListener("input", () => inputEvents.push("input"));
        inputEl.addEventListener("change", () => inputEvents.push("change"));

        dr.restoreEntry(asHTMLElement(c));

        expect(inputEl.value).toBe("restored");
        expect(inputEvents).toEqual(["input", "change"]);
    });

    test("scope 无 __dom 时回填是 no-op", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const c = island("home {}", [{ tag: "input", attrs: { name: "note" }, value: "orig" }]);

        dr.restoreEntry(asHTMLElement(c));

        const inputEl = (c as unknown as FakeElement)
            .querySelector("[data-restore-root]")!
            .querySelector("[name]") as unknown as FakeElement;
        expect(inputEl.value).toBe("orig");
    });
});

// ---------------------------------------------------------------------------
// attach tests
// ---------------------------------------------------------------------------

describe("dom-restore — attach 接线", () => {
    test("input event captures the owning entry", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        dr.attach(asHTMLElement(outlet));
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "typed" }]);
        outlet.appendChild(c);

        c.querySelector("[name]")!.dispatchEvent(new FakeEvent("input", { bubbles: true }));

        const dom = (scope.get("k {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom;
        expect(dom?.fields).toEqual({ note: "typed" });
    });

    test("captures an entry nested below native outlet wrappers", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        outlet.setAttribute("data-fs-app", "parent");
        const wrapper = new FakeElement("main");
        const c = island("nested {}", [{ tag: "input", attrs: { name: "note" }, value: "typed" }]);
        wrapper.appendChild(c);
        outlet.appendChild(wrapper);
        dr.attach(asHTMLElement(outlet));

        c.querySelector("[name]")!.dispatchEvent(new FakeEvent("input", { bubbles: true }));

        expect(
            (scope.get("nested {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom
                ?.fields,
        ).toEqual({ note: "typed" });
    });

    test("input 事件（委托）→ 实时捕获", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        dr.attach(asHTMLElement(outlet));
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "" }]);
        outlet.appendChild(c);

        // Simulate user typing: update value then dispatch input event
        const inputEl = c
            .querySelector("[data-restore-root]")!
            .querySelector("[name]") as FakeElement;
        inputEl.value = "x";
        inputEl.dispatchEvent(new FakeEvent("input", { bubbles: true }));

        const dom = (scope.get("k {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom;
        expect(dom?.fields).toEqual({ note: "x" });
    });

    test("attach does not restore until the caller acknowledges a commit", () => {
        const scope = createNavigationScopedState();
        scope.set("k {}", { __dom: { fields: { note: "boot" } } });
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "" }]);
        outlet.appendChild(c); // boot: island already in outlet before attach

        dr.attach(asHTMLElement(outlet));

        const inputEl = c
            .querySelector("[data-restore-root]")!
            .querySelector("[name]") as FakeElement;
        expect(inputEl.value).toBe("");
        dr.restoreEntry(asHTMLElement(c));
        expect(inputEl.value).toBe("boot");
    });

    test("explicit restore refills a newly committed entry", () => {
        const scope = createNavigationScopedState();
        scope.set("k {}", { __dom: { fields: { note: "later" } } });
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        dr.attach(asHTMLElement(outlet));
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "" }]);
        outlet.appendChild(c);

        dr.restoreEntry(asHTMLElement(c));

        const inputEl = c
            .querySelector("[data-restore-root]")!
            .querySelector("[name]") as FakeElement;
        expect(inputEl.value).toBe("later");
    });

    test("pagehide → flush 所有可见 islands 进 scope", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        dr.attach(asHTMLElement(outlet));
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "flush-me" }]);
        outlet.appendChild(c);

        // Trigger pagehide on the fake window global
        const fakeWindow = globalThis.window as unknown as import("./fake-dom").FakeGlobalTarget;
        fakeWindow.dispatchEvent(new FakeEvent("pagehide", { bubbles: false }));

        const dom = (scope.get("k {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom;
        expect(dom?.fields).toEqual({ note: "flush-me" });
    });

    test("visibilitychange(hidden) → flush 所有可见 islands 进 scope", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        dr.attach(asHTMLElement(outlet));
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "vis-flush" }]);
        outlet.appendChild(c);

        // Set document.visibilityState to "hidden" then fire visibilitychange
        const fakeDoc = globalThis.document as unknown as {
            visibilityState: string;
        } & import("./fake-dom").FakeGlobalTarget;
        fakeDoc.visibilityState = "hidden";
        fakeDoc.dispatchEvent(new FakeEvent("visibilitychange", { bubbles: false }));

        const dom = (scope.get("k {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom;
        expect(dom?.fields).toEqual({ note: "vis-flush" });
    });

    test("change, pagehide, and visibilitychange flush nested entries", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        outlet.setAttribute("data-fs-app", "parent");
        const wrapper = new FakeElement("main");
        const c = island("nested {}", [{ tag: "input", attrs: { name: "note" }, value: "change" }]);
        wrapper.appendChild(c);
        outlet.appendChild(wrapper);
        dr.attach(asHTMLElement(outlet));
        const input = c.querySelector("[name]") as FakeElement;

        input.dispatchEvent(new FakeEvent("change", { bubbles: true }));
        expect(
            (scope.get("nested {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom
                ?.fields,
        ).toEqual({ note: "change" });

        input.value = "pagehide";
        (globalThis.window as unknown as import("./fake-dom").FakeGlobalTarget).dispatchEvent(
            new FakeEvent("pagehide"),
        );
        expect(
            (scope.get("nested {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom
                ?.fields,
        ).toEqual({ note: "pagehide" });

        input.value = "hidden";
        const document = globalThis.document as unknown as {
            visibilityState: string;
        } & import("./fake-dom").FakeGlobalTarget;
        document.visibilityState = "hidden";
        document.dispatchEvent(new FakeEvent("visibilitychange"));
        expect(
            (scope.get("nested {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom
                ?.fields,
        ).toEqual({ note: "hidden" });
    });

    test("dispose unbinds delegated input capture", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        dr.attach(asHTMLElement(outlet));
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "before" }]);
        outlet.appendChild(c);

        dr.dispose();

        // Update value then edit → should NOT be captured
        const inputEl = c
            .querySelector("[data-restore-root]")!
            .querySelector("[name]") as FakeElement;
        inputEl.value = "after";
        inputEl.dispatchEvent(new FakeEvent("input", { bubbles: true }));

        expect(scope.get("k {}")).toBeUndefined();
    });
});

test("nested data-fs-app roots are excluded from the parent capture", () => {
    const scope = createNavigationScopedState();
    const restore = createDomRestore({ scope, schedule: (callback) => callback() });
    const parent = new FakeElement("div");
    parent.setAttribute("data-fs-app", "");
    const outer = island("outer", [{ tag: "input", attrs: { name: "outer" }, value: "kept" }]);
    const nestedApp = new FakeElement("div");
    nestedApp.setAttribute("data-fs-app", "");
    const nested = island("nested", [{ tag: "input", attrs: { name: "nested" }, value: "skip" }]);
    nestedApp.appendChild(nested);
    outer.appendChild(nestedApp);
    parent.appendChild(outer);
    restore.attach(asHTMLElement(parent));
    restore.captureEntry(asHTMLElement(outer));
    expect(
        (scope.get("outer") as { __dom: { fields: Record<string, unknown> } }).__dom.fields,
    ).toEqual({ outer: "kept" });
});

// Keep TypeScript happy: FakeEvent is used by stub but the import might be
// flagged unused by the checker; reference it here.
void (FakeEvent as unknown);
