# SSR-of-islands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 服务端把可见 island 内容渲进首屏 HTML 的 outlet，客户端水合既有标记而非新建挂载；keep-alive + 重载恢复不回归。

**Architecture:** 方案 C —— outlet 置于 chrome 水合根之外（sibling），chrome 应用与各 island 是独立 hydration root，chrome 水合永不跨 island DOM。标记契约单点在 core（`islandContainerAttributes`），服务端 helper（`renderIslandsHtml`，ssr）与客户端 orchestrator（首次 sync 收养水合）共用，按 `data-fs-key` 匹配。

**Tech Stack:** TypeScript（strict）、Vite+（`vp`，测试导入 `vite-plus/test`，无 jsdom → 用 `packages/browser/test/fake-dom.ts`）、Vue 3 SSR（`createSSRApp` / `renderToString`）、playwright。

**设计依据:** [docs/superpowers/specs/2026-06-11-ssr-of-islands-design.md](../specs/2026-06-11-ssr-of-islands-design.md)

---

## File Structure

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `packages/core/src/navigation/islands.ts` | `ResolvedEntry`（含 `hydrate?`）+ `islandContainerAttributes`（共享标记） | 创建 |
| `packages/core/src/navigation/index.ts` | barrel 导出上面两项 | 修改 |
| `packages/ssr/src/islands.ts` | `renderIslandsHtml` + `RenderEntry` | 创建 |
| `packages/ssr/src/index.ts` | 导出 ssr helper | 修改 |
| `packages/browser/src/navigation-islands.ts` | 从 core 引 `ResolvedEntry`/共享标记；首次 sync 收养水合 | 修改 |
| `packages/browser/src/index.ts` | 去掉本地 `ResolvedEntry` 再导出（已移 core） | 修改 |
| `packages/front/src/index.ts` | 去重 `ResolvedEntry`；透出 `renderIslandsHtml`/`RenderEntry` | 修改 |
| `templates/vue-minimal/src/{App.vue,main.ts,ssr.ts}` | shell 重构 + 水合接线 | 修改 |
| 各 `*.test.ts` | 单测 | 创建/修改 |

执行顺序:Task 1 spike 去风险 → Task 2-5 框架 → Task 6 模板 → Task 7 端到端验证。

---

### Task 1: Spike —— 验证 Vue island 水合 + sibling-outlet shell（throwaway）

**目的:** 在投入框架 plumbing 前，确认「Vue `createSSRApp(view,{page}).mount(SSR标记div)` 干净水合」+「chrome 挂到 sibling chrome-root、outlet 不被 chrome 触碰」。**此 Task 的改动是临时探针，验证后在 Task 6 由真实框架调用替换。**

**Files:**
- Modify（临时）: `templates/vue-minimal/src/ssr.ts`
- Modify（临时）: `templates/vue-minimal/src/main.ts`
- Modify（临时）: `templates/vue-minimal/src/App.vue`

- [ ] **Step 1: shell 重构 + 硬编码一个 island 的 SSR**

`App.vue`：删掉 `<main data-fs-outlet></main>`（chrome-only）。

`ssr.ts` 的 `renderApp` 临时硬编码（只为 spike，Task 6 用 `renderIslandsHtml` 替换）:

