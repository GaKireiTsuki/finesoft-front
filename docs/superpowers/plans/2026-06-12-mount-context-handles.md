# Mount-Context Handles 实现计划（治 handle 之舞）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `startBrowserApp` 在 mount 时经 context 交付 navigation/session handle + 一个框架构建的统一 `app` 句柄，消除应用侧的「模块变量 + makeController + onNavigationReady/onSessionReady」样板。

**Architecture:** boot 时序重排 —— nav controller/bridge + session store/bridge 在 **mount 前**创建（handle 就绪；controller 此时 `getSnapshot()` 返回 `{tree, destinations:[]}`，chrome 渲 tab bar 够用）；`registerActionHandlers`、`controller.resolve()`（出 pages，redirect→perform 在此才安全）、islands orchestrator、`session.restore`、`domRestore` 全留 **mount 后**。统一 `app` 句柄是 nav+session 组件面成员的扁平合并（bridge handle 方法是闭包，可直接引用赋值；`scope` 用 getter 委托）。

**Tech Stack:** TypeScript strict、Vite+（`vp test`/`vp check`，导入 `vite-plus/test`）、无 jsdom（用 `packages/browser/test/fake-dom.ts`）、Vue 3（模板）、playwright（e2e）。

**设计依据:** [docs/superpowers/specs/2026-06-12-mount-context-handles-design.md](../specs/2026-06-12-mount-context-handles-design.md)

---

## File Structure

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `packages/browser/src/app-handle.ts` | `AppHandle` 类型 + `createAppHandle(nav?, session?)` 扁平合并 | 创建 |
| `packages/browser/src/start-app.ts` | mount context 加 handle/app；移除 onXReady；boot 重排；拆 core/post 段 | 修改 |
| `packages/browser/src/index.ts` | 导出 `AppHandle` | 修改 |
| `packages/front/src/browser.ts` | 透出 `AppHandle`（index.ts 经 `export * from "./browser"` 自动带） | 修改 |
| `templates/vue-minimal/src/main.ts` | 用 context 取 handle/app，删模块变量+makeController+onXReady | 修改 |
| `templates/vue-minimal/src/ssr.ts` | chrome SSR 改用真实快照（parity 升级） | 修改 |
| `packages/browser/test/app-handle.test.ts` | createAppHandle 单测 | 创建 |
| `packages/browser/test/start-app.test.ts` | 改写 onXReady 用例为 context/app/时序用例 | 修改 |

执行顺序:Task 1（app-handle 单元）→ Task 2（start-app 重排，核心）→ Task 3（导出）→ Task 4（vue-minimal 迁移）→ Task 5（e2e 验证）。

---

### Task 1: `createAppHandle` + `AppHandle` 类型

**Files:**
- Create: `packages/browser/src/app-handle.ts`
- Test: `packages/browser/test/app-handle.test.ts`

- [ ] **Step 1: 写失败测试 `packages/browser/test/app-handle.test.ts`**

