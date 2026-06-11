import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

import {
    leaf,
    sessionEntryKey,
    stack,
    tabs,
    type BasePage,
    type NavigationSnapshot,
    type ResolvedDestination,
} from "@finesoft/core";
import {
    createIslandOrchestrator,
    type IslandHandle,
    type MountEntry,
    type ResolvedEntry,
} from "../src/navigation-islands";

// ---------------------------------------------------------------------------
// 极简 DOM 实现（项目无 jsdom/happy-dom；对齐 start-app.test 用 vi.stubGlobal 风格）
// ---------------------------------------------------------------------------

class FakeElement {
    readonly tagName: string;
    private _attrs: Map<string, string> = new Map();
    private _children: FakeElement[] = [];
    private _parent: FakeElement | null = null;
    textContent = "";

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
    }

    setAttribute(name: string, value: string): void {
        this._attrs.set(name, value);
    }

    getAttribute(name: string): string | null {
        return this._attrs.has(name) ? (this._attrs.get(name) ?? null) : null;
    }

    hasAttribute(name: string): boolean {
        return this._attrs.has(name);
    }

    appendChild(child: FakeElement): void {
        if (child._parent === this) {
            // already child → move to end (re-order)
            this._children = this._children.filter((c) => c !== child);
        } else {
            child._parent?.removeChild(child);
        }
        this._children.push(child);
        child._parent = this;
    }

    removeChild(child: FakeElement): void {
        this._children = this._children.filter((c) => c !== child);
        child._parent = null;
    }

    remove(): void {
        this._parent?.removeChild(this);
    }

    /** Supports exact-attribute-match selectors: [attr] and [attr="value"]. */
    querySelectorAll(selector: string): FakeElement[] {
        const results: FakeElement[] = [];
        const stack: FakeElement[] = [...this._children];
        while (stack.length > 0) {
            const el = stack.pop()!;
            if (matchesSelector(el, selector)) results.unshift(el);
            stack.push(...el._children);
        }
        return results;
    }

    get children(): FakeElement[] {
        return [...this._children];
    }

    get parentElement(): FakeElement | null {
        return this._parent;
    }
}

/** Match a single CSS selector token against a FakeElement (supports [attr] and [attr="val"]). */
function matchesSelector(el: FakeElement, selector: string): boolean {
    // handle comma-joined selectors by splitting and OR-ing
    for (const part of selector.split(",").map((s) => s.trim())) {
        if (matchesSingleSelector(el, part)) return true;
    }
    return false;
}

function matchesSingleSelector(el: FakeElement, selector: string): boolean {
    // strip tag prefix if present (e.g. "div[attr]")
    const attrRe = /\[([^\]=]+)(?:="([^"]*)")?\]/g;
    let match: RegExpExecArray | null;
    let matched = true;
    while ((match = attrRe.exec(selector)) !== null) {
        const [, name, value] = match;
        if (value === undefined) {
            if (!el.hasAttribute(name!)) {
                matched = false;
                break;
            }
        } else {
            if (el.getAttribute(name!) !== value) {
                matched = false;
                break;
            }
        }
    }
    return matched;
}

/** Build a stub document and register as global. */
function makeFakeDocument(): { createElement(tag: string): FakeElement } {
    return {
        createElement(tag: string): FakeElement {
            return new FakeElement(tag);
        },
    };
}

// Register the fake document globally so navigation-islands.ts can call document.createElement.
vi.stubGlobal("document", makeFakeDocument());

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** 构造一个 ResolvedDestination（page 用 intent 编进去，方便断言）。 */
function dest(intent: string, params: Record<string, unknown> = {}): ResolvedDestination {
    return { intent, params, page: { id: intent, pageType: intent, title: intent } as BasePage };
}

/** 记录所有 mountEntry / unmount 调用 + 把 entryKey 写进 container 供 DOM 断言。 */
function makeMountEntry(events: string[]): MountEntry {
    return (entry: ResolvedEntry, container: HTMLElement): IslandHandle => {
        events.push(`mount:${entry.entryKey}`);
        container.setAttribute("data-key", entry.entryKey);
        container.textContent = entry.page.title ?? "";
        return {
            unmount(): void {
                events.push(`unmount:${entry.entryKey}`);
            },
        };
    };
}

/** 该 outlet 内当前 attached（在 outlet DOM 树里）的 island 的 data-key，按 DOM 序。 */
function attachedKeys(outlet: HTMLElement): string[] {
    return (outlet as unknown as FakeElement)
        .querySelectorAll("[data-fs-entry]")
        .map((el) => el.getAttribute("data-key") ?? "");
}

