# 会话恢复完整实现 · Phase 3：重载 DOM 自动恢复（@finesoft/browser）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 islands 应用加 opt-in 的「重载 DOM 自动恢复」（spec §4.5）：标了 `data-restore-root` 的容器内，表单值 / `<details>` / 滚动自动捕获进会话作用域 `scope[entryKey].__dom`（随会话快照落 `sessionStorage`），刷新/冷启动重挂后自动回填——受控输入派发合成 `input`/`change` 事件驱动 `v-model`。「标一次容器，之后零代码」，正面解决「写个 input 还要写一堆逻辑」。

**Architecture:** 新增纯模块 `dom-restore.ts`，导出 `createDomRestore({ scope })`。它通过 island 编排器在 container 上派发的 `fs:*` 事件接线（事件委托在 outlet）：`fs:enter` → 回填该 island；`fs:conceal` → 捕获（detach 前存末态，供重载）；`input`/`change`（委托）→ 实时捕获进 scope；`pagehide`/`visibilitychange(hidden)` → flush 可见 island。`attach(outlet)` 末尾做一次 **catch-up 恢复**（boot 时 islands 已挂载、`fs:enter` 已过，对当前 attached 的 island 立即回填一次，依赖会话已先恢复 scope）。捕获只取 `data-restore-root` 内、有 `name`/`data-restore-key` 的字段，排除 `input[type=password]` 与 `[data-restore-ignore]`。`startBrowserApp` 加 opt-in `domRestore`，仅当同时有 islands（`navigation.mountEntry`）+ `session` 时生效。

**Tech Stack:** TypeScript（strict）、Vite+、Vitest（jsdom）。仅改 `@finesoft/browser`（+ `front` 再导出）。**依赖 Phase 1（scope 经会话持久化）+ Phase 2（islands + `fs:*` 事件 + container 上的 `data-fs-key`）。**

**落地分支：** `feat/session-restoration`。全局约定同 Phase 1/2。

---

## Task 1：`dom-restore` 捕获/回填核心（纯函数 + 模块）

**Files:**

- Create: `packages/browser/src/dom-restore.ts`
- Test: `packages/browser/test/dom-restore.test.ts`

- [ ] **Step 1：写失败测试**

新建 `packages/browser/test/dom-restore.test.ts`：

```ts
import { describe, expect, test } from "vite-plus/test";
import { createNavigationScopedState } from "@finesoft/core";
import { createDomRestore } from "../src/dom-restore";

/** 造一个 island container：data-fs-entry + data-fs-key + 内含 data-restore-root。 */
function island(key: string, innerHTML: string): HTMLElement {
    const c = document.createElement("div");
    c.setAttribute("data-fs-entry", "");
    c.setAttribute("data-fs-key", key);
    c.innerHTML = `<div data-restore-root>${innerHTML}</div>`;
    return c;
}

describe("dom-restore — 捕获", () => {
    test("捕获 data-restore-root 内带 name 的输入值进 scope[key].__dom.fields", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const c = island("home {}", `<input name="note" value="draft" />`);

        dr.captureEntry(c);

        const dom = (scope.get("home {}") as { __dom?: { fields?: Record<string, unknown> } })
            .__dom;
        expect(dom?.fields).toEqual({ note: "draft" });
    });

    test("排除 password / data-restore-ignore / 无 key 字段", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const c = island(
            "k {}",
            `<input name="pw" type="password" value="secret" />
             <input name="ign" value="x" data-restore-ignore />
             <input value="nokey" />
             <input name="ok" value="kept" />`,
        );

        dr.captureEntry(c);

        const dom = (scope.get("k {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom;
        expect(dom?.fields).toEqual({ ok: "kept" }); // 仅 ok
    });

    test("捕获 checkbox.checked、details.open、data-restore-key 优先于 name", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const c = island(
            "k {}",
            `<input type="checkbox" name="agree" checked />
             <input name="ignored-name" data-restore-key="kk" value="v" />
             <details data-restore-key="sec" open></details>`,
        );

        dr.captureEntry(c);

        const dom = (
            scope.get("k {}") as {
                __dom?: { fields?: Record<string, unknown>; details?: Record<string, boolean> };
            }
        ).__dom;
        expect(dom?.fields).toEqual({ agree: true, kk: "v" });
        expect(dom?.details).toEqual({ sec: true });
    });
});

describe("dom-restore — 回填", () => {
    test("回填输入值并派发合成 input/change（驱动受控绑定）", () => {
        const scope = createNavigationScopedState();
        scope.set("home {}", { __dom: { fields: { note: "restored" } } });
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const c = island("home {}", `<input name="note" value="" />`);
        const inputEvents: string[] = [];
        c.querySelector("input")!.addEventListener("input", () => inputEvents.push("input"));
        c.querySelector("input")!.addEventListener("change", () => inputEvents.push("change"));

        dr.restoreEntry(c);

        expect((c.querySelector("input") as HTMLInputElement).value).toBe("restored");
        expect(inputEvents).toEqual(["input", "change"]); // 合成事件已派发
    });

    test("scope 无 __dom 时回填是 no-op", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const c = island("home {}", `<input name="note" value="orig" />`);
        dr.restoreEntry(c);
        expect((c.querySelector("input") as HTMLInputElement).value).toBe("orig");
    });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/browser/test/dom-restore.test.ts`
