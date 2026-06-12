/**
 * Session barrel —— 会话恢复（快照模型 / codec / 导航作用域状态 / 编排器 / 导航适配器）
 */

// ===== Types =====
export {
    isUrlLocation,
    SESSION_DEFAULT_KEY,
    SESSION_DEFAULT_VERSION,
    SessionError,
    type NavigationScopedState,
    type SessionErrorContext,
    type SessionNavigationAdapter,
    type SessionSnapshot,
    type SessionStateProvider,
    type SessionStore,
    type SessionStoreOptions,
    type SessionUrlLocation,
} from "./types";

// ===== Snapshot（编解码）=====
export { decodeSnapshot, encodeSnapshot } from "./snapshot";

// ===== Scoped state（导航作用域状态）=====
export { collectLeafKeys, createNavigationScopedState, sessionEntryKey } from "./scoped-state";

// ===== Store（会话编排器）=====
export { createSessionStore } from "./session-store";

// ===== Navigation adapters（结构化 + 扁平）=====
export {
    createNavigationSessionAdapter,
    createUrlSessionAdapter,
    type UrlAdapterOptions,
} from "./navigation-adapter";