```ts
async renderApp(page, _framework, snapshot) {
    const { createSSRApp } = await import("vue");
    const { renderToString } = await import("vue/server-renderer");
    const App = (await import("./App.vue")).default;
    const HomeView = (await import("./views/HomeView.vue")).default;
    const DetailView = (await import("./views/DetailView.vue")).default;
    const VIEWS: Record<string, unknown> = { home: HomeView, detail: DetailView };
    const chromeHtml = await renderToString(createSSRApp(App));
    // 仅 spike：硬编码渲染所有可见目标
    let islandsHtml = "";
    for (const d of snapshot.destinations) {
        const view = (VIEWS[d.intent] ?? HomeView) as never;
        const inner = await renderToString(createSSRApp(view, { page: d.page }));
        const key = `${d.intent} ${JSON.stringify(d.params)}`;
        islandsHtml += `<div data-fs-entry data-fs-intent="${d.intent}" data-fs-key="${key.replace(/"/g, "&quot;")}">${inner}</div>`;
    }
    return {
        html: `<div data-fs-chrome>${chromeHtml}</div><main data-fs-outlet>${islandsHtml}</main>`,
        head: `<title>${page.title}</title>`,
        css: "",
    };
}
```

`main.ts` 的 `mount` 临时改为挂到 chrome-root + 收养水合 island（仅 spike）:

```ts
mount(target: HTMLElement) {
    const chromeRoot = target.querySelector<HTMLElement>("[data-fs-chrome]") ?? target;
    const hydrateChrome = chromeRoot.firstChild != null;
    (hydrateChrome ? createSSRApp : createApp)(App, { state, controller }).mount(chromeRoot);
    // 仅 spike：手动收养 outlet 内 SSR island
    const outlet = target.querySelector<HTMLElement>("[data-fs-outlet]");
    if (outlet) {
        for (const c of Array.from(outlet.children) as HTMLElement[]) {
            const intent = c.getAttribute("data-fs-intent");
            const view = intent === "detail" ? DetailView : HomeView;
            createSSRApp(view, { page: { id: intent }, controller }).mount(c);
        }
    }
    return () => undefined;
}
```

- [ ] **Step 2: 起 dev server + playwright 看首屏 HTML 与水合**

```bash
kill $(cat /tmp/finesoft-vue-dev.pid) 2>/dev/null; sleep 1
cd templates/vue-minimal && nohup vp dev > /tmp/finesoft-vue-dev.log 2>&1 & echo $! > /tmp/finesoft-vue-dev.pid
sleep 3; curl -s http://localhost:5173/item/1 | grep -o '<main data-fs-outlet>.*</main>' | head -c 400
```
Expected: `<main data-fs-outlet>` 内含 DetailView 的真实内容（非空），带 `data-fs-entry data-fs-key="detail {&quot;id&quot;:&quot;1&quot;}"`。

- [ ] **Step 3: playwright 验证水合无失配 + 交互正常**

用 playwright：navigate `/item/1` → 读 `browser_console_messages` 断言**无** Vue hydration mismatch 警告；snapshot 断言 island 内容已在页面；island 内输入框可交互。

Expected: 无 `Hydration` 警告；island 内容首屏即在；输入可改。

- [ ] **Step 4: 记录结论，回滚临时探针**

把 spike 结论（Vue 水合是否干净 / 需否调整）记到本 Task 末尾备注。然后 `git checkout templates/vue-minimal/src/{ssr.ts,main.ts}`（App.vue 的 chrome-only 改动**保留**，Task 6 要用）。

```bash
git checkout templates/vue-minimal/src/ssr.ts templates/vue-minimal/src/main.ts
```

> **Gate:** 若 spike 发现 Vue 水合有意外（mismatch、节点被清），先在此就地调整方案（不影响 core/ssr/browser 的 UI 无关契约），再进入 Task 2。

> **Spike 结论（2026-06-11 已执行）：** ✅ 方案 C 结构成立（chrome 挂 sibling `[data-fs-chrome]`、outlet 为兄弟、二者同 `#app` 下）；✅ **Vue island `createSSRApp(view).mount(ssrDiv)` 水合干净**（island 内容首屏在、input 可交互、`entryCount=1`、**无 island 失配警告**）。⚠️ **发现：chrome 真水合时 App.vue 有 props parity 失配** —— `<label v-if="state">` 在 SSR（`createSSRApp(App)` 不传 props → state undefined）与客户端（传 state、truthy）不一致。当前 demo 用 `createApp().mount()`（客户端重渲、丢 SSR 标记）掩盖了它；方案 C 要真水合 chrome → **Task 6 须让 SSR 用与客户端 hydrate 时相同的初始 state 渲 App**（见 Task 6 Step 2）。框架层（Task 2-5）不受影响。

---

### Task 2: core —— `ResolvedEntry`（移入 + `hydrate?`）+ `islandContainerAttributes`

**Files:**
- Create: `packages/core/src/navigation/islands.ts`
- Modify: `packages/core/src/navigation/index.ts`（barrel 增导出）
- Test: `packages/core/test/navigation/islands.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/test/navigation/islands.test.ts
import { describe, expect, test } from "vite-plus/test";
import { islandContainerAttributes } from "../../src/navigation/islands";

describe("islandContainerAttributes", () => {
    test("returns the data-fs-* marker attribute set（client/server 共用单一来源）", () => {
        expect(islandContainerAttributes("detail", 'detail {"id":"1"}')).toEqual({
            "data-fs-entry": "",
            "data-fs-intent": "detail",
            "data-fs-key": 'detail {"id":"1"}',
        });
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `vp test packages/core/test/navigation/islands.test.ts`
Expected: FAIL —— `islands.ts` 不存在 / `islandContainerAttributes` 未定义。

- [ ] **Step 3: 创建 `islands.ts`**

```ts
// packages/core/src/navigation/islands.ts
/**
 * Island 条目类型 + 共享标记构造器（UI 无关，core 单点拥有）。
 *
 * `ResolvedEntry` 是交给挂载/渲染原语的单条目解析结果（客户端 mountEntry / 服务端 renderEntry 共用）。
 * `islandContainerAttributes` 是 island 容器标记的来源 —— 客户端 orchestrator 建容器、服务端
 * `renderIslandsHtml` 拼字符串都用它，保证 server↔client 标记一致（水合按 `data-fs-key` 匹配）。
 */

