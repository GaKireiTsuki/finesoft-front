/**
 * Session barrel —— 会话恢复（快照模型 / codec / 导航作用域状态 / 编排器 / 导航适配器）
 */

// ===== Types =====
export {
    StorageUnavailableError,
    type AsyncStorage,
    type SessionSlice,
    type SessionFailure,
    type SessionWriteResult,
    type SessionLoadResult,
    type SessionRestoreResult,
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
} from "./types";

// ===== Snapshot（编解码）=====
export { decodeSnapshot, encodeSnapshot } from "./snapshot";

// ===== Scoped state（导航作用域状态）=====
export { collectLeafKeys, createNavigationScopedState } from "./scoped-state";

// ===== Store（会话编排器）=====
export { createSessionStore } from "./session-store";

// ===== Navigation adapter =====
export { createNavigationSessionAdapter } from "./navigation-adapter";