```ts
import { describe, expect, test, vi } from "vite-plus/test";
import { createAppHandle } from "../src/app-handle";
import type { NavigationHandle } from "../src/navigation-bridge";
import type { SessionHandle } from "../src/session-bridge";

function fakeNav(): NavigationHandle {
    return {
        getSnapshot: vi.fn(() => ({ tree: { kind: "leaf", intent: "home", params: {} }, destinations: [] })),
        subscribe: vi.fn(() => () => {}),
        push: vi.fn(async () => ({}) as never),
        pop: vi.fn(async () => ({}) as never),
        popToRoot: vi.fn(async () => ({}) as never),
        replaceTop: vi.fn(async () => ({}) as never),
        selectTab: vi.fn(async () => ({}) as never),
        selectColumn: vi.fn(async () => ({}) as never),
        hydrate: vi.fn(async () => ({}) as never),
    } as unknown as NavigationHandle;
}

function fakeSession(scopeValue: unknown): SessionHandle {
    let scope = scopeValue;
    return {
        get scope() {
            return scope as never;
        },
        restore: vi.fn(),
        save: vi.fn(),
        clear: vi.fn(),
        dispose: vi.fn(),
        // 暴露一个替换 scope 的口子，测试 getter 委托
        __setScope: (v: unknown) => {
            scope = v;
        },
    } as unknown as SessionHandle & { __setScope: (v: unknown) => void };
}

describe("createAppHandle", () => {
    test("合并 nav 命令/查询 + session save/clear；委托正确", () => {
        const nav = fakeNav();
        const session = fakeSession({ tag: "v1" });
        const app = createAppHandle(nav, session);

        void app.push("detail", { id: "1" });
        expect(nav.push).toHaveBeenCalledWith("detail", { id: "1" });
        app.save();
        expect(session.save).toHaveBeenCalledTimes(1);
        app.getSnapshot();
        expect(nav.getSnapshot).toHaveBeenCalled();
    });

    test("scope 是 getter，委托当前 session.scope（restore 重建后取到最新）", () => {
        const session = fakeSession({ tag: "v1" }) as SessionHandle & { __setScope: (v: unknown) => void };
        const app = createAppHandle(undefined, session);
        expect((app.scope as { tag: string }).tag).toBe("v1");
        session.__setScope({ tag: "v2" });
        expect((app.scope as { tag: string }).tag).toBe("v2"); // 非快照
    });

    test("只配 navigation → 无 session 成员；只配 session → 无 nav 成员", () => {
        const navOnly = createAppHandle(fakeNav(), undefined);
        expect(typeof navOnly.push).toBe("function");
        expect((navOnly as { save?: unknown }).save).toBeUndefined();

        const sessionOnly = createAppHandle(undefined, fakeSession({}));
        expect(typeof sessionOnly.save).toBe("function");
        expect((sessionOnly as { push?: unknown }).push).toBeUndefined();
    });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `vp test packages/browser/test/app-handle.test.ts`
Expected: FAIL —— `app-handle.ts` 不存在。

- [ ] **Step 3: 创建 `packages/browser/src/app-handle.ts`**

```ts
/**
 * AppHandle —— 框架构建的统一句柄:NavigationHandle 与 SessionHandle 的**组件面成员**扁平合并。
 *
 * 交付于 `startBrowserApp` 的 mount context（`context.app`），免应用手拼命令 facade（治 handle 之舞）。
 * bridge handle 的方法是闭包（不依赖 `this`），故直接引用赋值即可；`scope` 用 getter 委托当前
 * `session.scope`（restore 会重建 scope map，getter 保证取到最新实例）。
 *
 * 排除的成员（经 raw `navigation`/`session` 访问）:nav `hydrate`（桥内部/popstate）、
 * session `restore`（boot 专用，框架调）、session `dispose`（teardown）。
 */

import type { NavigationHandle } from "./navigation-bridge";
import type { SessionHandle } from "./session-bridge";

/** 统一 app 句柄。两个子系统都配齐时成员完整;只配其一则仅含该子系统成员（另一组运行期缺席）。 */
export interface AppHandle {
    // —— NavigationHandle 组件面 ——
    getSnapshot: NavigationHandle["getSnapshot"];
    subscribe: NavigationHandle["subscribe"];
    push: NavigationHandle["push"];
    pop: NavigationHandle["pop"];
    popToRoot: NavigationHandle["popToRoot"];
    replaceTop: NavigationHandle["replaceTop"];
    selectTab: NavigationHandle["selectTab"];
    selectColumn: NavigationHandle["selectColumn"];
    // —— SessionHandle 组件面 ——
    save: SessionHandle["save"];
    clear: SessionHandle["clear"];
    readonly scope: SessionHandle["scope"];
}

/**
 * 构建统一 app 句柄。`navigation`/`session` 任一缺省则其成员不并入。
 * 至少应有一个非空（调用方在配了 navigation 和/或 session 时才构建）。
 */
