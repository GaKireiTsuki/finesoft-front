/**
 * Session — 会话恢复的核心类型
 *
 * 会话恢复把「用户当时在干什么」（导航位置 + 应用注册的状态切片 + 导航作用域状态）
 * 序列化进一份可版本化、JSON 安全的快照，持久化到可插拔 `Storage`，并在全新加载时重水化。
 * 框架只搬运状态、不解释内容，也不参与 UI —— 应用据恢复出的状态自行重渲染。
 *
 * 两层作用域共同序列化进快照：
 * - **全局切片（`slices`）**：app-wide，键 = `provider.key`，生命周期 = 整个会话。
 * - **导航作用域状态（`scoped`）**：绑定到某个导航条目（`entryKey`），对标 SwiftUI `@State`
 *   的「位置作用域」语义 —— 条目离树即被 prune 丢弃（见 `scoped-state.ts`）。
 */

/** Asynchronous session persistence. A missing key resolves undefined; failures reject. */
export interface AsyncStorage {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}
export class StorageUnavailableError extends Error {
    constructor() {
        super("storage-unavailable");
        this.name = "StorageUnavailableError";
    }
}
export type SessionFailure =
    | { readonly status: "failed"; readonly cause: unknown }
    | { readonly status: "unavailable" }
    | { readonly status: "closed" };
export type SessionWriteResult = { readonly status: "saved" | "cleared" } | SessionFailure;
export type SessionLoadResult =
    | { readonly status: "loaded"; readonly snapshot: SessionSnapshot }
    | { readonly status: "missing" | "invalid" | "expired" }
    | SessionFailure;
export type SessionRestoreResult =
    | { readonly status: "restored" }
    | { readonly status: "partial"; readonly discarded: readonly string[] }
    | { readonly status: "skipped" }
    | Exclude<SessionLoadResult, { status: "loaded" }>;
export interface SessionSlice {
    readonly version: number;
    readonly data: unknown;
}

import type { SerializedNavigation } from "../navigation/index";

/** 会话快照在 Storage 中的默认键。 */
export const SESSION_DEFAULT_KEY = "__finesoft_session__";

/** 会话快照的默认版本号；解码时不匹配即整份丢弃。 */
export const SESSION_DEFAULT_VERSION = 2;

/**
 * 会话快照：用户「当时在干什么」的可序列化捕获。
 *
 * `navigation` 始终是结构化 `SerializedNavigation`；版本 2 不接受早期 URL-only 导航载荷。
 */
export interface SessionSnapshot {
    /** 快照版本；解码时与期望版本不符即丢弃。 */
    readonly version: number;
    /** 导航位置：统一为结构化导航树；缺省则不恢复导航。 */
    readonly navigation?: SerializedNavigation;
    /**
     * 该快照导航位置的可比 URL（捕获时刻与 history 同步的浏览器 URL），供恢复门控做精确匹配。
     *
     * 适配器在 `capture` 时记录浏览器 URL。缺省时恢复门控只在根入口放行。
     */
    readonly url?: string;
    /** 全局切片（app-wide）：`provider.key` → `{ version, data }`。 */
    readonly slices: Readonly<Record<string, unknown>>;
    /** 导航作用域状态：`entryKey` → 该导航条目的状态袋；条目离树即被 prune 丢弃。 */
    readonly scoped: Readonly<Record<string, unknown>>;
    /** 捕获时刻（epoch ms）；用于 `maxAgeMs` 过期判断。 */
    readonly capturedAt: number;
}

/**
 * 全局状态切片 Provider。
 *
 * capture 同步且 JSON 安全；decode 校验当前 schema，migration 按切片独立执行。应用控制捕获什么
 * （敏感字段在 `capture()` 中自行排除）。
 */
export interface SessionStateProvider<T = unknown> {
    /** 切片唯一键（快照里 `slices` 的 key）。 */
    readonly key: string;
    readonly version: number;
    /** Validate current-version data. Throw to discard this slice. */
    decode(data: unknown): T;
    /** Migrate old data; decoder always validates the result. */
    migrate?(data: unknown, fromVersion: number): unknown;
    /** 捕获当前切片状态，必须返回 JSON 安全的同步值。 */
    capture(): T;
    /** 用持久化的切片数据恢复（应用自行 setState / 填表单 / 滚动）。 */
    restore(data: T): void | Promise<void>;
}

/**
 * 导航作用域状态：`entryKey` → 状态袋；条目离树由框架 prune 丢弃（见 `scoped-state.ts`）。
 */