import type { BasePage } from "../models/page";
import type { RouteParams } from "../router/types";

/** 交给挂载/渲染原语的单条目解析结果。 */
export interface ResolvedEntry {
    readonly intent: string;
    readonly params: RouteParams;
    readonly entryKey: string;
    readonly page: BasePage;
    /**
     * SSR 水合提示：true = 该条目的容器已含服务端渲染标记，挂载原语应**水合**（如 Vue
     * `createSSRApp().mount()`）而非新建（`createApp().mount()`）。缺省 false（新建）。
     */
    readonly hydrate?: boolean;
}

/**
 * island 容器的标记属性 —— 客户端 orchestrator 与服务端 helper 的单一来源。
 * `data-fs-entry`（标识容器）、`data-fs-intent`、`data-fs-key`（水合按它匹配）。
 */
export function islandContainerAttributes(
    intent: string,
    entryKey: string,
): Record<string, string> {
    return { "data-fs-entry": "", "data-fs-intent": intent, "data-fs-key": entryKey };
}
```

- [ ] **Step 4: barrel 导出**

在 `packages/core/src/navigation/index.ts` 的 `// ===== Keys` 段之前插入:

```ts
// ===== Islands（条目类型 + 共享标记构造器）=====
export { islandContainerAttributes, type ResolvedEntry } from "./islands";
```

- [ ] **Step 5: 跑测试确认通过 + 诊断**

Run: `vp test packages/core/test/navigation/islands.test.ts`
Expected: PASS。
Run（诊断）: lsp `diagnostics` 于 `packages/core/src/navigation/islands.ts` 与 `index.ts`（或 `vp check packages/core/src packages/core/test`）。Expected: 无错。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/navigation/islands.ts packages/core/src/navigation/index.ts packages/core/test/navigation/islands.test.ts
git commit -m "feat(core): island entry type + shared container marker (islandContainerAttributes)"
```

---

### Task 3: ssr —— `renderIslandsHtml` + `RenderEntry`

**Files:**
- Create: `packages/ssr/src/islands.ts`
- Modify: `packages/ssr/src/index.ts`
- Test: `packages/ssr/test/islands.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/ssr/test/islands.test.ts
import { describe, expect, test } from "vite-plus/test";
import { renderIslandsHtml } from "../src/islands";
import type { NavigationSnapshot } from "@finesoft/core";

function snap(destinations: NavigationSnapshot["destinations"]): NavigationSnapshot {
    return { tree: { kind: "leaf", intent: "x", params: {} }, destinations };
}

