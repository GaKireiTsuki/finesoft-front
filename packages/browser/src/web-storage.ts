/**
 * Web Storage 适配器 —— 把浏览器的 `sessionStorage` / `localStorage` 接到 core 的
 * `Storage` 接口（字符串 KV）。
 *
 * 语义映射：`get` → `getItem`（缺失返回 `undefined` 而非 `null`）、`set` → `setItem`
 * （配额错吞掉，不打断导航）、`delete` → `removeItem`。
 *
 * 选定的 Web Storage **不可用**时（访问抛错 —— 如隐私模式下 `SecurityError`，或运行环境
 * 无 `window` / 该字段为 `undefined`）降级为安全 no-op：`get` 恒返回 `undefined`，
 * `set` / `delete` 静默。绝不向调用方抛错。
 */

import type { Storage } from "@finesoft/core";

/** Web Storage 类型：会话级（标签关闭即清）或本地级（跨会话持久）。 */
export type WebStorageKind = "session" | "local";

/** 永不抛错、永不持久的 no-op Storage —— 选定的 Web Storage 不可用时的降级实现。 */
const NOOP_STORAGE: Storage = {
    get(): undefined {
        return undefined;
    },
    set(): void {},
    delete(): void {},
};

/**
 * 解析选定的 Web Storage 实例；任何访问异常（不可用 / 无 `window`）都被吞掉，返回
 * `undefined`，由调用方降级为 no-op。
 */
function resolveWebStorage(kind: WebStorageKind): globalThis.Storage | undefined {
    try {
        const area = kind === "session" ? window.sessionStorage : window.localStorage;
        return area ?? undefined;
    } catch {
        return undefined;
    }
}

/**
 * 创建一个由浏览器 Web Storage 支撑的 core `Storage`。
 *
 * @param kind `"session"` → `sessionStorage`；`"local"` → `localStorage`。
 */
export function createWebStorage(kind: WebStorageKind): Storage {
    const area = resolveWebStorage(kind);
    if (area === undefined) return NOOP_STORAGE;

    return {
        get(key: string): string | undefined {
            return area.getItem(key) ?? undefined;
        },
        set(key: string, value: string): void {
            try {
                area.setItem(key, value);
            } catch {
                // 配额超限 / 写入被拒 —— 吞掉，会话恢复是尽力而为，不打断应用。
            }
        },
        delete(key: string): void {
            area.removeItem(key);
        },
    };
}