Expected: FAIL —— `dom-restore` 不存在 / `createDomRestore` 未导出。

- [ ] **Step 3：实现模块（捕获/回填核心 + `captureEntry`/`restoreEntry`）**

新建 `packages/browser/src/dom-restore.ts`：

```ts
/**
 * 重载 DOM 自动恢复（spec §4.5）—— islands 应用 opt-in。
 *
 * 标 `data-restore-root` 的容器内：表单值 / <details> / 滚动自动捕获进会话作用域
 * `scope[entryKey].__dom`（随会话快照落盘），刷新/冷启动重挂后回填。受控输入派发合成
 * input/change 驱动 v-model。安全：仅 data-restore-root 内、有 name/data-restore-key 的字段，
 * 排除 password 与 data-restore-ignore。
 */

import type { NavigationScopedState } from "@finesoft/core";

interface DomState {
    readonly fields?: Record<string, string | boolean>;
    readonly details?: Record<string, boolean>;
    readonly scroll?: Record<string, { top: number; left: number }>;
}

export interface DomRestoreOptions {
    /** 会话作用域（来自 SessionHandle.scope）；DOM 状态写进 `scope[key].__dom`。 */
    readonly scope: NavigationScopedState;
    /** 回填调度（默认 requestAnimationFrame；测试可注入同步执行）。 */
    readonly schedule?: (cb: () => void) => void;
}

export interface DomRestore {
    /** 捕获一个 island container 的 DOM 状态进 scope（供测试 + 内部接线复用）。 */
    captureEntry(container: HTMLElement): void;
    /** 回填一个 island container（从 scope 读，scheduled）。 */
    restoreEntry(container: HTMLElement): void;
    /** 接线进 outlet（fs:* / input / pagehide + boot catch-up）。 */
    attach(outlet: HTMLElement): void;
    /** 解绑全部监听（幂等）。 */
    dispose(): void;
}

/** 取 container 内全部 data-restore-root 子树（容器自身若标了也算）。 */
function restoreRoots(container: HTMLElement): HTMLElement[] {
    const roots: HTMLElement[] = [];
    if (container.hasAttribute("data-restore-root")) roots.push(container);
    for (const el of container.querySelectorAll<HTMLElement>("[data-restore-root]")) roots.push(el);
    return roots;
}

/** 字段键：data-restore-key 优先，否则 name；都无返回 undefined（不捕获）。 */
function fieldKey(el: Element): string | undefined {
    return (
        (el.getAttribute("data-restore-key") ?? (el as HTMLInputElement).name ?? undefined) ||
        undefined
    );
}

function keyOf(container: HTMLElement): string | undefined {
    return container.getAttribute("data-fs-key") ?? undefined;
}

export function createDomRestore(options: DomRestoreOptions): DomRestore {
    const { scope } = options;
    const schedule =
        options.schedule ??
        ((cb: () => void) => {
            if (typeof requestAnimationFrame === "function") requestAnimationFrame(cb);
            else cb();
        });

    function collect(container: HTMLElement): DomState {
        const fields: Record<string, string | boolean> = {};
        const details: Record<string, boolean> = {};
        const scroll: Record<string, { top: number; left: number }> = {};
        for (const root of restoreRoots(container)) {
            for (const el of root.querySelectorAll<HTMLInputElement>("input, textarea, select")) {
                if ((el as HTMLInputElement).type === "password") continue;
                if (el.hasAttribute("data-restore-ignore")) continue;
                const key = fieldKey(el);
                if (!key) continue;
                const type = (el as HTMLInputElement).type;
                fields[key] =
                    type === "checkbox" || type === "radio"
                        ? (el as HTMLInputElement).checked
                        : el.value;
            }
            for (const d of root.querySelectorAll<HTMLDetailsElement>("details")) {
                const key = d.getAttribute("data-restore-key") ?? d.id;
                if (key) details[key] = d.open;
            }
            for (const s of root.querySelectorAll<HTMLElement>("[data-restore-scroll]")) {
                const key =
                    s.getAttribute("data-restore-key") ?? s.getAttribute("data-restore-scroll");
                if (key) scroll[key] = { top: s.scrollTop, left: s.scrollLeft };
            }
        }
        return { fields, details, scroll };
    }

    function captureEntry(container: HTMLElement): void {
        const key = keyOf(container);
        if (!key) return;
        const bag = (scope.get(key) as Record<string, unknown> | undefined) ?? {};
        scope.set(key, { ...bag, __dom: collect(container) });
    }

    function apply(container: HTMLElement, dom: DomState): void {
        for (const root of restoreRoots(container)) {
            for (const [key, val] of Object.entries(dom.fields ?? {})) {
                const el = root.querySelector<HTMLInputElement>(
                    `[data-restore-key="${key}"], [name="${key}"]`,
                );
                if (!el) continue;
                if (typeof val === "boolean") el.checked = val;
                else el.value = val;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            }
            for (const [key, open] of Object.entries(dom.details ?? {})) {
                const d =
                    root.querySelector<HTMLDetailsElement>(`details[data-restore-key="${key}"]`) ??
                    root.querySelector<HTMLDetailsElement>(`details#${CSS.escape(key)}`);
                if (d) d.open = open;
            }
            for (const [key, pos] of Object.entries(dom.scroll ?? {})) {
                const s = root.querySelector<HTMLElement>(
                    `[data-restore-scroll="${key}"], [data-restore-key="${key}"]`,
                );
                if (s) {
                    s.scrollTop = pos.top;
                    s.scrollLeft = pos.left;
                }
            }
        }
    }

    function restoreEntry(container: HTMLElement): void {
        const key = keyOf(container);
        if (!key) return;
        const dom = (scope.get(key) as { __dom?: DomState } | undefined)?.__dom;
        if (!dom) return;
        schedule(() => apply(container, dom));
    }

    // attach / dispose 在 Task 2 实现；先给占位以满足接口（Task 2 替换）。
    function attach(_outlet: HTMLElement): void {
        throw new Error("not implemented until Task 2");
    }
    function dispose(): void {}

    return { captureEntry, restoreEntry, attach, dispose };
}
```

> 注：`attach`/`dispose` 在 Task 2 落地，本任务先建 `captureEntry`/`restoreEntry` 并测试通过（attach 暂抛错，本任务测试不触发它）。

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/browser/test/dom-restore.test.ts`
Expected: PASS（捕获 3 + 回填 2 共 5 用例）。

