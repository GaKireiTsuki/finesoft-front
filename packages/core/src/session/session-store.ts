/**
 * Session — 会话编排器（SessionStore）
 *
 * 组装 / 落盘 / 读取 / 恢复一份会话快照，并持有导航作用域状态（`scope`）。对外只暴露
 * `SessionStore` 接口，对内编排三方：导航适配器（`navigation`）、全局切片 provider、以及
 * 快照编解码（`snapshot.ts`）。
 *
 * - `capture()`：组装当前快照 —— `navigation?.capture()` + 遍历 providers 收 `slices`
 *   + 快照 `scope` 当前的 `scoped` map；不落盘。
 * - `persist()` / `save()`：编码后写入 `storage`。
 * - `load()`：从 `storage` 解码 + 校验 version / `maxAgeMs`；任一不符 → `undefined`。
 * - `restore()`：先 `navigation?.apply()`（可能异步），再回填 `scope`，再按 key 把 slice
 *   派回对应 provider。
 *
 * 错误隔离（spec §5）：单个 provider 的 `capture()` / `restore()` 抛错经 `onError` 上报并跳过，
 * 不中断整体；导航 `adapter.apply()` 的同步抛错与异步拒绝同样隔离（`onError` + 跳过 slice 回填），
 * 因 `decodeSnapshot` 只浅校验快照顶层、不校验 `navigation` 子字段，畸形 nav 不得冒泡崩 boot；
 * `persist` 的 Storage 配额 / 不可用错亦吞掉 + `onError`。`scope` 的 prune
 * 不在 store 内部自动触发 —— 由 bridge 在导航提交后用 `adapter.presentKeys()` 调（core 不订阅导航）。
 */

import { decodeSnapshot, encodeSnapshot } from "./snapshot";
import { createNavigationScopedState } from "./scoped-state";
import { SESSION_DEFAULT_KEY, SESSION_DEFAULT_VERSION } from "./types";
import type {
    NavigationScopedState,
    SessionErrorContext,
    SessionSnapshot,
    SessionStateProvider,
    SessionStore,
    SessionStoreOptions,
} from "./types";

/**
 * 创建会话编排器。
 *
 * `scope` 是一个 `createNavigationScopedState()` 实例，由 store 持有；`restore` 用快照
 * 的 `scoped` 重建其内容。时钟 `now` 注入（默认 `() => Date.now()`），`capturedAt` 由它产出。
 */
export function createSessionStore(options: SessionStoreOptions): SessionStore {
    const {
        storage,
        key = SESSION_DEFAULT_KEY,
        version = SESSION_DEFAULT_VERSION,
        maxAgeMs,
        navigation,
        now = () => Date.now(),
        onError,
    } = options;

    const providers = new Map<string, SessionStateProvider>();
    let scope: NavigationScopedState = createNavigationScopedState();

    function report(error: unknown, ctx: SessionErrorContext): void {
        onError?.(error, ctx);
    }

    function captureSlices(): Record<string, unknown> {
        const slices: Record<string, unknown> = {};
        for (const provider of providers.values()) {
            try {
                slices[provider.key] = provider.capture();
            } catch (error) {
                report(error, { phase: "capture", key: provider.key });
            }
        }
        return slices;
    }

    function scopedSnapshot(): Record<string, unknown> {
        const scoped: Record<string, unknown> = {};
        for (const entryKey of scope.keys()) {
            scoped[entryKey] = scope.get(entryKey);
        }
        return scoped;
    }

    function capture(): SessionSnapshot {
        return {
            version,
            navigation: navigation?.capture(),
            slices: captureSlices(),
            scoped: scopedSnapshot(),
            capturedAt: now(),
        };
    }

    function persist(snapshot: SessionSnapshot = capture()): void {
        try {
            storage.set(key, encodeSnapshot(snapshot));
        } catch (error) {
            report(error, { phase: "persist" });
        }
    }

    function load(): SessionSnapshot | undefined {
        let raw: string | undefined;
        try {
            raw = storage.get(key);
        } catch (error) {
            report(error, { phase: "load" });
            return undefined;
        }
        const snapshot = decodeSnapshot(raw, version);
        if (snapshot === undefined) return undefined;
        if (maxAgeMs !== undefined && now() - snapshot.capturedAt > maxAgeMs) {
            return undefined;
        }
        return snapshot;
    }

    function restoreSlices(slices: SessionSnapshot["slices"]): void {
        for (const provider of providers.values()) {
            const data = slices[provider.key];
            if (data === undefined) continue;
            try {
                provider.restore(data);
            } catch (error) {
                report(error, { phase: "restore", key: provider.key });
            }
        }
    }

    function restore(snapshot: SessionSnapshot | undefined = load()): void | Promise<void> {
        if (snapshot === undefined) return undefined;
        scope = createNavigationScopedState({ ...snapshot.scoped });

        // `decodeSnapshot` 只浅校验顶层形态，不校验 `navigation` 子字段；被篡改 / 跨版本写入的
        // 畸形 navigation 会让 adapter.apply（如 `deserializeNavigation` 抛 NavigationError）在此
        // 抛错或返回 rejected Promise。同步抛与异步拒绝都隔离（onError + 跳过 slice 回填），
        // 对齐 provider 隔离的安全默认 —— 旧态恢复失败绝不冒泡崩 startBrowserApp（spec §5/§3.3）。
        let applied: void | Promise<void>;
        try {
            applied = navigation?.apply(snapshot.navigation);
        } catch (error) {
            report(error, { phase: "restore" });
            return undefined;
        }
        if (applied instanceof Promise) {
            return applied.then(
                () => {
                    restoreSlices(snapshot.slices);
                },
                (error: unknown) => {
                    report(error, { phase: "restore" });
                },
            );
        }
        restoreSlices(snapshot.slices);
        return undefined;
    }

    return {
        register(provider: SessionStateProvider): () => void {
            providers.set(provider.key, provider);
            return () => {
                if (providers.get(provider.key) === provider) {
                    providers.delete(provider.key);
                }
            };
        },
        get scope(): NavigationScopedState {
            return scope;
        },
        capture,
        persist,
        load,
        restore,
        clear(): void {
            storage.delete(key);
        },
        save(): void {
            persist();
        },
    };
}
