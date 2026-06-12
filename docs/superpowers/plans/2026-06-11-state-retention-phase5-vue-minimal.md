# 会话恢复完整实现 · Phase 5：vue-minimal 模版重构为 islands 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 vue-minimal 从「单 mount + snapshot 整树重渲」重构为 islands：`App.vue` 收敛为 chrome（tab bar / back / 全局 name / `data-fs-outlet`），页面拆为 per-entry 视图（`HomeView`/`DetailView`/`NotesView`）经 `mountEntry` 挂为 island；**删除手写 `getScoped/setScoped` 样板**，改为「标 `data-restore-root` 的裸 `<input>` 自动 in-session 保活 + 重载恢复」——直观证明「写个 input 不再写一堆逻辑」。

**Architecture:** `mountEntry` 在 `main.ts`：按 `entry.intent` 选 Vue 组件、`createApp(View, { page, controller }).mount(container)`、返回 `{ unmount }`。`navigation` 配置 = `{ ...navigation.toBrowserConfig(), mountEntry }`，并 `domRestore: true`。`App.vue` 仅订阅 snapshot 渲 chrome + 提供稳定空 outlet。视图组件从 `props.page` 取数据，`DetailView` 内放 `data-restore-root` + 裸 `<input name="note">` 作零样板保活活靶。

**Tech Stack:** Vue 3（`createApp`）、Vite+。改 `templates/vue-minimal`（模版不入 CI 单测/覆盖率）。**依赖 Phase 1-3（+ Phase 4 若做扁平；本模版用结构化 islands）。** 验证用 **playwright**（真浏览器 E2E）。