export function createAppHandle(
    navigation: NavigationHandle | undefined,
    session: SessionHandle | undefined,
): AppHandle {
    const app: Partial<AppHandle> = {};
    if (navigation !== undefined) {
        app.getSnapshot = navigation.getSnapshot;
        app.subscribe = navigation.subscribe;
        app.push = navigation.push;
        app.pop = navigation.pop;
        app.popToRoot = navigation.popToRoot;
        app.replaceTop = navigation.replaceTop;
        app.selectTab = navigation.selectTab;
        app.selectColumn = navigation.selectColumn;
    }
    if (session !== undefined) {
        app.save = session.save;
        app.clear = session.clear;
        Object.defineProperty(app, "scope", {
            get: () => session.scope,
            enumerable: true,
            configurable: true,
        });
    }
    return app as AppHandle;
}
```

> 说明:bridge handle 方法已确认为闭包（`navigation-bridge.ts` 的 `push(){ return controller.push(...) }`），直接 `app.push = navigation.push` 安全。`scope` 必须用 `defineProperty` getter（不能直接赋值/展开，否则快照了当前实例，restore 重建后失效）。

- [ ] **Step 4: 跑确认通过 + 诊断**

Run: `vp test packages/browser/test/app-handle.test.ts` —— 期望 3 passed。
Run: `vp check packages/browser/src packages/browser/test` —— 无错。

- [ ] **Step 5: 提交**

```bash
git add packages/browser/src/app-handle.ts packages/browser/test/app-handle.test.ts
git commit -m "feat(browser): createAppHandle — unified nav+session component-facing handle"
```

---

### Task 2: start-app.ts —— mount context + boot 重排 + 移除 onXReady

**Files:**
- Modify: `packages/browser/src/start-app.ts`
- Modify: `packages/browser/test/start-app.test.ts`

**先读** `packages/browser/src/start-app.ts` 全文，重点:`BrowserAppConfig`（约 108-215）、`startBrowserApp` body（约 222-382）、`activateNavigation`（约 392-463）、`activateSession`（约 509-554）、`ActivatedNavigation` 接口（约 384-390）。下面给目标形态，按现状精确改。

- [ ] **Step 1: 改 `BrowserAppConfig` —— mount context 加 handle/app，移除 onXReady**

`mount` 字段类型改为（context 加 `navigation?`/`session?`/`app?`）:

```ts
import type { AppHandle } from "./app-handle"; // 顶部 import 增

    mount: (
        target: HTMLElement,
        context: {
            framework: Framework;
            navigation?: NavigationHandle;
            session?: SessionHandle;
            app?: AppHandle;
        },
    ) => (props: { page: Promise<BasePage> | BasePage; isFirstPage?: boolean }) => void;
```

**删除** `onNavigationReady?` 与 `onSessionReady?` 两个字段（约 164-196 行的两段）及其文档注释。

- [ ] **Step 2: 把 `activateNavigation` 拆成 core（建 controller/bridge，不 resolve/不 orchestrator）+ 返回 controller**

将 `activateNavigation` 改名/重构为 `activateNavigationCore`，**移除内部的 `await controller.resolve()` 与 islands orchestrator 段**（那两段移到 body 的 mount 后）。返回结构加 `controller` 与 `codec`/`target` 供后续 orchestrator 用:

```ts
interface NavigationCore {
    readonly handle: NavigationHandle;
    readonly controller: NavigationController;
    readonly mountEntry?: MountEntry;
}

