import {
    startBrowserApp,
    type NavigationHandle,
    type NavigationSnapshot,
    type SessionHandle,
    type SessionStateProvider,
} from "@finesoft/front";
import { createApp, markRaw, reactive } from "vue";
import App from "./App.vue";
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
        /** 导航作用域状态读写（每屏 per-entry）。 */
        getScoped: (entryKey: string): unknown => sessionHandle?.scope.get(entryKey),
        setScoped: (entryKey: string, data: unknown) => sessionHandle?.scope.set(entryKey, data),
        /** 手动落盘（全局切片改动后调；nav 变更已自动落盘）。 */
        save: () => void sessionHandle?.save(),
    });
}
const controller = makeController();

void startBrowserApp({
    bootstrap,
    mount(target: HTMLElement) {
        createApp(App, { state, controller }).mount(target);
        // 结构化导航由下面的 snapshot 订阅驱动渲染，扁平 updateApp 在本模版不使用。
        return () => undefined;
    },
    callbacks: {
        onNavigate() {},
        onModal() {},
    },
    // 结构化导航：TabView of NavigationStacks。
    navigation: navigation.toBrowserConfig(),
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
