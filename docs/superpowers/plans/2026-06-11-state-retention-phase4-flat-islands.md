# 会话恢复完整实现 · Phase 4：扁平隐式单栈 islands（@finesoft/browser）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⚠️ **本阶段风险最高、spike-gated。** 它让**现有扁平（链接 / FlowAction 驱动）应用**无需把导航改写成 `handle.push` 即获得 islands 活保活——做法是把 `FlowAction` 自动路由到一个**隐式单栈** `NavigationController`。核心不确定点是「FLOW action 的处理改道」，故 Task 1 是设计验证 spike（读 ActionDispatcher + RED 集成测试）先把它钉死，再实现。
>
> **替代路径（若 spike 判定不划算可弃用本阶段）：** 扁平应用也可直接采用 **结构化单栈导航**（`navigation: { initial: stack(leaf(...)), mountEntry, codec }` + 用 `handle.push/pop` 替代链接），由 Phase 2 直接覆盖、无需 Phase 4。是否做 Phase 4 取决于「不改现有链接导航」的价值。

**Goal:** 扁平应用提供顶层 `mountEntry`（且未配 `navigation`）时，框架合成一个隐式单栈 `NavigationController` + flat URL 编解码器 + islands 编排器，并把 `FlowAction` 正向导航路由为 `controller.push`、`popstate` 路由为 `hydrate`——从而 back 复用活实例（不重 fetch、状态全在），forward 越界走重建。

**Architecture:** 新增 `flat-stack-codec.ts`（URL↔单叶栈：`encode(tree)` 取激活叶子 URL；`decode(url)` 路由成 `stack(leaf)`）。新增 `activateFlatIslands`（在 `start-app.ts`）：当 `config.mountEntry && !config.navigation` 时，用初始 URL 路由出的 leaf 建 `initial = stack(leaf)`、构 `NavigationController`（createBrowserContext + prefetched）、`NavigationBridge`（复用 Phase 0 的 history/popstate）、islands 编排器；并安装一个 **FLOW 路由器**：把 `framework.perform(FlowAction)` 的正向导航转成 `controller.push(intentFromUrl)`（spike 验证的接法）。扁平 `registerFlowActionHandler` 在该模式下不接管渲染（modal/redirect 仍归它，正向 FLOW 归控制器）。

**Tech Stack:** TypeScript（strict）、Vite+、Vitest（jsdom）。仅改 `@finesoft/browser`（+ `front`）。**依赖 Phase 1 + Phase 2**（编排器）；复用既有 `NavigationBridge`。

**落地分支：** `feat/session-restoration`。全局约定同前。

---

## Task 1：设计验证 spike（读 ActionDispatcher + RED 集成测试，钉死 FLOW 改道）

**目的：** 在写实现前，确认 FLOW action 如何改道到控制器，并用一个失败的集成测试锁定目标行为。

**Files:**

- Read（侦察）：`packages/core/src/actions/*`（ActionDispatcher / `framework.onAction` / `framework.perform` 语义）、`packages/browser/src/action-handlers/register.ts`
- Test: `packages/browser/test/flat-islands.test.ts`

- [ ] **Step 1：侦察 FLOW 处理语义并记录结论**

读 core 的 action 派发：

- `framework.onAction(ACTION_KINDS.FLOW, handler)` 是否**覆盖**既有 handler 还是追加？（决定能否用「自定义 FLOW handler」替换扁平 handler 的正向导航。）
- `framework.perform(action)` 如何分发到 handler；多 handler 时的次序。
- `registerActionHandlers`（register.ts）注册了哪些 handler、顺序。

把结论写进本任务下方「Spike 结论」小节（三选一）：

- **(A) onAction 覆盖式**：合成模式下，先注册扁平 handler，再用自定义 FLOW handler 覆盖正向导航 → 路由到 `controller.push`。
- **(B) 单 handler + 内部分支**：给 `registerFlowActionHandler` 加一个「flatIslands 路由器」注入点：正向 FLOW 调 `onForward(url)` 而非 `updateApp`，由合成层接 `controller.push`。
- **(C) 不改 handler，FLOW 前置拦截**：在 `framework.perform` 前包一层，FLOW 正向导航直接调 `controller.push`，不进扁平 handler（modal/redirect 仍走 perform）。

