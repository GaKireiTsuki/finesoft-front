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

/** 只把要渲染的数据放进 reactive；handle 是带闭包的复杂对象，留在模块作用域不被代理。 */
export interface AppState {
    snapshot: NavigationSnapshot | null;
    name: string;
}

const state = reactive<AppState>({ snapshot: null, name: "" });

let navHandle: NavigationHandle | null = null;
let sessionHandle: SessionHandle | null = null;

/** 全局切片（app-wide）：用户名字 —— 跨 tab、跨重载都在（对标 SwiftUI @SceneStorage）。 */
const profileProvider: SessionStateProvider = {
    key: "profile",
    capture: () => ({ name: state.name }),
    restore: (data) => {
        state.name = (data as { name?: string }).name ?? "";
    },
};

/** 交给 App.vue 的命令面（markRaw：不让 Vue 代理 handle 方法）。 */
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

/** intent → 视图组件。islands 按 entry 挂为独立 Vue app。 */
const VIEWS: Record<string, Component> = { home: HomeView, detail: DetailView, notes: NotesView };

const mountEntry: MountEntry = (entry, container) => {
    const view = VIEWS[entry.intent] ?? HomeView;
    const app = createApp(view, { page: entry.page, controller });
    app.mount(container);
    return { unmount: () => app.unmount() };
};

void startBrowserApp({
    bootstrap,
    mount(target: HTMLElement) {
        createApp(App, { state, controller }).mount(target);
        // chrome 由 snapshot 订阅驱动更新；islands 内容由 outlet 驱动，不需要 updateApp。
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
    onNavigationReady(handle) {
        navHandle = handle;
        state.snapshot = handle.getSnapshot();
        handle.subscribe((snapshot) => {
            state.snapshot = snapshot;
        });
    },
    // 会话恢复：注册全局切片 provider；导航位置 + 作用域状态由框架自动捕获。
    session: { providers: [profileProvider] },
    onSessionReady(handle) {
        sessionHandle = handle;
    },
});
