import type { SessionStateProvider } from "@finesoft/front/web";
import type { NameStore } from "./App";
function createNameStore(): NameStore {
    let value = "";
    const listeners = new Set<() => void>();
    return {
        get: () => value,
        set: (v) => {
            value = v;
            listeners.forEach((l) => l());
        },
        subscribe: (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
    };
}

export function createInstance() {
    const nameStore = createNameStore();
    const profileProvider: SessionStateProvider = {
        key: "profile",
        version: 1,
        decode: (data) => {
            if (
                typeof data !== "object" ||
                data === null ||
                !("name" in data) ||
                typeof data.name !== "string"
            )
                throw Error("invalid-profile-state");
            return { name: data.name };
        },
        capture: () => ({ name: nameStore.get() }),
        restore: (data) => nameStore.set((data as { name?: string }).name ?? ""),
    };

    return { nameStore, profileProvider };
}
