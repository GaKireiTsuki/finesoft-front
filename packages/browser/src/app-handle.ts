/**
 * AppHandle —— 框架构建的统一句柄:NavigationHandle 与 SessionHandle 的**组件面成员**扁平合并。
 *
 * 交付于 `startBrowserApp` 的 mount context(`context.app`),免应用手拼命令 facade(治 handle 之舞)。
 * bridge handle 的方法是闭包(不依赖 `this`),故直接引用赋值即可;`scope` 用 getter 委托当前
 * `session.scope`(restore 会重建 scope map,getter 保证取到最新实例)。
 *
 * 排除的成员(经 raw `navigation`/`session` 访问):nav `hydrate`(桥内部/popstate)、
 * session `restore`(boot 专用,框架调)、session `dispose`(teardown)。
 */

import type { NavigationHandle } from "./navigation-bridge";
import type { SessionHandle } from "./session-bridge";

/** 统一 app 句柄。两个子系统都配齐时成员完整;只配其一则仅含该子系统成员(另一组运行期缺席)。 */
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
 * 至少应有一个非空(调用方在配了 navigation 和/或 session 时才构建)。
 */
export function createAppHandle(
    navigation: NavigationHandle | undefined,
    session: SessionHandle | undefined,
): AppHandle {
    const app: Partial<AppHandle> = {};
    if (navigation !== undefined) {
        app.getSnapshot = (...args) => navigation.getSnapshot(...args);
        app.subscribe = (...args) => navigation.subscribe(...args);
        app.push = (...args) => navigation.push(...args);
        app.pop = (...args) => navigation.pop(...args);
        app.popToRoot = (...args) => navigation.popToRoot(...args);
        app.replaceTop = (...args) => navigation.replaceTop(...args);
        app.selectTab = (...args) => navigation.selectTab(...args);
        app.selectColumn = (...args) => navigation.selectColumn(...args);
    }
    if (session !== undefined) {
        app.save = (...args) => session.save(...args);
        app.clear = (...args) => session.clear(...args);
        Object.defineProperty(app, "scope", {
            get: () => session.scope,
            enumerable: true,
            configurable: true,
        });
    }
    return app as AppHandle;
}
