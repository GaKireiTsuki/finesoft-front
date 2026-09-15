import type { SessionStateProvider } from "@finesoft/front/web";

export interface NameStore {
    get(): string;
    set(value: string): void;
    subscribe(listener: () => void): () => void;
}

interface Profile {
    readonly name: string;
}

/** Called once per mount: no application state is shared between roots. */
export function createInstance() {
    let value = "";
    const listeners = new Set<() => void>();
    const nameStore: NameStore = {
        get: () => value,
        set: (v) => {
            value = v;
            listeners.forEach((l) => l());
        },
        subscribe: (l) => {
            listeners.add(l);
            return () => {
                listeners.delete(l);
            };
        },
    };
    const profileProvider: SessionStateProvider<Profile> = {
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
        restore: (data) => nameStore.set(data.name),
    };

    return { nameStore, profileProvider };
}
