import type { SessionStateProvider, NavigationSnapshot } from "@finesoft/front/web";
import type { BrowserAppHandle } from "@finesoft/front/browser";
import { reactive } from "vue";
export interface AppState {
    name: string;
    snapshot: NavigationSnapshot | null;
}
export type AppController = BrowserAppHandle;
export function createInstance() {
    const state = reactive<AppState>({ name: "", snapshot: null });
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
        capture: () => ({ name: state.name }),
        restore: (data) => {
            state.name = (data as { name?: string }).name ?? "";
        },
    };

    return { state, profileProvider };
}