async function activateNavigationCore(args: {
    framework: Framework;
    navigation: BrowserNavigationConfig;
    log: Logger;
    getScrollablePageElement?: () => HTMLElement | null;
}): Promise<NavigationCore> {
    const { framework, navigation, log, getScrollablePageElement } = args;
    const codec = navigation.codec ?? createActiveLeafCodec();
    const controller = createNavigationController({
        intentDispatcher: framework.intentDispatcher,
        router: framework.router,
        initial: navigation.initial,
        createContext: ({ intent, params }) => {
            const url = codec.encode({ kind: "leaf", intent, params }, framework.router);
            return {
                container: framework.container,
                navigation: createBrowserContext({ url, intent: { id: intent, params }, container: framework.container }),
                url,
            };
        },
        beforeLoad: navigation.beforeLoad,
        afterLoad: navigation.afterLoad,
        prefetched: framework.prefetchedIntents,
        getErrorPage: navigation.getErrorPage,
        onRedirect: ({ url }) => {
            void framework.perform(makeFlowAction(url));
        },
    });
    const handle = createNavigationBridge({ controller, codec, router: framework.router, log, getScrollablePageElement });
    // 注意:不在此 resolve()、不建 orchestrator —— 均移到 mount 后（body 中）。
    return { handle, controller, mountEntry: navigation.mountEntry };
}
```

新增一个 mount 后的 islands 装配函数（从原 `activateNavigation` 的 orchestrator 段提取）:

```ts
/** mount 后:resolve 首屏 + （若有 mountEntry）从 outlet 建 orchestrator 首次 sync。返回 outlet（供 domRestore）。 */
async function attachNavigation(args: {
    core: NavigationCore;
    target: HTMLElement;
}): Promise<{ outlet?: HTMLElement }> {
    const { core, target } = args;
    await core.controller.resolve(); // 出 pages;redirect→perform 此刻安全（action handler 已注册）
    if (core.mountEntry === undefined) return {};
    const found = target.querySelector<HTMLElement>("[data-fs-outlet]");
    if (!found) {
        throw new Error(
            "[startBrowserApp] navigation.mountEntry 已提供，但 mount 渲染的 DOM 里找不到 [data-fs-outlet]。",
        );
    }
    const orchestrator = createIslandOrchestrator({ outlet: found, mountEntry: core.mountEntry });
    orchestrator.sync(core.controller.getSnapshot());
    core.controller.subscribe((snapshot) => orchestrator.sync(snapshot));
    return { outlet: found };
}
```

- [ ] **Step 3: 把 `activateSession` 拆成 core（建 store/bridge/providers，不 restore）+ 单独的 restore 调用**

`activateSession` 重构为 `activateSessionCore`，**移除内部的 `await bridge.restore(initialUrl)`**（移到 body mount 后），并接收 `navController`（来自 nav-core）替代原来的 `navigation: ActivatedNavigation`:

```ts
function activateSessionCore(args: {
    framework: Framework;
    session: BrowserSessionConfig;
    navController: NavigationController | undefined;
    flatNavigation: FlatNavigationEmitter | undefined;
}): SessionHandle {
    const { framework, session, navController, flatNavigation } = args;
    const currentUrl = (): string => window.location.pathname + window.location.search;
    const adapter = navController
        ? createNavigationSessionAdapter(navController, currentUrl)
        : createUrlSessionAdapter({ currentUrl, navigate: (url) => framework.perform(makeFlowAction(url)) });
    const subscribeNavigation = navController
        ? (onChange: () => void): (() => void) => navController.subscribe(() => onChange())
        : flatNavigation
          ? (onChange: () => void): (() => void) => flatNavigation.subscribe(onChange)
          : undefined;
    const store = createSessionStore({
        storage: session.storage ?? createWebStorage("session"),
        navigation: adapter,
        version: session.version,
        maxAgeMs: session.maxAgeMs,
    });
    for (const provider of session.providers ?? []) store.register(provider);
    return createSessionBridge({ store, adapter, subscribeNavigation, debounceMs: session.debounceMs, shouldRestore: session.shouldRestore });
}
```

> 注意:原 `activateSession` 用 `navController.subscribe`（flat-islands 也走结构化适配器，见上次 item 1 修复）。这里 `navController` 直接来自 nav-core。flat-islands 的 controller 仍在 mount 后建（见下），故 flat-islands + session 的 navController 在 session-core 时可能尚不存在 —— flat-islands+session 是未用组合，本任务保持「无 navController 时退 flatNavigation」即可，不为它额外加工。

- [ ] **Step 4: 重排 `startBrowserApp` body**

把 body（约 222-382）按下序重写（保留 1-3 步的 framework/bootstrap/routeUrl/locale 不变）。核心:nav/session core 前置到 mount 前;resolve/islands/restore/domRestore 留 mount 后。

```ts
    // （1-3 不变:prefetchedIntents、initialUrl、locale、framework.create、bootstrap、routeUrl → initialAction）

    const target = document.getElementById(mountId);
    if (!target) throw new Error(`[startBrowserApp] Mount target not found: #${mountId}. ...`);

    // 4. 【mount 前】nav-core:建 controller/bridge（handle 就绪;此刻 getSnapshot = {tree, []}）
    let navCore: NavigationCore | undefined;
    if (config.navigation) {
        navCore = await activateNavigationCore({
            framework, navigation: config.navigation, log,
            getScrollablePageElement: config.getScrollablePageElement,
        });
    }

    // 5. 【mount 前】flatNavigation 发射器(真扁平 session 用) + session-core(建 store/bridge,不 restore)
    const flatNavigation =
        config.session && !config.navigation && !config.mountEntry ? createNavigationEmitter() : undefined;
    let sessionHandle: SessionHandle | undefined;
    if (config.session) {
        sessionHandle = activateSessionCore({
            framework, session: config.session,
            navController: navCore?.controller, flatNavigation,
        });
    }

    // 6. 【mount 前】建统一 app 句柄
    const app =
        navCore || sessionHandle ? createAppHandle(navCore?.handle, sessionHandle) : undefined;

    // 7. 【mount】context 交付 handle/app
    const updateApp = mount(target, {
        framework,
        navigation: navCore?.handle,
        session: sessionHandle,
        app,
    });

    // 8. 注册 action handlers（需 updateApp;manageHistory 在结构化/flat-islands 下为 false）
    let flatPush: ((url: string) => Promise<void>) | undefined;
    registerActionHandlers({
        framework, log,
        callbacks: flatNavigation ? flatNavigation.wrap(callbacks) : callbacks,
        updateApp,
        getScrollablePageElement: config.getScrollablePageElement,
        manageHistory: !(config.navigation || config.mountEntry),
        onForward: config.mountEntry && !config.navigation ? (url) => flatPush?.(url) : undefined,
    });

    // 9. flat-islands（mount 后,需 outlet;无 navigation 时）
    let activatedFlatIslands: ActivatedFlatIslands | undefined;
    if (config.mountEntry && !config.navigation) {
        activatedFlatIslands = await activateFlatIslands({
            framework, initialUrl, mountEntry: config.mountEntry, target, log,
            getScrollablePageElement: config.getScrollablePageElement,
        });
        flatPush = activatedFlatIslands.pushUrl;
    }

    // 10. 首屏:flat 走 perform;结构化走 nav-core 的 resolve + islands 装配（均 mount 后）
    let islandsOutlet: HTMLElement | undefined;
    if (navCore) {
        const { outlet } = await attachNavigation({ core: navCore, target });
        islandsOutlet = outlet;
    } else if (!activatedFlatIslands) {
        if (initialAction) await framework.perform(initialAction.action);
        else updateApp({ page: Promise.reject(new Error("404")), isFirstPage: true });
    }
    islandsOutlet ??= activatedFlatIslands?.outlet;

    // 11. 会话 boot 恢复（mount 后:保 SSR 水合 parity）
    if (sessionHandle) await sessionHandle.restore(initialUrl);

    // 12. domRestore（mount 后,在 restore 之后:scope 已回填）
    if (config.domRestore && islandsOutlet && sessionHandle) {
        createDomRestore({ scope: sessionHandle.scope }).attach(islandsOutlet);
    }

    await onAfterStart?.(framework);