- [ ] **Step 2：写 RED 集成测试（锁定目标行为）**

新建 `packages/browser/test/flat-islands.test.ts`，用 `startBrowserApp`（顶层 `mountEntry`、无 `navigation`）驱动两次「导航」（perform FlowAction 或调 spike 选定的入口），断言：

1. 首屏 island 挂载到 `[data-fs-outlet]`。
2. 正向导航（→ B）：B 挂载，A 仍挂载但 detach（保活）。
3. back（popstate）：A 复用活实例（mountEntry 不重调）、重 attach；B 仍 present 则保活。

```ts
import { describe, expect, test } from "vite-plus/test";
import { defineRoutes, leaf, sessionEntryKey, makeFlowAction } from "@finesoft/core";
import { startBrowserApp } from "../src/start-app";

describe("flat islands（顶层 mountEntry，无 navigation）", () => {
    test("正向导航 detach 保活，back 复用活实例不重挂", async () => {
        document.body.innerHTML = `<div id="app"></div>`;
        history.replaceState(null, "", "/a");
        const mountCalls: string[] = [];

        const app = await startBrowserApp({
            bootstrap: (fw) =>
                defineRoutes(fw, [
                    {
                        path: "/a",
                        intentId: "a",
                        controller: {
                            intentId: "a",
                            execute: () => ({ id: "a", pageType: "a", title: "A" }),
                        },
                    },
                    {
                        path: "/b",
                        intentId: "b",
                        controller: {
                            intentId: "b",
                            execute: () => ({ id: "b", pageType: "b", title: "B" }),
                        },
                    },
                ]),
            mount: (target) => {
                target.innerHTML = `<main data-fs-outlet></main>`;
                return () => undefined;
            },
            callbacks: { onNavigate() {}, onModal() {} },
            mountEntry: (entry, container) => {
                mountCalls.push(entry.entryKey);
                container.textContent = entry.page.title ?? "";
                return { unmount() {} };
            },
        });

        const outlet = document.querySelector("[data-fs-outlet]") as HTMLElement;
        const visible = (): string[] =>
            [...outlet.querySelectorAll("[data-fs-entry]")].map(
                (e) => e.getAttribute("data-fs-key") ?? "",
            );

        // 首屏 A
        expect(mountCalls).toEqual([sessionEntryKey("a", {})]);
        expect(visible()).toEqual([sessionEntryKey("a", {})]);

        // 正向导航 → B（spike 选定的导航入口；下例用 perform，按 Spike 结论调整）
        await app /* 或返回的 handle / framework */;
        // …此处按 Spike 结论触发到 /b 的正向导航，并 await 提交…

        // 断言：B 挂载、A detach 保活
        // expect(mountCalls).toEqual([KEY a, KEY b]); expect(visible()).toEqual([KEY b]);

        // back（popstate）
        // window.dispatchEvent(new PopStateEvent("popstate", { state: ... }));
        // …await…
        // 断言：A 重 attach、mountEntry 未对 A 重调
        // expect(mountCalls).toEqual([KEY a, KEY b]); expect(visible()).toEqual([KEY a]);
    });
});
```

> 该测试在 spike 阶段是「目标规格草案」：先按 Spike 结论补全正向导航/back 的触发与断言，使其**红**（当前无 flat-islands 路径）。后续 Task 实现使其绿。

- [ ] **Step 3：提交 spike 结论 + RED 测试骨架**

```bash
git add packages/browser/test/flat-islands.test.ts
git commit -m "spike(browser): flat-islands FLOW 改道结论 + RED 集成测试骨架"
```

---

## Task 2：扁平栈 URL 编解码器

**Files:**

- Create: `packages/browser/src/flat-stack-codec.ts`（或放 core navigation/codec.ts；倾向 browser 侧避免 core 体积，且依赖 router 读取面）
- Test: `packages/browser/test/flat-stack-codec.test.ts`

- [ ] **Step 1：写失败测试**

