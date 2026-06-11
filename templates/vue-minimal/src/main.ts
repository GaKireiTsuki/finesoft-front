import {
    startBrowserApp,
    type AppHandle,
    type MountEntry,
    type NavigationSnapshot,
    type SessionStateProvider,
} from "@finesoft/front";
import { createApp, createSSRApp, markRaw, reactive, type Component } from "vue";
import App from "./App.vue";
import HomeView from "./views/HomeView.vue";
import DetailView from "./views/DetailView.vue";
import NotesView from "./views/NotesView.vue";
import { bootstrap, navigation } from "./bootstrap";

/** 只把要渲染的数据放进 reactive；handle 是带闭包的复杂对象，留在模块作用域不被代理。 */
export interface AppState {
    snapshot: NavigationSnapshot | null;
    name: string;
}
export type AppController = AppHandle; // 组件 prop 类型 = 框架统一句柄

const state = reactive<AppState>({ snapshot: null, name: "" });

/** 全局切片（app-wide）：用户名字 —— 跨 tab、跨重载都在（对标 SwiftUI @SceneStorage）。 */
const profileProvider: SessionStateProvider = {
    key: "profile",
    capture: () => ({ name: state.name }),
    restore: (data) => {
        state.name = (data as { name?: string }).name ?? "";
    },
};

/** islands 闭包引用：mount 回调赋值，islands(mount 后挂)读时已就绪。 */
let controller: AppHandle | undefined;

/** intent → 视图组件。islands 按 entry 挂为独立 Vue app。 */
const VIEWS: Record<string, Component> = { home: HomeView, detail: DetailView, notes: NotesView };

const mountEntry: MountEntry = (entry, container) => {
    const view = VIEWS[entry.intent] ?? HomeView;
    // 首屏 island 已由 SSR 渲入容器（编排器收养并置 hydrate:true）→ 水合；否则新建。
    const factory = entry.hydrate ? createSSRApp : createApp;
    const app = factory(view, { page: entry.page, controller });
    app.mount(container);
    return { unmount: () => app.unmount() };
};

void startBrowserApp({
    bootstrap,
    mount(target: HTMLElement, ctx) {
        controller = ctx.app; // islands(mount 后挂)与 chrome 共用
        const nav = ctx.navigation;
        if (nav) {
            state.snapshot = nav.getSnapshot(); // mount 时 tree 已就绪
            nav.subscribe((s) => (state.snapshot = s));
        }
        // 方案 C：chrome 挂到 sibling chrome-root（不含 outlet）；outlet 由框架编排器独占。
        let chromeRoot = target.querySelector<HTMLElement>("[data-fs-chrome]");
        if (!chromeRoot) {
            // 纯 CSR（无 SSR shell）兜底：建 chrome-root + 空 outlet 兄弟。
            chromeRoot = document.createElement("div");
            chromeRoot.setAttribute("data-fs-chrome", "");
            const outlet = document.createElement("main");
            outlet.setAttribute("data-fs-outlet", "");
            target.append(chromeRoot, outlet);
        }
        // 有 SSR 内容 → 水合；否则客户端新建。
        const factory = chromeRoot.firstChild ? createSSRApp : createApp;
        factory(App, { state, controller: markRaw(ctx.app!) }).mount(chromeRoot);
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