```

**删除**原 `await config.onNavigationReady?.(...)` 与 `await config.onSessionReady?.(...)` 调用。原 `ActivatedNavigation` 接口若不再用可删（其 `outlet` 现由 `attachNavigation` 返回）。

- [ ] **Step 5: 改写 `start-app.test.ts` 的 onXReady 用例**

`packages/browser/test/start-app.test.ts` 中涉及 `onNavigationReady`/`onSessionReady` 的用例（约 250、313-329、331-347、397-427、349-395 boot 恢复、822-839 flat-islands+session）按新契约改写。关键替换:

- 「hands a working handle to onNavigationReady」→ 改为断言 **mount context 收到 `navigation`**，且 `context.navigation.getSnapshot().tree` 等于 initial 树（证明 nav-core 在 mount 前完成、handle 就绪）:

```ts
test("mount context 收到就绪的 navigation handle（snapshot.tree 为 initial 树）", async () => {
    const { leaf, stack, BaseController } = await import("../../core/src/index.ts");
    // ...（沿用该用例既有的 window.history/popstate stub）
    class HomeController extends BaseController<Record<string, never>, { id: string }> {
        readonly intentId = "home";
        execute() { return { id: "home-page" }; }
    }
    let ctx: { navigation?: import("../src/navigation-bridge").NavigationHandle; app?: import("../src/app-handle").AppHandle } | undefined;
    await startBrowserApp({
        bootstrap(framework) { framework.router.add("/home", "home"); framework.registerIntent(new HomeController()); },
        mount(_t, context) { ctx = context; return vi.fn(); },
        callbacks: makeCallbacks(),
        navigation: { initial: stack([leaf("home")]) },
    });
    expect(ctx?.navigation).toBeDefined();
    expect(ctx?.navigation?.getSnapshot().tree).toEqual(stack([leaf("home")])); // mount 时 tree 已就绪
    expect(typeof ctx?.app?.push).toBe("function");                            // 统一句柄到位
});
```

- 「does not activate navigation / session」用例:`onNavigationReady`/`onSessionReady` 不再存在 → 改为断言 **flat 时 mount context 无 `navigation`/`session`/`app`**:

```ts
test("无 navigation/session 配置 → mount context 不含 navigation/session/app", async () => {
    let ctx: Record<string, unknown> | undefined;
    await startBrowserApp({
        bootstrap(f) { f.router.add("/", "home"); },
        mount(_t, context) { ctx = context as Record<string, unknown>; return vi.fn(); },
        callbacks: makeCallbacks(),
    });
    expect(ctx?.navigation).toBeUndefined();
    expect(ctx?.session).toBeUndefined();
    expect(ctx?.app).toBeUndefined();
});
```

- 「hands a session handle to onSessionReady」/ 「restores a pre-seeded snapshot」/ flat-islands+session（822-839）等取 sessionHandle 的用例:改为从 mount context 取 `context.session`，并把「session 恢复发生在 mount 后」用 spy 断言（restore 调用晚于 mount 回调）:

```ts
test("session handle 经 mount context 交付，且 restore 在 mount 之后", async () => {
    const order: string[] = [];
    // 用一个会记录 restore 调用的 storage 预置快照;mount 回调里 push "mount"
    // ...（沿用既有 fakeWebStorage / makeCoreStorage 预置 snapshot）
    let ctxSession: import("../src/session-bridge").SessionHandle | undefined;
    await startBrowserApp({
        bootstrap(f) { f.router.add("/", "home"); },
        mount(_t, context) { order.push("mount"); ctxSession = context.session; return vi.fn(); },
        callbacks: makeCallbacks(),
        session: { providers: [{ key: "draft", capture: () => "", restore: () => order.push("restore") }] },
    });
    expect(typeof ctxSession?.save).toBe("function"); // handle 在 mount 就绪
    expect(order).toEqual(["mount", "restore"]);       // restore 在 mount 之后
});
```

> 其余 islands/domRestore 集成用例（已存在）只要保持「navigation.mountEntry 提供时仍挂 island」「domRestore 仍回填」即可 —— 它们不依赖 onXReady，但需顺应 mount context 新签名（`mount(target, context)` 第二参类型变了，但既有用例多只用 `target`，不受影响）。

- [ ] **Step 6: 跑测试确认通过 + 诊断**

Run: `vp test packages/browser/test/start-app.test.ts`
Expected: 全 PASS（改写后用例 + 既有 islands/domRestore 用例）。
Run: `vp check packages/browser/src packages/browser/test`
Expected: 无错（特别确认无 `onNavigationReady`/`onSessionReady` 残留引用）。

- [ ] **Step 7: 提交**

```bash
git add packages/browser/src/start-app.ts packages/browser/test/start-app.test.ts
git commit -m "feat(browser): deliver nav/session handles + unified app in mount context; remove onXReady"
```

---

### Task 3: 导出 `AppHandle`

**Files:**
- Modify: `packages/browser/src/index.ts`
- Modify: `packages/front/src/browser.ts`

- [ ] **Step 1: browser/index.ts 导出 AppHandle**

在 `packages/browser/src/index.ts` 的 Navigation Islands 段附近加:

```ts
export { createAppHandle, type AppHandle } from "./app-handle";
```

- [ ] **Step 2: front/browser.ts 透出 AppHandle**

`packages/front/src/browser.ts` 的 `export type { ... } from "@finesoft/browser";` 块里加 `AppHandle,`，value 块（`export { ... } from "@finesoft/browser"`）加 `createAppHandle,`。（`index.ts` 经 `export * from "./browser"` 自动带，无需改。）

- [ ] **Step 3: 全量构建验证**

Run: `vp run -r build`
Expected: 14 包通过;`grep -q "AppHandle" packages/front/dist/index.d.mts && packages/front/dist/browser.d.mts` 均含 AppHandle。

- [ ] **Step 4: 提交**

```bash
git add packages/browser/src/index.ts packages/front/src/browser.ts
git commit -m "chore(exports): export AppHandle from browser + front"
```

---

### Task 4: vue-minimal 迁移（main.ts + ssr.ts）

**Files:**
- Modify: `templates/vue-minimal/src/main.ts`
- Modify: `templates/vue-minimal/src/ssr.ts`

- [ ] **Step 1: main.ts —— 删模块变量/makeController/onXReady，改从 context 取**

`templates/vue-minimal/src/main.ts` 重构。删除:`navHandle`/`sessionHandle` 模块变量、`makeController`/`controller` 常量、`onNavigationReady`/`onSessionReady` 旋钮。`AppController` 类型改为 `import type { AppHandle } from "@finesoft/front"` 的别名。`mount` 从 context 取 `app`/`navigation`:

```ts
import { startBrowserApp, type AppHandle, type MountEntry, type NavigationSnapshot, type SessionStateProvider } from "@finesoft/front";
import { createApp, createSSRApp, markRaw, reactive, type Component } from "vue";
import App from "./App.vue";
import HomeView from "./views/HomeView.vue";
import DetailView from "./views/DetailView.vue";
import NotesView from "./views/NotesView.vue";
import { bootstrap, navigation } from "./bootstrap";

