import { describe, expect, test } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import { vi } from "vite-plus/test";
import { createNavigationScopedState } from "@finesoft/core";
import { FakeCustomEvent, FakeElement, FakeEvent, stubDomGlobals } from "./fake-dom";
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
    /** Trigger a bubbling CustomEvent on target (models orchestrator fs:* dispatch). */
    function fire(target: FakeElement, type: string): void {
        target.dispatchEvent(new FakeCustomEvent(type, { bubbles: true }));
    }

    test("fs:conceal → 捕获该 island 进 scope", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        dr.attach(asHTMLElement(outlet));
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "typed" }]);
        outlet.appendChild(c);

        fire(c, "fs:conceal");

        const dom = (scope.get("k {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom;
        expect(dom?.fields).toEqual({ note: "typed" });
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

    test("attach 时 catch-up：对已 attached 的 island 立即回填一次（boot 路径）", () => {
        const scope = createNavigationScopedState();
        scope.set("k {}", { __dom: { fields: { note: "boot" } } });
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "" }]);
        outlet.appendChild(c); // boot: island already in outlet before attach

        dr.attach(asHTMLElement(outlet)); // catch-up should restore

        const inputEl = c
            .querySelector("[data-restore-root]")!
            .querySelector("[name]") as FakeElement;
        expect(inputEl.value).toBe("boot");
    });

    test("fs:enter → 回填（会话内新挂载，scope 空则 no-op）", () => {
        const scope = createNavigationScopedState();
        scope.set("k {}", { __dom: { fields: { note: "later" } } });
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        dr.attach(asHTMLElement(outlet));
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "" }]);
        outlet.appendChild(c);

        fire(c, "fs:enter");

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

    test("dispose 解绑：dispose 后 fs:conceal 不再捕获", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = new FakeElement("div");
        dr.attach(asHTMLElement(outlet));
        const c = island("k {}", [{ tag: "input", attrs: { name: "note" }, value: "before" }]);
        outlet.appendChild(c);

        dr.dispose();

        // Update value then conceal → should NOT be captured
        const inputEl = c
            .querySelector("[data-restore-root]")!
            .querySelector("[name]") as FakeElement;
        inputEl.value = "after";
        fire(c, "fs:conceal");

        expect(scope.get("k {}")).toBeUndefined();
    });
});

// Keep TypeScript happy: FakeEvent is used by stub but the import might be
// flagged unused by the checker; reference it here.
void (FakeEvent as unknown);
