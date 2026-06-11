import { describe, expect, test, vi } from "vite-plus/test";
import { createAppHandle } from "../src/app-handle";
import type { NavigationHandle } from "../src/navigation-bridge";
import type { SessionHandle } from "../src/session-bridge";

/**
 * Fake NavigationHandle：刻意返回**对象字面量类型**（不标注成 `NavigationHandle` 接口），
 * 这样 `expect(nav.push)` 是普通属性访问而非接口方法引用，避开 `unbound-method` 警告。
 * 传入 `createAppHandle` 时在调用点 `as` 转换（同 session-bridge.test 对 store 的写法）。
 */
function fakeNav() {
    return {
        getSnapshot: vi.fn(() => ({
            tree: { kind: "leaf", intent: "home", params: {} },
            destinations: [],
        })),
        subscribe: vi.fn(() => () => {}),
        push: vi.fn(async () => ({}) as never),
        pop: vi.fn(async () => ({}) as never),
        popToRoot: vi.fn(async () => ({}) as never),
        replaceTop: vi.fn(async () => ({}) as never),
        selectTab: vi.fn(async () => ({}) as never),
        selectColumn: vi.fn(async () => ({}) as never),
        hydrate: vi.fn(async () => ({}) as never),
    };
}

/**
 * Fake SessionHandle：同上，返回字面量类型。`scope` 用 getter + 局部变量模拟 restore 重建。
 */
function fakeSession(scopeValue: unknown) {
    let scope = scopeValue;
    return {
        get scope() {
            return scope as never;
        },
        restore: vi.fn(),
        save: vi.fn(),
        clear: vi.fn(),
        dispose: vi.fn(),
        __setScope: (v: unknown) => {
            scope = v;
        },
    };
}

describe("createAppHandle", () => {
    test("合并 nav 命令/查询 + session save/clear;委托正确", () => {
        const nav = fakeNav();
        const session = fakeSession({ tag: "v1" });
        const app = createAppHandle(
            nav as unknown as NavigationHandle,
            session as unknown as SessionHandle,
        );
        void app.push("detail", { id: "1" });
        expect(nav.push).toHaveBeenCalledWith("detail", { id: "1" });
        app.save();
        expect(session.save).toHaveBeenCalledTimes(1);
        app.getSnapshot();
        expect(nav.getSnapshot).toHaveBeenCalled();
    });

    test("scope 是 getter,委托当前 session.scope(restore 重建后取到最新)", () => {
        const session = fakeSession({ tag: "v1" });
        const app = createAppHandle(undefined, session as unknown as SessionHandle);
        expect((app.scope as unknown as { tag: string }).tag).toBe("v1");
        session.__setScope({ tag: "v2" });
        expect((app.scope as unknown as { tag: string }).tag).toBe("v2");
    });

    test("只配 navigation → 无 session 成员;只配 session → 无 nav 成员", () => {
        const navOnly = createAppHandle(fakeNav() as unknown as NavigationHandle, undefined);
        expect(typeof navOnly.push).toBe("function");
        expect((navOnly as { save?: unknown }).save).toBeUndefined();
        const sessionOnly = createAppHandle(undefined, fakeSession({}) as unknown as SessionHandle);
        expect(typeof sessionOnly.save).toBe("function");
        expect((sessionOnly as { push?: unknown }).push).toBeUndefined();
    });
});