export interface AppState {
    snapshot: NavigationSnapshot | null;
    name: string;
}
export type AppController = AppHandle; // 组件 prop 类型 = 框架统一句柄

const state = reactive<AppState>({ snapshot: null, name: "" });

/** 全局切片:用户名字(跨 tab、跨重载)。 */
const profileProvider: SessionStateProvider = {
    key: "profile",
    capture: () => ({ name: state.name }),
    restore: (data) => { state.name = (data as { name?: string }).name ?? ""; },
};

const VIEWS: Record<string, Component> = { home: HomeView, detail: DetailView, notes: NotesView };

const mountEntry: MountEntry = (entry, container) => {
    const view = VIEWS[entry.intent] ?? HomeView;
    const factory = entry.hydrate ? createSSRApp : createApp;
    const app = factory(view, { page: entry.page, controller });
    app.mount(container);
    return { unmount: () => app.unmount() };
};
```

> 注意:`mountEntry` 引用 `controller`，但 `controller` 现在只在 mount 回调里(context)才有。解法:`mountEntry` 也需要 `controller`。把 `controller` 提为模块级 `let controller: AppHandle | undefined`，在 mount 回调里赋值后再用;**或**（更干净）让 island view 经 context/provide 拿 controller。最简：模块级 `let controller: AppHandle | undefined;`，mount 回调首行 `controller = ctx.app;`，`mountEntry` 闭包读它（islands 在 mount 后才挂，此时 controller 已赋值）。下方 mount 用此式。

```ts
let controller: AppHandle | undefined;