```ts
import { describe, expect, test } from "vite-plus/test";
import { leaf, stack, Router } from "@finesoft/core";
import { createFlatStackCodec } from "../src/flat-stack-codec";

describe("flat stack codec", () => {
    test("decode：可路由 URL → 单叶栈", () => {
        const router = new Router();
        router.add("/item/:id", "detail");
        const codec = createFlatStackCodec();
        expect(codec.decode("/item/7", router)).toEqual(stack([leaf("detail", { id: "7" })]));
    });

    test("encode：取激活叶子的 URL", () => {
        const router = new Router();
        router.add("/item/:id", "detail");
        const codec = createFlatStackCodec();
        const url = codec.encode(stack([leaf("home"), leaf("detail", { id: "7" })]), router);
        expect(url).toBe("/item/7");
    });

    test("decode：不可路由 URL → undefined（保留当前树）", () => {
        const codec = createFlatStackCodec();
        expect(codec.decode("/nope", new Router())).toBeUndefined();
    });
});
```

- [ ] **Step 2：跑测试，确认失败**

Run: `vp test packages/browser/test/flat-stack-codec.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3：实现**

新建 `packages/browser/src/flat-stack-codec.ts`：

```ts
/**
 * 扁平栈 codec —— flat-islands 用：URL ↔ 单叶栈。
 * - decode(url) = stack(leaf(route(url)))；不可路由 → undefined（bridge 保留当前树）。
 * - encode(tree) = 激活叶子（栈顶）的 URL（router 反查 + params 回填）。
 * 扁平 URL 不编码整条栈：重载只还原栈顶那一屏（与今天扁平重载行为一致）。
 */

import {
    collectVisibleDestinations,
    leaf,
    stack,
    type NavigationCodec,
    type NavigationNode,
    type NavigationRouterLike,
} from "@finesoft/core";

export function createFlatStackCodec(): NavigationCodec {
    return {
        decode(url: string, router: NavigationRouterLike): NavigationNode | undefined {
            const match = router.match?.(url) ?? undefined; // 按 NavigationRouterLike 实际读取面调整
            if (!match) return undefined;
            return stack([
                leaf(match.intent.id, (match.intent.params ?? {}) as Record<string, string>),
            ]);
        },
        encode(tree: NavigationNode, router: NavigationRouterLike): string {
            const visible = collectVisibleDestinations(tree);
            const top = visible[visible.length - 1];
            if (!top) return "/";
            return router.build?.(top.intent, top.params) ?? "/"; // 按 NavigationRouterLike 实际反查面调整
        },
    };
}
```

> `NavigationRouterLike` 的精确读取/反查方法名以 Task 1 spike 读到的 `codec.ts` / `NavigationRouterLike` 定义为准（既有 `createActiveLeafCodec` 已用同一读取面——直接对齐其实现）。

- [ ] **Step 4：跑测试，确认通过**

Run: `vp test packages/browser/test/flat-stack-codec.test.ts`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/browser/src/flat-stack-codec.ts packages/browser/test/flat-stack-codec.test.ts
git commit -m "feat(browser): flat-stack-codec —— URL↔单叶栈（flat-islands 用）"
```

---

## Task 3：`activateFlatIslands` + FLOW 改道 + 接线

**Files:**

- Create: `packages/browser/src/flat-islands.ts`（合成 controller + bridge + 编排器 + FLOW 路由器）
- Modify: `packages/browser/src/start-app.ts`（顶层 `mountEntry` + 检测 + 调用）
- Test: `packages/browser/test/flat-islands.test.ts`（补全 Task 1 的 RED 测试断言 → GREEN）

- [ ] **Step 1：实现 `activateFlatIslands`（按 Spike 结论接 FLOW）**

新建 `packages/browser/src/flat-islands.ts`：合成 `initial = stack(leaf(routeInitialUrl))` 的 `NavigationController`（createContext/prefetched/onRedirect 对齐 `activateNavigation`）、`createNavigationBridge`（codec = `createFlatStackCodec()`）、`createIslandOrchestrator`（outlet）、首 `resolve()` + 订阅 sync；并按 Spike 结论安装 FLOW 路由器（正向 FLOW url → 路由出 intent → `controller.push(intent, params)`；modal/redirect 仍由扁平 handler）。导出 `activateFlatIslands(args): { handle, controller, outlet }`。

