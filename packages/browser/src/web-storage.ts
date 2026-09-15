import { StorageUnavailableError, type AsyncStorage } from "@finesoft/web";
export type WebStorageKind = "session" | "local";
/** Rejections remain observable by the session owner; unavailable is never a successful no-op. */
export function createWebStorage(kind: WebStorageKind): AsyncStorage {
    function area(): globalThis.Storage {
        try {
            const storage = kind === "session" ? window.sessionStorage : window.localStorage;
            if (storage) return storage;
        } catch {
            /* classified below */
        }
        throw new StorageUnavailableError();
    }
    return {
        async get(key) {
            return area().getItem(key) ?? undefined;
        },
        async set(key, value) {
            area().setItem(key, value);
        },
        async delete(key) {
            area().removeItem(key);
        },
    };
}