void startBrowserApp({
    bootstrap,
    mount(target, ctx) {
        controller = ctx.app;                    // islands(mount 后挂)与 chrome 共用
        const nav = ctx.navigation;
        if (nav) {
            state.snapshot = nav.getSnapshot();  // mount 时 tree 已就绪
            nav.subscribe((s) => (state.snapshot = s));
        }
        let chromeRoot = target.querySelector<HTMLElement>("[data-fs-chrome]");
        if (!chromeRoot) {
            chromeRoot = document.createElement("div");
            chromeRoot.setAttribute("data-fs-chrome", "");
            const outlet = document.createElement("main");
            outlet.setAttribute("data-fs-outlet", "");
            target.append(chromeRoot, outlet);
        }
        const factory = chromeRoot.firstChild ? createSSRApp : createApp;
        factory(App, { state, controller: markRaw(ctx.app) }).mount(chromeRoot);
        return () => undefined;
    },
    callbacks: { onNavigate() {}, onModal() {} },
    navigation: { ...navigation.toBrowserConfig(), mountEntry },
    domRestore: true,
    session: { providers: [profileProvider] },
});
```

> `controller` 在 `mountEntry` 里用（islands 挂载在 mount 之后，`controller` 已被 mount 回调赋值），传给 island view 作 prop。`markRaw(ctx.app)` 给 chrome（Vue 不代理句柄）。模块变量从「navHandle/sessionHandle 两个 + makeController」减为「一个 `controller` 引用」，且无 onXReady。

- [ ] **Step 2: ssr.ts —— chrome 用真实快照（parity 升级）**

`templates/vue-minimal/src/ssr.ts` 的 `renderApp` 把 chrome 的 state 从 `{ snapshot: null, name: "" }` 改为真实 snapshot（客户端 mount 时也是该 URL 推导 snapshot → 一致，且 nav bar SSR 渲出）:

```ts
    async renderApp(page, _framework, snapshot) {
        // 客户端 mount 时 navigation.getSnapshot() 即此 URL 推导 snapshot（tree 一致）→ chrome 水合无失配,
        // 且 nav bar 首屏即被 SSR 渲出。name 仍默认 ""(会话恢复在 mount 后,水合后才生效)。
        const chromeHtml = await renderToString(createSSRApp(App, { state: { snapshot, name: "" } }));
        const islandsHtml = await renderIslandsHtml(snapshot, (entry: ResolvedEntry) =>
            renderToString(createSSRApp(VIEWS[entry.intent] ?? HomeView, { page: entry.page })),
        );
        return {
            html: `<div data-fs-chrome>${chromeHtml}</div><main data-fs-outlet>${islandsHtml}</main>`,
            head: `<title>${page.title}</title>`,
            css: "",
        };
    },
