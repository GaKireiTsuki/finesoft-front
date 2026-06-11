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

import type { Storage } from "../dependencies/make-dependencies";
import type { SerializedNavigation } from "../navigation";

/** 会话快照在 Storage 中的默认键。 */
export const SESSION_DEFAULT_KEY = "__finesoft_session__";

/** 会话快照的默认版本号；解码时不匹配即整份丢弃。 */
export const SESSION_DEFAULT_VERSION = 1;

/** 扁平单页的导航位置：一个 URL（区别于结构化树的 `SerializedNavigation`）。 */
export interface SessionUrlLocation {
    readonly url: string;
}

/**
 * 会话快照：用户「当时在干什么」的可序列化捕获。
 *
 * `navigation` 用一个轻判别区分两种导航形态：`SerializedNavigation` 自带 `kind`
 * （leaf/stack/tabs/split），`SessionUrlLocation` 用独有的 `url` 字段（见 `isUrlLocation`）。
 */
export interface SessionSnapshot {
    /** 快照版本；解码时与期望版本不符即丢弃。 */
    readonly version: number;
    /** 导航位置：结构化 → `SerializedNavigation`；扁平 → `SessionUrlLocation`；缺省 → 不恢复导航。 */
    readonly navigation?: SerializedNavigation | SessionUrlLocation;
    /** 全局切片（app-wide）：`provider.key` → 该 provider `capture()` 的 JSON 值。 */
    readonly slices: Readonly<Record<string, unknown>>;
    /** 导航作用域状态：`entryKey` → 该导航条目的状态袋；条目离树即被 prune 丢弃。 */
    readonly scoped: Readonly<Record<string, unknown>>;
    /** 捕获时刻（epoch ms）；用于 `maxAgeMs` 过期判断。 */
    readonly capturedAt: number;
}

/**
 * 判别 `navigation` 是否为扁平 URL 位置。
 *
 * `SerializedNavigation` 始终带 `kind`、从不带 `url` 字段，故 `url` 是无歧义判别位。
 */
export function isUrlLocation(nav: SessionSnapshot["navigation"]): nav is SessionUrlLocation {
    return (
        nav != null &&
        typeof nav === "object" &&
        "url" in nav &&
        typeof (nav as SessionUrlLocation).url === "string"
    );
}

/**
 * 全局状态切片 Provider。
 *
 * 同步、JSON 安全。框架不解释切片内容 —— 它只搬运。应用控制捕获什么
 * （敏感字段在 `capture()` 中自行排除）。
 */
export interface SessionStateProvider<T = unknown> {
    /** 切片唯一键（快照里 `slices` 的 key）。 */
    readonly key: string;
    /** 捕获当前切片状态，必须返回 JSON 安全的同步值。 */
    capture(): T;
    /** 用持久化的切片数据恢复（应用自行 setState / 填表单 / 滚动）。 */
    restore(data: T): void;
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
 * 导航适配器：SessionStore 与具体导航机制（结构化 controller / 扁平 URL）解耦的接缝。
 *
 * SessionStore 不直接依赖 `NavigationController`，core 不产生 nav → session 的反向耦合；
 * 扁平与结构化导航经此同一套机制覆盖（见 `navigation-adapter.ts`）。
 */
export interface SessionNavigationAdapter {
    /** 捕获当前导航位置。 */
    capture(): SessionSnapshot["navigation"] | undefined;
    /** 应用恢复的导航位置。 */
    apply(navigation: SessionSnapshot["navigation"]): void | Promise<void>;
    /** 树中**存在**的全部条目身份键（用于 scoped prune；「存在」非「可见」）。 */
    presentKeys(): Iterable<string>;
}

/** 会话错误上下文：标记出错所处阶段，供 `onError` 上报。 */
export interface SessionErrorContext {
    readonly phase: "capture" | "restore" | "persist" | "load";
    readonly key?: string;
}

/** `createSessionStore` 选项。 */
export interface SessionStoreOptions {
    /** 持久化存储（`DEP_KEYS.STORAGE`）。 */
    readonly storage: Storage;
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
    /** 错误回调；默认 no-op，应用可接 EventRecorder。 */
    readonly onError?: (error: unknown, ctx: SessionErrorContext) => void;
}

/** 会话编排器：组装 / 落盘 / 读取 / 恢复快照，并持有导航作用域状态。 */
export interface SessionStore {
    /** 注册全局切片 provider；返回反注册函数。 */
    register(provider: SessionStateProvider): () => void;
    /** 导航作用域状态读写 + prune。 */
    readonly scope: NavigationScopedState;
    /** 组装当前快照（nav + slices + scoped），不落盘。 */
    capture(): SessionSnapshot;
    /** 落盘（省略参数则先 `capture`）。 */
    persist(snapshot?: SessionSnapshot): void;
    /** 从 Storage 读取并校验（version / maxAge / 畸形 → `undefined`）。 */
    load(): SessionSnapshot | undefined;
    /** 恢复：应用 nav + 回填 scoped + 派发各 slice 给对应 provider（省略则先 `load`）。 */
    restore(snapshot?: SessionSnapshot): void | Promise<void>;
    /** 清除持久化快照。 */
    clear(): void;
    /** 手动逃生口 = `capture` + `persist`。 */
    save(): void;
}

/** 会话错误：序列化 / 编排过程中需要显式标识的错误类型。 */
export class SessionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SessionError";
    }
}