export interface NavigationScopedState {
    /** 读取某条目的状态袋（不存在返回 `undefined`，`unknown` 已含此情形）。 */
    get(entryKey: string): unknown;
    /** 写入某条目的状态袋。 */
    set(entryKey: string, data: unknown): void;
    /** 删除某条目的状态袋。 */
    delete(entryKey: string): void;
    /** 仅保留 `presentKeys` 中的键，丢弃其余（导航提交后由 bridge 调用）。 */
    prune(presentKeys: Iterable<string>): void;
    /** 当前持有状态的全部条目键。 */
    keys(): readonly string[];
}

/**
 * 导航适配器：SessionStore 与具体结构化导航控制器解耦的接缝。
 *
 * SessionStore 不直接依赖 `NavigationController`，core 不产生 nav → session 的反向耦合；
 * 所有页面形态通过同一结构化树恢复。
 */
export interface SessionNavigationAdapter {
    /** 捕获当前导航位置。 */
    capture(): SessionSnapshot["navigation"] | undefined;
    /** 应用恢复的导航位置。 */
    apply(navigation: SessionSnapshot["navigation"]): void | Promise<void>;
    /**
     * 可选：计算当前导航位置的可比 URL，写入 `SessionSnapshot.url` 供恢复门控精确匹配。
     *
     * 浏览器侧适配器返回当时的 `location`（pushState 后与导航树同步）；返回 `undefined`
     * 或不实现 = 快照不带 `url`，门控回退旧策略（见 `defaultShouldRestore`）。
     */
    captureUrl?(): string | undefined;
    /** 树中**存在**的全部条目身份键（用于 scoped prune；「存在」非「可见」）。 */
    presentKeys(): Iterable<string>;
}

/** 会话错误上下文：标记出错所处阶段，供 `onError` 上报。 */
export interface SessionErrorContext {
    readonly phase: "capture" | "restore" | "persist" | "load" | "clear";
    readonly code?:
        | "slice-failed"
        | "slice-incompatible"
        | "navigation-invalid"
        | "storage-failed"
        | "storage-unavailable";
    readonly key?: string;
}

/** `createSessionStore` 选项。 */
export interface SessionStoreOptions {
    /** 异步持久化存储（独立于同步环境 Storage）。 */
    readonly storage: AsyncStorage;
    /** 快照键；默认 `SESSION_DEFAULT_KEY`。 */
    readonly key?: string;
    /** 快照版本；默认 `SESSION_DEFAULT_VERSION`，不符即丢弃。 */
    readonly version?: number;
    /** 快照最大存活时长（ms）；省略 = 不过期。 */
    readonly maxAgeMs?: number;
    /** 导航适配器；省略 = 不恢复导航。 */
    readonly navigation?: SessionNavigationAdapter;
    /** 注入时钟（测试 / SSR 安全）；默认 `() => Date.now()`。 */
    readonly now?: () => number;
    /** 错误回调；默认 no-op，仅接收安全错误码与阶段/key，不接收私有异常。 */
    readonly onError?: (error: unknown, ctx: SessionErrorContext) => void;
}

/** 会话编排器：组装 / 落盘 / 读取 / 恢复快照，并持有导航作用域状态。 */
export interface SessionStore {
    /** 注册全局切片 provider；返回反注册函数。 */
    register<T>(provider: SessionStateProvider<T>): () => void;
    /** 导航作用域状态读写 + prune。 */
    readonly scope: NavigationScopedState;
    /** 同步复制 nav/slices/scoped 的 JSON 值，独立于可变来源；不冻结来源、不落盘。 */
    capture(): SessionSnapshot;
    /** 显式快照在调用时复制/编码；省略参数则在排队写入开始时捕获最新状态。 */
    persist(snapshot?: SessionSnapshot): Promise<SessionWriteResult>;
    /** 读取并校验，返回 loaded/missing/invalid/expired/failed/unavailable/closed。 */
    load(): Promise<SessionLoadResult>;
    /** 恢复：应用 nav + 回填 scoped + 派发各 slice 给对应 provider（省略则先 `load`）。 */
    restore(snapshot?: SessionSnapshot): Promise<SessionRestoreResult>;
    /** 清除持久化快照。 */
    clear(): Promise<SessionWriteResult>;
    /** 手动逃生口 = `capture` + `persist`。 */
    save(): Promise<SessionWriteResult>;
    /** Stop new work and await all registered operations. */
    dispose(): Promise<void>;
}

/** 会话错误：序列化 / 编排过程中需要显式标识的错误类型。 */
export class SessionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SessionError";
    }
}