- [ ] **Step 5：提交**

```bash
git add packages/browser/src/dom-restore.ts packages/browser/test/dom-restore.test.ts
git commit -m "feat(browser): dom-restore 捕获/回填核心（排除 password、合成事件回填）"
```

---

## Task 2：`attach` 接线（fs:\* / input / pagehide + boot catch-up）

**Files:**

- Modify: `packages/browser/src/dom-restore.ts`
- Test: `packages/browser/test/dom-restore.test.ts`

- [ ] **Step 1：写失败测试**（追加 describe）

```ts
describe("dom-restore — attach 接线", () => {
    /** 触发一个冒泡 CustomEvent（模拟编排器的 fs:* 派发）。 */
    function fire(target: HTMLElement, type: string): void {
        target.dispatchEvent(new CustomEvent(type, { bubbles: true }));
    }

    test("fs:conceal → 捕获该 island 进 scope", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = document.createElement("div");
        dr.attach(outlet);
        const c = island("k {}", `<input name="note" value="typed" />`);
        outlet.appendChild(c);

        fire(c, "fs:conceal");

        const dom = (scope.get("k {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom;
        expect(dom?.fields).toEqual({ note: "typed" });
    });

    test("input 事件（委托）→ 实时捕获", () => {
        const scope = createNavigationScopedState();
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = document.createElement("div");
        dr.attach(outlet);
        const c = island("k {}", `<input name="note" value="" />`);
        outlet.appendChild(c);

        const input = c.querySelector("input") as HTMLInputElement;
        input.value = "x";
        input.dispatchEvent(new Event("input", { bubbles: true }));

        const dom = (scope.get("k {}") as { __dom?: { fields?: Record<string, unknown> } }).__dom;
        expect(dom?.fields).toEqual({ note: "x" });
    });

    test("attach 时 catch-up：对已 attached 的 island 立即回填一次（boot 路径）", () => {
        const scope = createNavigationScopedState();
        scope.set("k {}", { __dom: { fields: { note: "boot" } } });
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = document.createElement("div");
        const c = island("k {}", `<input name="note" value="" />`);
        outlet.appendChild(c); // boot：island 已在 outlet（fs:enter 已过）

        dr.attach(outlet); // catch-up 应回填

        expect((c.querySelector("input") as HTMLInputElement).value).toBe("boot");
    });

    test("fs:enter → 回填（会话内新挂载，scope 空则 no-op）", () => {
        const scope = createNavigationScopedState();
        scope.set("k {}", { __dom: { fields: { note: "later" } } });
        const dr = createDomRestore({ scope, schedule: (cb) => cb() });
        const outlet = document.createElement("div");
        dr.attach(outlet);
        const c = island("k {}", `<input name="note" value="" />`);
        outlet.appendChild(c);

        fire(c, "fs:enter");

        expect((c.querySelector("input") as HTMLInputElement).value).toBe("later");
    });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/browser/test/dom-restore.test.ts -t "attach 接线"`
