import {
    resolveIslandsShell,
    startBrowserApp,
    type AppHandle,
    type BasePage,
    type MountEntry,
    type SessionStateProvider,
} from "@finesoft/front";
import type { ComponentType } from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import App, { type NameStore } from "./App";
import { bootstrap, navigation } from "./bootstrap";
import DetailView from "./views/DetailView";
import HomeView from "./views/HomeView";
import NotesView from "./views/NotesView";

/** name 全局切片的极小外部 store —— React 无内建响应式，跨组件共享需显式 store（mount 前建好交给 provider + App）。 */
function createNameStore(): NameStore {
    let value = "";
    const listeners = new Set<() => void>();
    return {
        get: () => value,
        set: (v) => {
            value = v;
            listeners.forEach((l) => l());
        },
        subscribe: (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
    };
}
const nameStore = createNameStore();

/** 全局切片（app-wide）：用户名字 —— 跨 tab、跨重载都在（对标 SwiftUI @SceneStorage）。 */
const profileProvider: SessionStateProvider = {
    key: "profile",
    capture: () => ({ name: nameStore.get() }),
    restore: (data) => nameStore.set((data as { name?: string }).name ?? ""),
};

/** islands 闭包引用：mount 回调赋值，islands(mount 后挂)读时已就绪。 */
let controller: AppHandle | undefined;

/** intent → 视图组件。islands 按 entry 挂为独立 React root。 */
const VIEWS: Record<string, ComponentType<{ page: BasePage; controller?: AppHandle }>> = {
    home: HomeView,
    detail: DetailView,
    notes: NotesView,
};

const mountEntry: MountEntry = (entry, container) => {
    const View = VIEWS[entry.intent] ?? HomeView;
    const element = <View page={entry.page} controller={controller} />;
    // 首屏 island 已由 SSR 渲入容器（编排器收养并置 hydrate:true）→ 水合；否则新建。
    if (entry.hydrate) {
        const root = hydrateRoot(container, element);
        return { unmount: () => root.unmount() };
    }
    const root = createRoot(container);
    // flushSync 强制同步提交：domRestore 在 fs:enter 后用 rAF 回填 data-restore-root 字段，
    // 而 React 的 root.render() 默认异步提交 DOM，rAF 会赢得竞态、字段元素尚不存在 → 回填扑空
    // （从根路径恢复到深层 URL 时，该 island 是客户端新挂、非 SSR，必踩）。同步提交贴合 domRestore
    // 假设的「挂载即 DOM 就绪」契约（Vue/Svelte 的 .mount() 天然同步满足）。
    flushSync(() => root.render(element));
    return { unmount: () => root.unmount() };
};

void startBrowserApp({
    bootstrap,
    mount(target, ctx) {
        controller = ctx.app; // islands(mount 后挂)与 chrome 共用
        // 方案 C：chrome 挂到 sibling chrome-root（不含 outlet）；outlet 由框架编排器独占。
        const { chromeRoot, hydrate } = resolveIslandsShell(target);
        const initialSnapshot = ctx.navigation?.getSnapshot() ?? null;
        const element = (
            <App
                initialSnapshot={initialSnapshot}
                nav={ctx.navigation}
                controller={ctx.app}
                nameStore={nameStore}
            />
        );
        if (hydrate) hydrateRoot(chromeRoot, element);
        else createRoot(chromeRoot).render(element);
        return () => undefined;
    },
    callbacks: {
        onNavigate() {},
        onModal() {},
    },
    // 结构化导航 + islands：每屏 per-entry 挂为独立 root、保活。
    navigation: { ...navigation.toBrowserConfig(), mountEntry },
    // 重载 DOM 自动恢复：data-restore-root 内字段/滚动自动捕获回填。
    domRestore: true,
    // 会话恢复：注册全局切片 provider；导航位置 + 作用域状态由框架自动捕获。
    session: { providers: [profileProvider] },
});