const KEY = (intent: string, params: Record<string, unknown> = {}): string =>
    sessionEntryKey(intent, params);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("island orchestrator — 生命周期", () => {
    test("首屏可见目标各 mountEntry 一次并 attach 进 outlet", () => {
        const events: string[] = [];
        const outlet = document.createElement("div") as unknown as HTMLElement;
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        expect(events).toEqual([`mount:${KEY("home")}`]);
        expect(attachedKeys(outlet)).toEqual([KEY("home")]);
    });

    test("push 新目标：仅新目标 mountEntry，底层条目仍挂载但 detach（出 outlet）", () => {
        const events: string[] = [];
        const outlet = document.createElement("div") as unknown as HTMLElement;
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });
        events.length = 0;

        // push detail：tree=[home,detail]，可见=[detail]，home 仍 present 但不可见。
        o.sync({ tree: stack([leaf("home"), leaf("detail")]), destinations: [dest("detail")] });

        expect(events).toEqual([`mount:${KEY("detail")}`]); // home 不重挂、不 unmount（保活）
        expect(attachedKeys(outlet)).toEqual([KEY("detail")]); // home detach 出 document
    });

    test("pop 回 home：复用 home 的活实例（不重挂、不 unmount），detail 仍 present→保活 detach", () => {
        const events: string[] = [];
        const outlet = document.createElement("div") as unknown as HTMLElement;
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        o.sync({ tree: stack([leaf("home"), leaf("detail")]), destinations: [dest("detail")] });
        // 注意：上一步 home 从未可见过 → 未挂载。先让 home 可见一次再 push，模拟真实路径。
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] }); // home 挂载
        o.sync({ tree: stack([leaf("home"), leaf("detail")]), destinations: [dest("detail")] }); // detail 挂载，home detach
        events.length = 0;

        // pop：tree=[home]，可见=[home]。home 仍在 mounted → 复用 + 重 attach；detail 离树 → unmount。
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        expect(events).toEqual([`unmount:${KEY("detail")}`]); // detail 离树 unmount；home 不重挂
        expect(attachedKeys(outlet)).toEqual([KEY("home")]); // home 重 attach
    });

    test("split 多可见目标：按 destinations 顺序 attach 为 outlet 的有序子节点", () => {
        const events: string[] = [];
        const outlet = document.createElement("div") as unknown as HTMLElement;
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        o.sync({
            tree: stack([leaf("x")]), // tree 形态不影响：present 由 collectAllLeaves 取，可见由 destinations 定
            destinations: [dest("list"), dest("detail")],
        });
        // 但 present 集来自 tree（这里 tree 只有 x）——list/detail 不在 present 集会被立刻 unmount。
        // 因此用一个真实 split 形态的树：
        o.sync({
            tree: {
                kind: "split",
                columns: [
                    { id: "l", content: leaf("list") },
                    { id: "d", content: leaf("detail") },
                ],
            } as NavigationSnapshot["tree"],
            destinations: [dest("list"), dest("detail")],
        });

        expect(attachedKeys(outlet)).toEqual([KEY("list"), KEY("detail")]);
    });

    test("离树条目 unmount：tabs 切到只剩另一分支可见时，旧可见叶子仍 present（保活），真正离树才 unmount", () => {
        const events: string[] = [];
        const outlet = document.createElement("div") as unknown as HTMLElement;
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });

        const tree = tabs({
            active: "home",
            branches: { home: leaf("home"), notes: leaf("notes") },
        });
        o.sync({ tree, destinations: [dest("home")] }); // home 挂载
        o.sync({
            tree: tabs({ active: "notes", branches: { home: leaf("home"), notes: leaf("notes") } }),
            destinations: [dest("notes")],
        });
        // 切到 notes：home 分支仍在 tabs 树中（present）→ home 保活 detach，不 unmount；notes 挂载。
        expect(events).toEqual([`mount:${KEY("home")}`, `mount:${KEY("notes")}`]);
        expect(attachedKeys(outlet)).toEqual([KEY("notes")]);
    });

    test("dispose：unmount 全部 island 并清空 outlet", () => {
        const events: string[] = [];
        const outlet = document.createElement("div") as unknown as HTMLElement;
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry(events) });
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });
        events.length = 0;

        o.dispose();

        expect(events).toEqual([`unmount:${KEY("home")}`]);
        expect((outlet as unknown as FakeElement).children).toHaveLength(0);
    });
});