Expected: FAIL —— `attach` 抛 `not implemented until Task 2`。

- [ ] **Step 3：实现 `attach`/`dispose`**

替换 Task 1 中的占位 `attach`/`dispose`：

```ts
let boundOutlet: HTMLElement | undefined;

/** 从事件 target 上溯到 island container。 */
function containerOf(target: EventTarget | null): HTMLElement | undefined {
    return (target as HTMLElement | null)?.closest<HTMLElement>("[data-fs-entry]") ?? undefined;
}

const onEnter = (e: Event): void => {
    const c = containerOf(e.target);
    if (c) restoreEntry(c);
};
const onConceal = (e: Event): void => {
    const c = containerOf(e.target);
    if (c) captureEntry(c);
};
const onEdit = (e: Event): void => {
    const c = containerOf(e.target);
    if (c) captureEntry(c);
};
const flushVisible = (): void => {
    if (!boundOutlet) return;
    for (const c of boundOutlet.querySelectorAll<HTMLElement>("[data-fs-entry]")) captureEntry(c);
};
const onVisibility = (): void => {
    if (document.visibilityState === "hidden") flushVisible();
};

function attach(outlet: HTMLElement): void {
    boundOutlet = outlet;
    outlet.addEventListener("fs:enter", onEnter);
    outlet.addEventListener("fs:conceal", onConceal);
    outlet.addEventListener("input", onEdit, true);
    outlet.addEventListener("change", onEdit, true);
    window.addEventListener("pagehide", flushVisible);
    document.addEventListener("visibilitychange", onVisibility);
    // boot catch-up：islands 在会话恢复 scope 之前已挂载（fs:enter 已过），对当前 attached 的回填一次。
    for (const c of outlet.querySelectorAll<HTMLElement>("[data-fs-entry]")) restoreEntry(c);
}

function dispose(): void {
    if (!boundOutlet) return;
    boundOutlet.removeEventListener("fs:enter", onEnter);
    boundOutlet.removeEventListener("fs:conceal", onConceal);
    boundOutlet.removeEventListener("input", onEdit, true);
    boundOutlet.removeEventListener("change", onEdit, true);
    window.removeEventListener("pagehide", flushVisible);
    document.removeEventListener("visibilitychange", onVisibility);
    boundOutlet = undefined;
}
```