```

> App.vue 的 `state` prop 类型是 `AppState`(snapshot 可为真实值)，`{ state: { snapshot, name: "" } }` 仍匹配。`snapshot` 来自 renderApp 第三参，含 tree → SSR nav bar 渲出。

- [ ] **Step 3: 诊断 + 构建**

Run: `vp check templates/vue-minimal/src`
Expected: 无类型错（特别确认 `ctx.app`/`ctx.navigation` 类型贯通、无 `onNavigationReady` 残留）。
Run: `vp run -r build`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add templates/vue-minimal/src/main.ts templates/vue-minimal/src/ssr.ts
git commit -m "refactor(vue-minimal): use mount-context app handle; drop handle-dance boilerplate"
```

---

### Task 5: e2e 验证 + 全量回归（controller，playwright）

**Files:** 无（验证）

- [ ] **Step 1: 重启 dev server**

```bash
kill $(cat /tmp/finesoft-vue-dev.pid) 2>/dev/null; sleep 1
cd templates/vue-minimal && nohup vp dev > /tmp/finesoft-vue-dev.log 2>&1 & echo $! > /tmp/finesoft-vue-dev.pid
for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/item/1 2>/dev/null | grep -q 200 && { echo "READY ${i}s"; break; }; sleep 1; done
```
Expected: READY。

- [ ] **Step 2: 首屏 SSR 含 nav bar + island（parity 升级验证）**

```bash
curl -s http://localhost:5173/item/1 | grep -o '<div data-fs-chrome>.*</main>' | grep -o 'Feed\|Notes\|data-fs-entry\|Item 1' | sort | uniq -c
```
Expected: chrome 段含 `Feed`/`Notes`（nav bar 现 SSR 渲出）+ outlet 含 island `Item 1`。

- [ ] **Step 3: playwright 验证水合 + 功能不回归**

用 playwright:
1. navigate `/item/1` → `browser_console_messages(level=warning)` 断言 **0 hydration mismatch**。
2. island note 可输入;切 Notes tab 再切回 → note 保留（keep-alive）。
3. 输入 note → 重载 `/item/1` → note 回填（session + domRestore）;`/item/2` → 不泄漏。
4. 断言 nav bar（Feed/Notes 按钮）可点、selectTab 生效（验证 `ctx.app` 命令链路通）。

Expected: 全部 ✓。

- [ ] **Step 4: 全量测试 + 构建**

Run: `vp test packages/core packages/browser packages/ssr`
Expected: 全绿（含新增 app-handle 用例 + 改写的 start-app 用例 + 既有不回归）。
Run: `vp run -r build`
Expected: 14 包通过。

- [ ] **Step 5: 提交（若 Step 1-4 触发收尾修补）**

```bash
git add -A && git commit -m "test(mount-context): e2e verify handle delivery + no regressions"
```

---

## Self-Review 备注

- **Spec 覆盖:** §3 mount context→Task2 Step1;§4 统一句柄成员→Task1;§5 boot 重排(restore 后置)→Task2 Step2-4;§6 SSR parity 升级→Task4 Step2;§8 移除 onXReady/迁移面→Task2+Task4;测试→各 Task + Task5。
- **时序破环已验证:** controller.ts:323 `resolve()` 前 `getSnapshot()` 返 `{tree,[]}` → nav-core(建 controller,不 resolve)可前置到 mount 前;`resolve()`(可能 redirect→perform)留 mount 后(registerActionHandlers 已注册)。
- **闭包已验证:** bridge handle 方法是闭包，`createAppHandle` 直接引用赋值安全;`scope` 用 getter。
- **类型一致:** `AppHandle`(Task1)贯穿 Task2(mount context)/Task3(导出)/Task4(模板 prop);`NavigationCore`/`activateNavigationCore`/`attachNavigation`/`activateSessionCore` 命名在 Task2 内自洽。
- **flat 不回归:** 无 navigation/session → context 仅 `{framework}`、mount→registerActionHandlers→perform 路径保留。
- **已知 looseness:** `AppHandle` 类型在「只配其一」时仍呈现完整成员（另一组运行期缺席）—— 文档注释标注;vue-minimal 两者皆配，完整有效。