**落地分支：** `feat/session-restoration`。**注意：** 工作区现有未提交的 [App.vue:119](../../templates/vue-minimal/src/App.vue#L119) 裸 `<input>`（用户实验）——本阶段把它正式落进 `DetailView` 的 `data-restore-root` 作演示，旧的随 App.vue 重写一并清掉。

---

## Task 0：确认 SSR 处理（islands 与 SSR 的接缝）

islands 的内容在**客户端** per-entry `createApp` 挂载。若 vue-minimal 当前对内容做 SSR（`App.vue` 的 `page` prop 服务端渲染），重构后服务端将只渲 chrome + 空 outlet，内容首屏由客户端填充。

**Files:** Read: `templates/vue-minimal/src/ssr.ts`、`templates/vue-minimal/src/main.ts`、`templates/vue-minimal/vite.config.*` / 路由 renderMode。

- [ ] **Step 1：判定当前内容是否 SSR + 选定 islands 的 SSR 策略**

读 `ssr.ts` 与路由 renderMode：

- 若内容本就 CSR（renderMode `csr`）→ 重构无 SSR 影响，直接进 Task 1。
- 若内容 SSR → 选定策略并记录：
    - **(推荐，本阶段采用) 内容 CSR 化**：把演示路由设为 `renderMode: "csr"`（islands 是客户端 keep-alive 特性；服务端渲 chrome 空壳）。在模版 README/注释说明。
    - **(follow-up，本阶段不做) island 水合**：服务端把可见 entry 内容渲进 outlet 容器、客户端 `createSSRApp` 水合首个 island 而非重挂——非平凡，列为后续。

把判定与所选策略写进本任务结论。

- [ ] **Step 2：（若需）调整 renderMode 为 csr**

按 Step 1 结论，必要时把演示路由的 renderMode 设为 `csr`（对齐模版既有 renderMode 配置写法）。

- [ ] **Step 3：提交（若有改动）**

```bash
git add templates/vue-minimal/src
git commit -m "chore(vue-minimal): islands 内容采用 CSR 渲染（SSR-of-islands 列为后续）"
```

---

## Task 1：新增 per-entry 视图组件

**Files:**

- Create: `templates/vue-minimal/src/views/HomeView.vue`
- Create: `templates/vue-minimal/src/views/DetailView.vue`
- Create: `templates/vue-minimal/src/views/NotesView.vue`

- [ ] **Step 1：HomeView.vue（feed 列表，push detail）**

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { BasePage } from "@finesoft/front";
import type { FeedPage } from "../lib/controllers/home";
import type { AppController } from "../main";

const { page, controller } = defineProps<{ page: BasePage; controller?: AppController }>();
const feed = computed(() => (page.pageType === "home" ? (page as FeedPage) : null));
</script>

<template>
    <section>
        <h1 style="margin: 0 0 0.25rem">{{ page.title }}</h1>
        <p style="color: #666; margin: 0 0 1rem">{{ page.description }}</p>
        <ul v-if="feed" style="list-style: none; padding: 0; display: grid; gap: 0.5rem">
            <li v-for="item in feed.items" :key="item.id">
                <button
                    style="width: 100%; text-align: left"
                    @click="controller?.push('detail', { id: item.id })"
                >
                    {{ item.title }} →
                </button>
            </li>
        </ul>
    </section>
</template>
```

- [ ] **Step 2：DetailView.vue（detail + 零样板自动保活 input —— 核心演示）**

```vue
<script setup lang="ts">
import type { BasePage } from "@finesoft/front";

defineProps<{ page: BasePage }>();
</script>

<template>
    <section>
        <h1 style="margin: 0 0 0.25rem">{{ page.title }}</h1>
        <p style="color: #666; margin: 0 0 1rem">{{ page.description }}</p>

        <!--
          零样板保活：标一个 data-restore-root，里面的裸 <input> 即自动：
          - in-session：push 走、pop 回来值还在（islands 保活，实例没销毁）
          - 重载：sessionStorage 回填（domRestore），合成事件驱动可能的受控绑定
          对比重构前：需手写 entryKey + watch + getScoped/setScoped —— 现在一行不写。
        -->
        <div data-restore-root>
            <label style="display: block; margin-top: 1rem">
                Draft note for this screen:
                <input
                    name="note"
                    placeholder="kept while alive; restored on reload"
                    style="width: 100%"
                />
            </label>
        </div>
    </section>
</template>
```

- [ ] **Step 3：NotesView.vue**

```vue
<script setup lang="ts">
import type { BasePage } from "@finesoft/front";

defineProps<{ page: BasePage }>();
</script>

<template>
    <section>
        <h1 style="margin: 0 0 0.25rem">{{ page.title }}</h1>
        <p style="color: #666; margin: 0 0 1rem">{{ page.description }}</p>
    </section>
</template>
```

- [ ] **Step 4：提交**

```bash
git add templates/vue-minimal/src/views
git commit -m "feat(vue-minimal): per-entry 视图组件（Home/Detail/Notes），Detail 演示零样板自动保活"
```

---

## Task 2：`App.vue` 收敛为 chrome + outlet

**Files:** Modify: `templates/vue-minimal/src/App.vue`（整文件重写）

- [ ] **Step 1：重写 App.vue**

```vue
<script setup lang="ts">
import { isStackNode, isTabsNode } from "@finesoft/front";
import { computed } from "vue";
import type { AppController, AppState } from "./main";

const { state, controller } = defineProps<{ state?: AppState; controller?: AppController }>();

const tree = computed(() => state?.snapshot?.tree ?? null);

/** Tab bar（tree 为 tabs 节点时）。 */
const tabs = computed(() => {
    const t = tree.value;
    return t && isTabsNode(t) ? { order: t.order, active: t.active } : null;
});
const tabLabels: Record<string, string> = { home: "Feed", notes: "Notes" };

/** 激活 tab 的栈深 > 1 → 可返回。 */
const canGoBack = computed(() => {
    const t = tree.value;
    if (!t || !isTabsNode(t)) return false;
    const branch = t.branches[t.active];
    return !!branch && isStackNode(branch) && branch.entries.length > 1;
});

/** 全局切片：名字（跨 tab / 跨重载）。 */
const name = computed({
    get: () => state?.name ?? "",
    set: (v) => {
        if (state) state.name = v;
    },
});
</script>

<template>
    <div style="max-width: 32rem; margin: 0 auto; padding: 1rem; font-family: system-ui">
        <!-- 全局切片：名字 -->
        <header style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem">
            <label v-if="state" style="flex: 1">
                Your name (global):
                <input v-model="name" placeholder="anon" @blur="controller?.save()" />
            </label>
            <span v-if="name">👋 {{ name }}</span>
        </header>

        <!-- TabView -->
        <nav v-if="tabs" style="display: flex; gap: 0.5rem; margin-bottom: 1rem">
            <button
                v-for="key in tabs.order"
                :key="key"
                :style="{ fontWeight: key === tabs.active ? '700' : '400' }"
                :aria-current="key === tabs.active"
                @click="controller?.selectTab(key)"
            >
                {{ tabLabels[key] ?? key }}
            </button>
        </nav>

        <button v-if="canGoBack" style="margin-bottom: 0.5rem" @click="controller?.pop()">
            ← Back
        </button>

        <!-- islands 内容由框架挂进此 outlet（稳定、空、不加 v-if） -->
        <main data-fs-outlet></main>
    </div>
</template>
```

- [ ] **Step 2：提交**

```bash
git add templates/vue-minimal/src/App.vue
git commit -m "refactor(vue-minimal): App.vue 收敛为 chrome + data-fs-outlet（删页面渲染与 scoped 样板）"
```

---

## Task 3：`main.ts` 接 `mountEntry` + `domRestore`，删 scoped 样板

**Files:** Modify: `templates/vue-minimal/src/main.ts`

- [ ] **Step 1：改 main.ts**

引入视图组件与 Vue `Component`/`MountEntry`，定义 `mountEntry`，把它接进 `navigation` 配置并开 `domRestore`，删 `getScoped/setScoped`。关键改动：

**(a)** import：

```ts
import {
    startBrowserApp,
    type MountEntry,
    type NavigationHandle,
    type NavigationSnapshot,
    type SessionHandle,
    type SessionStateProvider,
} from "@finesoft/front";
import { createApp, markRaw, reactive, type Component } from "vue";
import App from "./App.vue";
import HomeView from "./views/HomeView.vue";
import DetailView from "./views/DetailView.vue";
import NotesView from "./views/NotesView.vue";
import { bootstrap, navigation } from "./bootstrap";
```

**(b)** controller 去掉 `getScoped`/`setScoped`（islands 保活 + data-restore-root 已取代）：

```ts
export type AppController = ReturnType<typeof makeController>;
function makeController() {
    return markRaw({
        push: (intent: string, params?: Record<string, unknown>) =>
            void navHandle?.push(intent, params),
        pop: () => void navHandle?.pop(),
        selectTab: (key: string) => void navHandle?.selectTab(key),
        /** 手动落盘（全局切片改动后调；nav 变更已自动落盘）。 */
        save: () => void sessionHandle?.save(),
    });
}
const controller = makeController();
```

**(c)** 定义 `mountEntry`（intent → 组件；createApp per island）：

```ts
/** intent → 视图组件。islands 按 entry 挂为独立 Vue app。 */
const VIEWS: Record<string, Component> = { home: HomeView, detail: DetailView, notes: NotesView };

const mountEntry: MountEntry = (entry, container) => {
    const view = VIEWS[entry.intent] ?? HomeView;
    const app = createApp(view, { page: entry.page, controller });
    app.mount(container);
    return { unmount: () => app.unmount() };
};
```

**(d)** `startBrowserApp` 配置：`navigation` 合入 `mountEntry`、加 `domRestore: true`；`mount` 改为只挂 chrome（App.vue 渲 chrome + outlet）：

```ts
void startBrowserApp({
    bootstrap,
    mount(target: HTMLElement) {
        createApp(App, { state, controller }).mount(target);
        return () => undefined; // islands 内容由 outlet 驱动；chrome 由 snapshot 订阅更新
    },
    callbacks: { onNavigate() {}, onModal() {} },
    // 结构化导航 + islands：每屏 per-entry 挂为独立 root、保活。
    navigation: { ...navigation.toBrowserConfig(), mountEntry },
    // 重载 DOM 自动恢复：data-restore-root 内字段/滚动自动捕获回填。
    domRestore: true,
    onNavigationReady(handle) {
        navHandle = handle;
        state.snapshot = handle.getSnapshot();
        handle.subscribe((snapshot) => {
            state.snapshot = snapshot;
        });
    },
    session: { providers: [profileProvider] },
    onSessionReady(handle) {
        sessionHandle = handle;
    },
});
```

（`AppState`、`state`、`navHandle`/`sessionHandle`、`profileProvider` 保持不变。）

- [ ] **Step 2：类型/构建校验**

Run: `vp check templates/vue-minimal/src`（或模版既有校验脚本）
Expected: PASS（无 unused、`MountEntry`/`Component` 类型正确、controller 去掉 scoped 后无引用残留）。

> 若 App.vue 之外仍有引用 `getScoped/setScoped/sessionEntryKey` 的地方，一并清除。

- [ ] **Step 3：提交**

```bash
git add templates/vue-minimal/src/main.ts
git commit -m "feat(vue-minimal): main.ts 接 islands mountEntry + domRestore，删手写 scoped 样板"
```

---

## Task 4：playwright 真浏览器验证（keep-alive + 重载恢复）

模版不入 vitest；用 dev server + playwright 验证行为。**由用户在 VSCode 集成终端起 dev server**（长跑进程），执行者用 playwright MCP 操作 + 断言。

- [ ] **Step 1：起 dev server（用户操作）**

提示用户在集成终端运行：`cd templates/vue-minimal && vp dev`，给出本地 URL（一般 `http://localhost:5173`）。

- [ ] **Step 2：验证 in-session 保活（pop 不丢状态、不重 fetch）**

playwright：

1. `browser_navigate` → `/`（Feed）。
2. 点一个 item → push 到 detail（`browser_click`）。
3. 在 detail 的 "Draft note" 输入框输入 `hello`（`browser_type`）。
4. 点 `← Back` → pop 回 Feed。
5. 再点同一 item → 回到 detail。
6. **断言**：detail 的 note 仍是 `hello`（`browser_snapshot` / evaluate 读 input.value）—— islands 保活，零样板。
7. 切 tab Notes ↔ Feed，确认各分支栈深/位置保活（`browser_snapshot`）。

- [ ] **Step 3：验证重载恢复（domRestore）**

1. 在 detail 输入 `draft-xyz`。
2. `browser_navigate`（刷新当前 URL，如 `/item/2`）或 `browser_press_key` F5 等价的重载。
3. **断言**：重载后回到同一 detail，note 输入框值为 `draft-xyz`（sessionStorage 回填）。
4. 全局 name 输入 `Megumi`，重载，断言 name 仍在（既有 slice provider，回归确认）。

- [ ] **Step 4：验证 devtools 不可见（detach）**

push detail 后，`browser_evaluate` 跑 `document.querySelectorAll('[data-fs-entry]').length` —— 应只见**可见**那一屏的 island（被 detach 的 home island 不在 document → count 反映仅可见数），佐证「隐藏=detach、屏间隔离」。

- [ ] **Step 5：记录验证结果**

把 playwright 验证结论（通过/截图）写入提交说明或 PR 描述。dev server 由用户 ctrl+c 关闭。

- [ ] **Step 6：（如有模版侧小修）提交**

```bash
git add templates/vue-minimal
git commit -m "test(vue-minimal): playwright 验证 islands 保活 + 重载恢复"
```

---

## Phase 5 完成定义（DoD）

- `App.vue` = chrome + `data-fs-outlet`；页面拆为 `HomeView`/`DetailView`/`NotesView` islands。
- 手写 `getScoped/setScoped` 样板删除；`DetailView` 用 `data-restore-root` + 裸 `<input>` 演示零样板保活。
- `main.ts` 经 `mountEntry` 挂 island、开 `domRestore`。
- playwright 验证：in-session pop 回保留 note（不重 fetch）、重载回填 note + 保留全局 name、detach 使背景屏不在 document。
- SSR 策略已判定（CSR 化或记录为 follow-up）。

## 自审记录

- **spec 覆盖**：§8 vue-minimal 段（App.vue 拆 chrome、视图 islands、删 scoped 样板、data-restore-root、保留裸 input 作活靶）、§1 动机（「写个 input 不该写一堆逻辑」由 DetailView 正面回应）、§4.2 detach（Task 4 Step 4 验证）。
- **占位扫描**：组件/`main.ts` 给出完整代码；Task 0 是显式 SSR 判定（非占位，产出明确策略）；Task 4 是 playwright E2E（非单测，模版不入 CI）。
- **类型一致**：`mountEntry: MountEntry`（Phase 2 导出）、`AppController`（去 scoped）、视图 `props: { page: BasePage; controller? }`、`VIEWS: Record<string, Component>` 跨文件一致。
- **诚实声明**：islands 与 SSR 的接缝是已知开放点（Task 0）；本阶段采「内容 CSR 化」最小可行，island 服务端水合列为后续。模版重构不影响已发布包（templates 不发布）。