（删除 Task 1 里 `throw new Error("not implemented until Task 2")` 的占位 `attach` 与空 `dispose`。）

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/browser/test/dom-restore.test.ts`
Expected: PASS（全部，含此前 Task 1 用例不回归）。

- [ ] **Step 5：提交**

```bash
git add packages/browser/src/dom-restore.ts packages/browser/test/dom-restore.test.ts
git commit -m "feat(browser): dom-restore attach 接线（fs:*/input/pagehide + boot catch-up）"
```

---

## Task 3：接线进 `startBrowserApp`（opt-in `domRestore`）

`domRestore` 仅当同时有 islands（`navigation.mountEntry`）+ `session` 时生效。`activateNavigation` 暴露 outlet 供接线；DomRestore 在会话激活（scope 已恢复）后 attach，catch-up 回填 boot DOM。

**Files:**

- Modify: `packages/browser/src/start-app.ts`
- Modify: `packages/browser/src/index.ts`
- Test: `packages/browser/test/start-app.test.ts`

- [ ] **Step 1：写失败测试**

```ts
describe("startBrowserApp — domRestore（islands + session）", () => {
    test("opt-in domRestore：boot 时从会话 scope 回填 island 表单值", async () => {
        document.body.innerHTML = `<div id="app"></div>`;
        // 预置会话快照：scoped[home].__dom.fields.note = "restored"
        const storage = makeMemoryStorage(); // 见本文件既有存储替身；无则用 createWebStorage("session") 并 seed
        seedSessionSnapshot(storage, {
            scoped: { [sessionEntryKey("home", {})]: { __dom: { fields: { note: "restored" } } } },
        });

        await startBrowserApp({
            bootstrap: (fw) =>
                defineRoutes(fw, [
                    {
                        path: "/",
                        intentId: "home",
                        controller: {
                            intentId: "home",
                            execute: () => ({ id: "home", pageType: "home", title: "Home" }),
                        },
                    },
                ]),
            mount: (target) => {
                target.innerHTML = `<main data-fs-outlet></main>`;
                return () => undefined;
            },
            callbacks: { onNavigate() {}, onModal() {} },
            navigation: {
                initial: leaf("home"),
                mountEntry: (entry, container) => {
                    container.innerHTML = `<div data-restore-root><input name="note" value="" /></div>`;
                    return { unmount() {} };
                },
            },
            session: { storage },
            domRestore: true,
        });

        // schedule 默认 rAF：等一帧
        await new Promise((r) => requestAnimationFrame(() => r(undefined)));
        const input = document.querySelector("[data-fs-outlet] input") as HTMLInputElement;
        expect(input.value).toBe("restored");
    });
});
```

> `makeMemoryStorage` / `seedSessionSnapshot` 按 `start-app.test.ts` / `session-bridge.test.ts` 既有存储替身风格实现（seed 一份 `SessionSnapshot`，version 用 `SESSION_DEFAULT_VERSION`，navigation 设为根 `/` 对应位置以通过 `defaultShouldRestore`）。若既有测试已有等价 helper，直接复用。

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/browser/test/start-app.test.ts -t "domRestore"`
Expected: FAIL —— `BrowserAppConfig` 无 `domRestore`（类型错）/ input 值仍为空。

- [ ] **Step 3：实现接线**

`start-app.ts`：

**(a)** import：

```ts
import { createDomRestore } from "./dom-restore";
```

**(b)** `BrowserAppConfig` 加 `domRestore`（放 `session` 字段附近）：

```ts
    /**
     * opt-in 重载 DOM 自动恢复（spec §4.5）。仅当同时提供 `navigation.mountEntry`（islands）+
     * `session` 时生效：标 `data-restore-root` 的容器内表单/滚动/<details> 自动捕获进会话作用域、
     * 重载后回填。缺省关闭。
     */
    domRestore?: boolean;
```

**(c)** `ActivatedNavigation` 暴露 outlet：

```ts
interface ActivatedNavigation {
    readonly handle: NavigationHandle;
    readonly controller: NavigationController;
    /** islands 的 outlet（仅 mountEntry 提供时存在）。 */
    readonly outlet?: HTMLElement;
}
```

`activateNavigation` 里把 outlet 纳入返回。改 islands 分支与 return：

```ts
let outlet: HTMLElement | undefined;
if (navigation.mountEntry) {
    const found = target.querySelector<HTMLElement>("[data-fs-outlet]");
    if (!found) {
        throw new Error(
            "[startBrowserApp] navigation.mountEntry 已提供，但找不到 [data-fs-outlet]。",
        );
    }
    outlet = found;
    const orchestrator = createIslandOrchestrator({ outlet, mountEntry: navigation.mountEntry });
    orchestrator.sync(controller.getSnapshot());
    controller.subscribe((snapshot) => orchestrator.sync(snapshot));
}

return { handle, controller, outlet };
```