> 具体 FLOW 接法（覆盖式 onAction / 注入点 / perform 前置拦截）取 Task 1 Spike 结论；本步给出与该结论一致的完整代码（spike 阶段已验证形态）。

- [ ] **Step 2：start-app 检测 + 调用**

`BrowserAppConfig` 加顶层 `mountEntry?: MountEntry`（扁平 islands opt-in；结构化仍用 `navigation.mountEntry`）。在 6.5 之后加分支：`if (config.mountEntry && !config.navigation)` → `activateFlatIslands(...)`，把返回的 `{ outlet }` 也供 6.8 domRestore 使用（与 Phase 3 同源接 `sessionHandle.scope`）。注意 `registerActionHandlers` 的 `manageHistory`：flat-islands 下 history 由合成 bridge 独占，应传 `false`（同结构化）——即把 line 273 的判定改为 `manageHistory: !(config.navigation || config.mountEntry)`。

- [ ] **Step 3：补全 Task 1 集成测试断言 → 跑绿**

回到 `flat-islands.test.ts`，按实现补全正向导航与 back 的触发/断言，使其 GREEN。

Run: `vp test packages/browser/test/flat-islands.test.ts`
Expected: PASS（首屏挂载 / 正向 detach 保活 / back 复用不重挂）。

- [ ] **Step 4：全量 + scoped 校验**

Run: `vp test packages/browser`（确认结构化 islands、扁平单 mount、会话等既有路径无回归）
Run: `vp check packages/browser/src packages/browser/test`
Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add packages/browser/src/flat-islands.ts packages/browser/src/start-app.ts packages/browser/test/flat-islands.test.ts
git commit -m "feat(browser): flat-islands —— 顶层 mountEntry 合成隐式单栈，FLOW→push、back 保活"
```

---

## Task 4：`front` 再导出 + 验证

- [ ] **Step 1：再导出** `createFlatStackCodec`（如对外暴露）到 `packages/front/src/index.ts`。顶层 `mountEntry` 经 `BrowserAppConfig` 已导出，无需额外。
- [ ] **Step 2：** `vp run -r build` + `vp test packages/browser packages/front` → PASS。
- [ ] **Step 3：提交** `git commit -m "feat(front): 再导出 flat-stack-codec"`。

---

## Phase 4 完成定义（DoD）

- Spike 结论明确记录 FLOW 改道方式 + RED→GREEN 集成测试。
- `createFlatStackCodec` 落地（URL↔单叶栈）。
- `activateFlatIslands` 落地：顶层 `mountEntry` + 无 `navigation` → 合成隐式单栈 + 编排器 + FLOW→push；back 复用活实例不重挂、不重 fetch（Phase 1 缓存协同）。
- 既有扁平单 mount / 结构化 islands / 会话路径无回归；`vp test packages/browser` + `vp check` 全绿。

## 自审记录

- **spec 覆盖**：§3（扁平 = 隐式单栈 present 集）、§4.0（flat 经 mountEntry 升级）、§4.1（同一编排器）、§5「flat 历史」决策（back 全活、前进越界重建）、§8 browser（flat-islands + flat-stack-codec + start-app）。
- **占位扫描**：Task 1 是显式 spike（读 + RED 测试），非占位；Task 2/3 的 router 读取面与 FLOW 接法明确指向「对齐既有 `createActiveLeafCodec` / Spike 结论」，实现时有确定来源。**风险已在 header 显式标注，且给出可弃用替代路径。**
- **类型一致**：复用 Phase 2 `MountEntry`/编排器、既有 `NavigationBridge`/`NavigationCodec`/`NavigationRouterLike`；新增 `createFlatStackCodec(): NavigationCodec`、`activateFlatIslands(args): { handle, controller, outlet }`。
- **诚实声明**：Phase 4 的 FLOW 改道是全套里唯一未对着源码逐行验证的集成点，故以 spike 前置。执行本阶段前应先跑 Task 1 spike；若结论是「改道代价过高」，按 header 替代路径（结构化单栈）落地、跳过本阶段。