describe("renderIslandsHtml", () => {
    test("wraps a single destination in a shared-marker container", async () => {
        const s = snap([{ intent: "detail", params: { id: "1" }, page: { id: "p" } as never }]);
        const html = await renderIslandsHtml(
            s,
            (e) => `<p>${e.intent}:${(e.page as { id: string }).id}</p>`,
        );
        expect(html).toContain('<div data-fs-entry data-fs-intent="detail" data-fs-key=');
        expect(html).toContain("<p>detail:p</p></div>");
    });

    test("renders all visible destinations in order (split multi-column)", async () => {
        const s = snap([
            { intent: "list", params: {}, page: { id: "l" } as never },
            { intent: "detail", params: { id: "2" }, page: { id: "d" } as never },
        ]);
        const calls: string[] = [];
        const html = await renderIslandsHtml(s, (e) => {
            calls.push(e.intent);
            return `[${e.intent}]`;
        });
        expect(calls).toEqual(["list", "detail"]);
        expect(html.indexOf("[list]")).toBeLessThan(html.indexOf("[detail]"));
    });

    test("empty destinations → empty string", async () => {
        expect(await renderIslandsHtml(snap([]), () => "x")).toBe("");
    });

    test("awaits async renderEntry (Vue renderToString 形态)", async () => {
        const s = snap([{ intent: "a", params: {}, page: { id: "a" } as never }]);
        expect(await renderIslandsHtml(s, async (e) => `async:${e.intent}`)).toContain("async:a");
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `vp test packages/ssr/test/islands.test.ts`
Expected: FAIL —— `islands.ts` 不存在。

- [ ] **Step 3: 创建 `renderIslandsHtml`**

```ts
// packages/ssr/src/islands.ts
/**
 * renderIslandsHtml —— 服务端把可见 island 渲成带共享标记的 HTML，供应用放进 outlet。
 *
 * 对快照里**每个可见目标**调应用 `renderEntry(entry)=>html`（mountEntry 的 SSR 平行物），用 core
 * 的 `islandContainerAttributes` 包成 `<div data-fs-entry ...>...</div>`，按 destinations 顺序拼接。
 * 标记与客户端 orchestrator 同源 → 浏览器按 `data-fs-key` 收养水合。
 */

import {
    islandContainerAttributes,
    sessionEntryKey,
    type NavigationSnapshot,
    type ResolvedEntry,
} from "@finesoft/core";

/** 应用提供：把一个目标渲成 HTML（mountEntry 的 SSR 平行物）。可异步（容纳 Vue renderToString）。 */
export type RenderEntry = (entry: ResolvedEntry) => string | Promise<string>;

/** 属性表 → HTML 属性串（空值产出布尔属性；值做最小转义）。 */
function serializeAttrs(attrs: Record<string, string>): string {
    return Object.entries(attrs)
        .map(([k, v]) => (v === "" ? k : `${k}="${escapeAttr(v)}"`))
        .join(" ");
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * 渲染快照里所有可见目标为 outlet 内的 island HTML 串。
 * 无可见目标 → 空串；`renderEntry` 按 destinations 顺序依次 await（顺序对 split 多列有意义）。
 */
export async function renderIslandsHtml(
    snapshot: NavigationSnapshot,
    renderEntry: RenderEntry,
): Promise<string> {
    const parts: string[] = [];
    for (const dest of snapshot.destinations) {
        const entryKey = sessionEntryKey(dest.intent, dest.params);
        const entry: ResolvedEntry = {
            intent: dest.intent,
            params: dest.params,
            entryKey,
            page: dest.page,
        };
        const inner = await renderEntry(entry);
        const attrs = serializeAttrs(islandContainerAttributes(dest.intent, entryKey));
        parts.push(`<div ${attrs}>${inner}</div>`);
    }
    return parts.join("");
}
```

- [ ] **Step 4: 导出**

`packages/ssr/src/index.ts` 末尾（`serializeServerData` 那行后）加:

```ts
export { renderIslandsHtml, type RenderEntry } from "./islands";
```

- [ ] **Step 5: 跑测试确认通过 + 诊断**

Run: `vp test packages/ssr/test/islands.test.ts`
Expected: PASS（4/4）。
诊断: lsp `diagnostics` 于 `packages/ssr/src/islands.ts`，无错。

- [ ] **Step 6: 提交**

```bash
git add packages/ssr/src/islands.ts packages/ssr/src/index.ts packages/ssr/test/islands.test.ts
git commit -m "feat(ssr): renderIslandsHtml — server-render visible islands with shared marker"
```

---

### Task 4: browser orchestrator —— 首次 sync 收养水合

**Files:**
- Modify: `packages/browser/src/navigation-islands.ts`
- Test: `packages/browser/test/navigation-islands.test.ts`（追加用例；沿用现有 `fake-dom.ts`）

- [ ] **Step 1: 写失败测试（收养水合 + 回退新建 + 孤儿丢弃）**

在 `packages/browser/test/navigation-islands.test.ts` 追加（沿用文件已有的 `FakeElement`/快照构造 helper；下方 `makeSnapshot`/`mountEntrySpy` 按文件现有风格命名，若已有同名 helper 直接复用）:

```ts
// 追加到 navigation-islands.test.ts
import { sessionEntryKey } from "@finesoft/core";

describe("createIslandOrchestrator — SSR 收养水合（首次 sync）", () => {
    function destSnapshot(intent: string, params: Record<string, unknown>, page: unknown) {
        return {
            tree: { kind: "leaf", intent, params },
            destinations: [{ intent, params, page }],
        } as never;
    }

    test("命中既有 SSR 容器 → 收养（hydrate:true、复用容器、不新建）", () => {
        const outlet = new FakeElement("main");
        const key = sessionEntryKey("home", {});
        const ssrDiv = new FakeElement("div");
        ssrDiv.setAttribute("data-fs-entry", "");
        ssrDiv.setAttribute("data-fs-intent", "home");
        ssrDiv.setAttribute("data-fs-key", key);
        ssrDiv.textContent = "SSR";
        outlet.appendChild(ssrDiv);

        const seen: Array<{ container: unknown; hydrate?: boolean }> = [];
        const orch = createIslandOrchestrator({
            outlet: outlet as never,
            mountEntry: (entry, container) => {
                seen.push({ container, hydrate: entry.hydrate });
                return { unmount() {} };
            },
            schedule: (cb) => cb(),
        });
        orch.sync(destSnapshot("home", {}, { id: "home" }));

        expect(seen).toHaveLength(1);
        expect(seen[0].hydrate).toBe(true);
        expect(seen[0].container).toBe(ssrDiv); // 复用 SSR 容器，未新建
        // 未新建额外的 data-fs-entry（outlet 仍只有那一个容器）
        expect(outlet.querySelectorAll("[data-fs-entry]")).toHaveLength(1);
    });

    test("无 SSR 标记 → 回退新建（hydrate falsy、新容器）", () => {
        const outlet = new FakeElement("main");
        const seen: Array<{ hydrate?: boolean }> = [];
        const orch = createIslandOrchestrator({
            outlet: outlet as never,
            mountEntry: (entry) => {
                seen.push({ hydrate: entry.hydrate });
                return { unmount() {} };
            },
            schedule: (cb) => cb(),
        });
        orch.sync(destSnapshot("home", {}, { id: "home" }));
        expect(seen[0].hydrate).toBeFalsy();
        expect(outlet.querySelectorAll("[data-fs-entry]")).toHaveLength(1);
    });

    test("孤儿 SSR 容器（不在可见集）→ 首次 sync 丢弃", () => {
        const outlet = new FakeElement("main");
        const stale = new FakeElement("div");
        stale.setAttribute("data-fs-entry", "");
        stale.setAttribute("data-fs-intent", "old");
        stale.setAttribute("data-fs-key", sessionEntryKey("old", {}));
        outlet.appendChild(stale);

        const orch = createIslandOrchestrator({
            outlet: outlet as never,
            mountEntry: () => ({ unmount() {} }),
            schedule: (cb) => cb(),
        });
        orch.sync(destSnapshot("home", {}, { id: "home" }));
        // old 被移除；只剩新挂的 home
        const keys = outlet
            .querySelectorAll("[data-fs-entry]")
            .map((el: FakeElement) => el.getAttribute("data-fs-key"));
        expect(keys).toEqual([sessionEntryKey("home", {})]);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `vp test packages/browser/test/navigation-islands.test.ts -t "SSR 收养水合"`
Expected: FAIL —— 现实现总是新建容器（命中用例的 `container===ssrDiv` 与 `hydrate:true` 不成立；孤儿不被移除）。

- [ ] **Step 3: 改 `navigation-islands.ts` —— 引 core 类型 + 收养逻辑**

3a. 顶部 import：把本地 `ResolvedEntry` 接口删除（移到 core），改为从 core 引入，并引入共享标记构造器。将现有 import 块改为:

```ts
import {
    collectAllLeaves,
    islandContainerAttributes,
    sessionEntryKey,
    type NavigationSnapshot,
    type ResolvedEntry,
} from "@finesoft/core";
```

并**删除**文件内原有的 `export interface ResolvedEntry { ... }` 定义块（约 23-29 行）。`MountEntry` 改为引用 core 的 `ResolvedEntry`（无需改签名，类型已从 import 来）；若需对外暴露该类型，追加一行 `export type { ResolvedEntry } from "@finesoft/core";`。

3b. `createIslandOrchestrator` 内，把现有「新建容器并 setAttribute 三处」替换为共享标记 + 收养逻辑。新增首次标志与收养器:

```ts
    const mounted = new Map<string, MountedIsland>();
    let booted = false; // 仅首次 sync 收养 SSR 标记

    /** 收集 outlet 内既有 SSR island 容器（按 data-fs-key）。 */
    function collectSsrContainers(): Map<string, HTMLElement> {
        const map = new Map<string, HTMLElement>();
        for (const el of outlet.querySelectorAll<HTMLElement>("[data-fs-entry]")) {
            const key = el.getAttribute("data-fs-key");
            if (key !== null) map.set(key, el);
        }
        return map;
    }
```

3c. `sync` 顶部取收养表；把「确保每个可见目标已挂载」分支改为命中即收养:

```ts
    function sync(snapshot: NavigationSnapshot): void {
        const ssr = booted ? null : collectSsrContainers(); // 仅首次

        const presentKeys = new Set(
            collectAllLeaves(snapshot.tree).map((l) => sessionEntryKey(l.intent, l.params)),
        );

        // 1) 卸载离 present 集的 island。
        for (const [key, island] of mounted) {
            if (!presentKeys.has(key)) teardown(key, island);
        }

        // 2) 确保每个可见目标已挂载（命中 SSR 容器则收养水合，否则新建）。
        const visibleKeys: string[] = [];
        for (const d of snapshot.destinations) {
            const key = sessionEntryKey(d.intent, d.params);
            visibleKeys.push(key);
            const existing = mounted.get(key);
            if (existing !== undefined && existing.page !== d.page) {
                teardown(key, existing); // page 变了（refresh）→ 重挂拿新 page
            }
            if (!mounted.has(key)) {
                const adopted = ssr?.get(key);
                const container = adopted ?? document.createElement("div");
                if (adopted === undefined) {
                    for (const [k, v] of Object.entries(islandContainerAttributes(d.intent, key))) {
                        container.setAttribute(k, v);
                    }
                } else {
                    ssr?.delete(key); // 已收养，移出待清理集
                }
                const entry: ResolvedEntry = {
                    intent: d.intent,
                    params: d.params,
                    entryKey: key,
                    page: d.page,
                    hydrate: adopted !== undefined,
                };
                const handle = mountEntry(entry, container);
                mounted.set(key, {
                    container,
                    handle,
                    attached: adopted !== undefined, // 收养的容器已在 outlet
                    entered: false,
                    page: d.page,
                });
            }
        }

        // 2.5) 首次：移除未收养的孤儿 SSR 容器（不属于任何可见目标）。
        if (ssr) for (const el of ssr.values()) el.remove();

        // 3) detach 掉 present-但-不可见的 island（保活）。
        const visibleSet = new Set(visibleKeys);
        for (const [key, island] of mounted) {
            if (!visibleSet.has(key)) conceal(island);
        }

        // 4) 按 destinations 顺序 attach/reorder 可见 island。
        for (const key of visibleKeys) {
            const island = mounted.get(key);
            if (island === undefined) continue;
            const wasAttached = island.attached;
            outlet.appendChild(island.container);
            island.attached = true;
            if (!island.entered) {
                island.entered = true;
                emit(island.container, "fs:enter");
            }
            if (!wasAttached) {
                emit(island.container, "fs:reveal");
                restoreScroll(island);
            }
        }

        booted = true;
    }
```

> 说明:收养的容器 `attached:true`、`wasAttached:true` → 不派发 `fs:reveal`（它本就在首屏可见，不是 detach→attach 转换）；但 `entered:false` → 首次仍派发 `fs:enter`（实例已进入）。`appendChild` 对已在 outlet 的容器是幂等重排。

- [ ] **Step 4: 跑测试确认通过**

Run: `vp test packages/browser/test/navigation-islands.test.ts`
Expected: PASS（含新增 3 用例 + 原有用例不回归）。

- [ ] **Step 5: 诊断**

lsp `diagnostics` 于 `packages/browser/src/navigation-islands.ts`，无错。

- [ ] **Step 6: 提交**

```bash
git add packages/browser/src/navigation-islands.ts packages/browser/test/navigation-islands.test.ts
git commit -m "feat(browser): orchestrator adopts SSR island markup on first sync (hydrate)"
```

---

### Task 5: browser index + front —— 导出去重 + 透出 helper

**Files:**
- Modify: `packages/browser/src/index.ts`
- Modify: `packages/front/src/index.ts`

- [ ] **Step 1: browser index 去掉本地 `ResolvedEntry` 再导出**

`packages/browser/src/index.ts` 中 `from "./navigation-islands"` 的 type 块（含 `IslandHandle`/`MountEntry`/`ResolvedEntry`）—— 删除 `type ResolvedEntry,` 这一行（已移 core）。`ResolvedEntry` 现由 `@finesoft/core` 提供。

- [ ] **Step 2: front 去重 `ResolvedEntry` + 透出 ssr helper**

`packages/front/src/index.ts`:
- 在 `from "@finesoft/browser"` 的 type 列表里**删除** `ResolvedEntry,`（它经 `export * from "@finesoft/core"` 已导出；保留会重复导出报错）。
- 在 SSR value 再导出块（`from "@finesoft/ssr"`）加 `renderIslandsHtml,`。
- 在 SSR type 再导出块加 `RenderEntry,`（即增 `export type { ..., RenderEntry } from "@finesoft/ssr";`）。

`islandContainerAttributes` 与 `ResolvedEntry` 经 `export * from "@finesoft/core"` 自动透出，无需显式列。

- [ ] **Step 3: 全量构建验证无重复导出 + 类型贯通**

Run: `vp run -r build`
Expected: 14 包构建通过，**无** "Multiple exports with the same name" / duplicate-export 报错。

- [ ] **Step 4: 提交**

```bash
git add packages/browser/src/index.ts packages/front/src/index.ts
git commit -m "chore(exports): ResolvedEntry from core; front re-exports renderIslandsHtml"
```

---

### Task 6: template（vue-minimal）—— shell 重构 + 水合接线

**Files:**
- Modify: `templates/vue-minimal/src/App.vue`（Task 1 已改为 chrome-only，确认保留）
- Modify: `templates/vue-minimal/src/main.ts`
- Modify: `templates/vue-minimal/src/ssr.ts`

- [ ] **Step 1: 确认 App.vue 为 chrome-only**

确认 `App.vue` 模板中**已无** `<main data-fs-outlet></main>`（Task 1 Step 1 已删）。chrome 的外层 `<div style="max-width…">` 保留（仅包 header + nav + back）。

- [ ] **Step 2: ssr.ts —— renderApp 用 `renderIslandsHtml` 组装 chrome + outlet**

```ts
// templates/vue-minimal/src/ssr.ts
import {
    createSSRNavigationRender,
    renderIslandsHtml,
    serializeServerData,
    type ResolvedEntry,
} from "@finesoft/front";
import { createSSRApp, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import HomeView from "./views/HomeView.vue";
import DetailView from "./views/DetailView.vue";
import NotesView from "./views/NotesView.vue";
import { bootstrap, navigation } from "./bootstrap";

const VIEWS: Record<string, Component> = { home: HomeView, detail: DetailView, notes: NotesView };

/**
 * islands 架构 SSR（方案 C）：
 * - chrome（App.vue，header + tabbar）渲进 `<div data-fs-chrome>`。
 * - 可见 island 内容由 `renderIslandsHtml` 渲进 sibling `<main data-fs-outlet>`，客户端按 key 收养水合。
 */
export const render = createSSRNavigationRender({
    bootstrap,
    getErrorPage(status, message) {
        return { id: "error", pageType: "error", title: `Error ${status}`, description: message };
    },
    async renderApp(page, _framework, snapshot) {
        // chrome 水合 props parity（spike 发现）：SSR 必须用与客户端 hydrate 时**相同**的初始 state
        // 渲 App，否则 App.vue 的 `v-if="state"`（name label 等）server/client 不一致 → hydration
        // mismatch。客户端 hydrate 时 state = { snapshot: null, name: "" }（onNavigationReady /
        // session 恢复都在水合**之后**才填），故 SSR 传同形初始值。controller 仅用于事件处理器
        // （`controller?.`），不影响渲染 DOM，SSR 可省。
        const chromeHtml = await renderToString(
            createSSRApp(App, { state: { snapshot: null, name: "" } }),
        );
        const islandsHtml = await renderIslandsHtml(snapshot, (entry: ResolvedEntry) =>
            renderToString(createSSRApp(VIEWS[entry.intent] ?? HomeView, { page: entry.page })),
        );
        return {
            html: `<div data-fs-chrome>${chromeHtml}</div><main data-fs-outlet>${islandsHtml}</main>`,
            head: `<title>${page.title}</title>`,
            css: "",
        };
    },
    navigation: navigation.toSSRDefinition(),
});

export { serializeServerData };
```

- [ ] **Step 3: main.ts —— chrome 挂 sibling root + mountEntry 按 hydrate 水合**

3a. 顶部 import 增 `createSSRApp`:

```ts
import { createApp, createSSRApp, markRaw, reactive, type Component } from "vue";
```

3b. `mountEntry` 按 `entry.hydrate` 选择水合 vs 新建:

```ts
const mountEntry: MountEntry = (entry, container) => {
    const view = VIEWS[entry.intent] ?? HomeView;
    const factory = entry.hydrate ? createSSRApp : createApp;
    const app = factory(view, { page: entry.page, controller });
    app.mount(container);
    return { unmount: () => app.unmount() };
};
```

3c. `mount` 回调：chrome 挂到 `[data-fs-chrome]`（无 SSR shell 时建 chrome-root + outlet 兜底 CSR）:

```ts
mount(target: HTMLElement) {
    let chromeRoot = target.querySelector<HTMLElement>("[data-fs-chrome]");
    if (!chromeRoot) {
        // 纯 CSR（无 SSR shell）兜底：建 chrome-root + 空 outlet 兄弟。
        chromeRoot = document.createElement("div");
        chromeRoot.setAttribute("data-fs-chrome", "");
        const outlet = document.createElement("main");
        outlet.setAttribute("data-fs-outlet", "");
        target.append(chromeRoot, outlet);
    }
    const factory = chromeRoot.firstChild ? createSSRApp : createApp; // 有 SSR 内容 → 水合
    factory(App, { state, controller }).mount(chromeRoot);
    return () => undefined;
},
```

> orchestrator 经 `target.querySelector("[data-fs-outlet]")` 找 outlet（sibling，仍在 `#app` 下）—— 框架侧无需改。

- [ ] **Step 4: 诊断 + 构建模板**

Run: lsp `diagnostics` 于 `templates/vue-minimal/src/{ssr.ts,main.ts}`（或 `vp check templates/vue-minimal/src` 若模板纳入）。Expected: 无错。
Run: `vp run -r build`（确保 front 已含 Task 5 的导出）。Expected: 构建通过。

- [ ] **Step 5: 提交**

```bash
git add templates/vue-minimal/src/App.vue templates/vue-minimal/src/main.ts templates/vue-minimal/src/ssr.ts
git commit -m "feat(vue-minimal): SSR island content into sibling outlet + client hydration"
```

---

### Task 7: 端到端验证 + 回归

**Files:** 无（验证）

- [ ] **Step 1: 重启 dev server**

```bash
kill $(cat /tmp/finesoft-vue-dev.pid) 2>/dev/null; sleep 1
cd templates/vue-minimal && nohup vp dev > /tmp/finesoft-vue-dev.log 2>&1 & echo $! > /tmp/finesoft-vue-dev.pid
sleep 3; curl -s -o /dev/null -w "http=%{http_code}\n" http://localhost:5173/item/1
```
Expected: `http=200`。

- [ ] **Step 2: 验证首屏 HTML 含 island 内容（SSR 真生效）**

```bash
curl -s http://localhost:5173/item/1 | grep -o '<main data-fs-outlet>.*</main>' | head -c 600
```
Expected: `<main data-fs-outlet>` 内含 DetailView 真实内容（带 `data-fs-entry`、`data-fs-key="detail {&quot;id&quot;:&quot;1&quot;}"`，且 DetailView 的可见文本/输入框 markup 在内）—— **非空**。

- [ ] **Step 3: playwright 验证水合无失配 + 交互/keep-alive/重载恢复不回归**

用 playwright:
1. navigate `/item/1` → `browser_console_messages` 断言**无** Vue `Hydration` mismatch 警告。
2. snapshot 断言 DetailView 内容首屏在页面、island 输入框可输入。
3. keep-alive 回归:在 detail 输入 note → 切到 Notes tab 再切回 → note 仍在（islands 保活）。
4. 重载恢复回归:输入 note → 重载 `/item/1` → note 恢复（session + domRestore）；导航 `/item/2` → 不泄漏。

Expected: 无 hydration 警告;首屏含内容;keep-alive 与重载恢复均 ✓。

- [ ] **Step 4: 全量测试 + 构建**

Run: `vp test packages/core packages/browser packages/ssr`
Expected: 全绿（含新增 islands 用例 + 既有不回归）。
Run: `vp run -r build`
Expected: 14 包通过。

- [ ] **Step 5: 提交（若 Step 1-4 触发任何收尾修补）**

```bash
git add -A && git commit -m "test(ssr-islands): e2e verify SSR island hydration + keep-alive/reload regressions"
```

---

## Self-Review 备注（写计划时已核）

- **Spec 覆盖:** §3.1→Task2、§3.2→Task3、§3.3→Task4、§3.4→Task6、§5 测试散于各 Task + Task7、§6 spike→Task1。导出面（§7）→Task5。
- **类型一致:** `ResolvedEntry`（core，含 `hydrate?`）贯穿 Task2/3/4/6;`islandContainerAttributes`（core）被 Task3（server）与 Task4（client）共用;`RenderEntry`（ssr）Task3 定义、Task6 消费。
- **去重风险:** Task5 显式处理 `ResolvedEntry` 移核后 browser/front 的重复导出（`export * from core` + 旧显式列）—— 以 `vp run -r build` 验。
- **无 jsdom:** Task4 测试用 `fake-dom.ts` 的 `FakeElement`（`querySelectorAll("[data-fs-entry]")` + `getAttribute` + `appendChild`，均现有能力）。