**(d)** 会话激活后（6.7 之后）接 DomRestore（新 6.8）：

```ts
// 6.7 会话恢复 ...（保持不变，拿到 handle）...
let sessionHandle: SessionHandle | undefined;
if (config.session) {
    sessionHandle = await activateSession({/* ...原参数... */});
    await config.onSessionReady?.(sessionHandle);
}

// 6.8 重载 DOM 自动恢复（opt-in）—— 需 islands outlet + session scope。
if (config.domRestore && activatedNavigation?.outlet && sessionHandle) {
    const domRestore = createDomRestore({ scope: sessionHandle.scope });
    domRestore.attach(activatedNavigation.outlet); // attach 内 catch-up 回填 boot DOM
}
```

> 注：原 6.7 块若是 `const handle = await activateSession(...)` 内联，改为上面的 `let sessionHandle`，把它带到 6.8。`activateSession` 的参数原样不动。

`index.ts` 导出：

```ts
// ===== DOM Restore =====
export { createDomRestore, type DomRestore, type DomRestoreOptions } from "./dom-restore";
```

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/browser/test/start-app.test.ts -t "domRestore"`
Expected: PASS。再 `vp test packages/browser` 确认无回归（`domRestore` 缺省关闭，既有用例不受影响）。

- [ ] **Step 5：scoped 校验 + 提交**

Run: `vp check packages/browser/src packages/browser/test`
Expected: PASS。

```bash
git add packages/browser/src/start-app.ts packages/browser/src/index.ts packages/browser/test/start-app.test.ts
git commit -m "feat(browser): startBrowserApp 接 dom-restore —— opt-in domRestore（islands + session）"
```

---

## Task 4：`front` 再导出 + 全量验证

**Files:**

- Modify: `packages/front/src/index.ts`（对齐既有再导出 browser 符号处）

- [ ] **Step 1：再导出**

补 `createDomRestore`、`DomRestore`、`DomRestoreOptions`（grep 定位 `createSessionBridge` 再导出处，同级追加）。

- [ ] **Step 2：构建 + 全量验证**

Run: `vp run -r build`
Expected: 全包构建通过。

Run: `vp test packages/browser packages/front`
Expected: PASS。

- [ ] **Step 3：提交**

```bash
git add packages/front/src/index.ts
git commit -m "feat(front): 再导出 dom-restore 符号"
```

---

## Phase 3 完成定义（DoD）

- `createDomRestore` 落地：`data-restore-root` 内表单/details/scroll 捕获进 `scope[key].__dom`，排除 password/ignore/无 key。
- 回填派发合成 input/change 驱动受控绑定。
- `attach` 经 `fs:*`/`input`/`pagehide` 接线 + boot catch-up；`dispose` 幂等解绑。
- `startBrowserApp({ domRestore: true })` 在 islands + session 下生效；缺省关闭、不破。
- `front` 再导出；`vp run -r build` + `vp test packages/browser packages/front` + `vp check` 全绿。

## 自审记录

- **spec 覆盖**：§4.5（重载序列化兜底——自动 DOM 子集捕获/回填 + 合成事件）、§4.1 安全（opt-in data-restore-root、排除 password）、§8 browser（dom-restore + start-app + index）。
- **占位扫描**：无 TBD（Task 1 的 attach 占位明确标注 Task 2 替换，且本任务测试不触发）；每步完整代码。
- **类型一致**：`DomRestore`（captureEntry/restoreEntry/attach/dispose）、`DomRestoreOptions`（scope/schedule）、`DomState`（fields/details/scroll）跨任务一致；`scope[key].__dom` 约定贯穿捕获与回填；依赖 Phase 2 的 `data-fs-key` 与 `fs:*` 事件。
- **已知 caveat（写进使用指南）**：合成 input/change 会触发受控组件的校验/watch 副作用；不监听原生事件的自定义组件收不到（这类仍需应用显式绑定）；`apply` 用 rAF，boot 时机依赖「会话先恢复 scope、再 DomRestore.attach catch-up」的顺序（start-app 6.7 → 6.8 保证）。
