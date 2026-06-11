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

// ---------------------------------------------------------------------------
// CustomEvent stub — headless 环境没有 CustomEvent，用 vi.stubGlobal 注入。
// ---------------------------------------------------------------------------

class FakeCustomEvent {
    readonly type: string;
    readonly bubbles: boolean;
    target: FakeElement | null = null;
    constructor(type: string, init?: { bubbles?: boolean }) {
        this.type = type;
        this.bubbles = init?.bubbles ?? false;
    }
}

vi.stubGlobal("CustomEvent", FakeCustomEvent);

// ---------------------------------------------------------------------------
// FakeElement
// ---------------------------------------------------------------------------

class FakeElement {
    readonly tagName: string;
    private _attrs: Map<string, string> = new Map();
    private _children: FakeElement[] = [];
    private _parent: FakeElement | null = null;
    private _handlers: Map<string, ((e: FakeCustomEvent) => void)[]> = new Map();
    textContent = "";
    scrollTop = 0;
    scrollLeft = 0;

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

    /** Returns the first element matching the selector, or null. */
    querySelector(selector: string): FakeElement | null {
        const results = this.querySelectorAll(selector);
        return results[0] ?? null;
    }

    /** Supports exact-attribute-match selectors: [attr] and [attr="value"]. */
    querySelectorAll(selector: string): FakeElement[] {
        const results: FakeElement[] = [];
        const queue: FakeElement[] = [...this._children];
        while (queue.length > 0) {
            const el = queue.pop()!;
            if (matchesSelector(el, selector)) results.unshift(el);
            queue.push(...el._children);
        }
        return results;
    }

    addEventListener(type: string, handler: (e: FakeCustomEvent) => void): void {
        const list = this._handlers.get(type) ?? [];
        list.push(handler);
        this._handlers.set(type, list);
    }

    /**
     * Dispatch an event on this element and bubble up the _parent chain.
     * Faithfully models { bubbles: true } — event.target is set to the
     * originating element (the container the orchestrator dispatches on).
     */
    dispatchEvent(event: FakeCustomEvent): void {
        event.target = this;
        // Walk from dispatch target up through ancestors, invoking handlers.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let current: FakeElement | null = this;
        while (current !== null) {
            const handlers = current._handlers.get(event.type);
            if (handlers) {
                for (const h of handlers) h(event);
            }
            current = event.bubbles ? current._parent : null;
        }
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

// ---------------------------------------------------------------------------
// Task 2: fs:* 生命周期事件
// ---------------------------------------------------------------------------

describe("island orchestrator — fs:* 生命周期事件", () => {
    /**
     * 在 outlet 上委托监听 fs:* 事件（CustomEvent bubbles），记录 type:key。
     * 读 e.target 上的 data-key（由 makeMountEntry 写入）来标识哪个 island 触发。
     */
    function listen(outlet: HTMLElement, log: string[]): void {
        for (const type of ["fs:enter", "fs:reveal", "fs:conceal", "fs:exit"]) {
            (outlet as unknown as FakeElement).addEventListener(type, (e) => {
                const key = (e.target as unknown as FakeElement).getAttribute("data-key") ?? "";
                log.push(`${type}:${key}`);
            });
        }
    }

    test("挂载→可见 派发 enter 然后 reveal", () => {
        const outlet = document.createElement("div") as unknown as HTMLElement;
        const log: string[] = [];
        listen(outlet, log);
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry([]) });

        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        expect(log).toEqual([`fs:enter:${KEY("home")}`, `fs:reveal:${KEY("home")}`]);
    });

    test("push 使底层条目 conceal；pop 使其 reveal", () => {
        const outlet = document.createElement("div") as unknown as HTMLElement;
        const log: string[] = [];
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry([]) });
        // 先让 home 挂载+可见，再开始记录事件
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });
        listen(outlet, log);

        o.sync({ tree: stack([leaf("home"), leaf("detail")]), destinations: [dest("detail")] });
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        expect(log).toContain(`fs:conceal:${KEY("home")}`);
        expect(log).toContain(`fs:enter:${KEY("detail")}`);
        expect(log).toContain(`fs:reveal:${KEY("home")}`);
        expect(log).toContain(`fs:exit:${KEY("detail")}`); // detail 离树
    });

    test("dispose：已挂载 island 派发 fs:exit", () => {
        const outlet = document.createElement("div") as unknown as HTMLElement;
        const log: string[] = [];
        listen(outlet, log);
        const o = createIslandOrchestrator({ outlet, mountEntry: makeMountEntry([]) });
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });
        log.length = 0;

        o.dispose();

        expect(log).toContain(`fs:exit:${KEY("home")}`);
    });
});

// ---------------------------------------------------------------------------
// Task 3: 滚动 conceal/reveal 往返
// ---------------------------------------------------------------------------

describe("island orchestrator — 滚动 conceal/reveal 往返", () => {
    test("conceal 记录 scrollTop，reveal 重放", () => {
        const outlet = document.createElement("div") as unknown as HTMLElement;
        // mountEntry 在 container 内放一个带 data-fs-scroll 的可滚动元素
        const mountEntry: MountEntry = (_entry, container) => {
            const scroller = document.createElement("div") as unknown as HTMLElement;
            (scroller as unknown as FakeElement).setAttribute("data-fs-scroll", "");
            (container as unknown as FakeElement).appendChild(scroller as unknown as FakeElement);
            return { unmount() {} };
        };
        // 注入同步 scheduler（替代 rAF）便于断言
        const o = createIslandOrchestrator({ outlet, mountEntry, schedule: (cb) => cb() });

        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        // 找到 outlet 里的 data-fs-scroll 元素，设置 scrollTop
        const scroller = (outlet as unknown as FakeElement).querySelector(
            "[data-fs-scroll]",
        ) as unknown as FakeElement;
        scroller.scrollTop = 120;

        // push detail → home conceal（记录 120）
        o.sync({ tree: stack([leaf("home"), leaf("detail")]), destinations: [dest("detail")] });
        // 模拟 detach 期间 scrollTop 归零（真实浏览器行为；jsdom 需手动置 0 验证重放）
        scroller.scrollTop = 0;
        // pop → home reveal → 重放 120
        o.sync({ tree: stack([leaf("home")]), destinations: [dest("home")] });

        expect(scroller.scrollTop).toBe(120);
    });
});
