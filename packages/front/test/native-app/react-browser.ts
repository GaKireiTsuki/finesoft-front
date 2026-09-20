import { createBrowserApp } from "@finesoft/front/browser";
import { createRoot, hydrateRoot } from "react-dom/client";
import { createElement } from "react";
import ReactApp from "./ReactApp.tsx";
import { definition } from "./definition";
import type { BeforeLoadGuard } from "@finesoft/front/web";
const changes = new WeakMap<object, (type: string) => void>();
const guards = new WeakMap<object, { beforeLoad?: BeforeLoadGuard }>();
export const setType = (app: object, type: string) => changes.get(app)?.(type);
export const setGuard = (app: object, guard?: BeforeLoadGuard) => {
    const state = guards.get(app);
    if (state) state.beforeLoad = guard;
};
export async function mount(
    target: HTMLElement,
    key: string,
    locale = "en",
    label = "first",
    history: "memory" | "browser" = "memory",
    pageType = "probe",
) {
    const state: { pageType: string; beforeLoad?: BeforeLoadGuard } = { pageType };
    const handle = await createBrowserApp({
        definition: definition(
            locale,
            label,
            state,
            new URL(location.href).searchParams.has("structured"),
        ),
        url:
            new URL(location.href).searchParams.get("route") ??
            (new URL(location.href).searchParams.get("render") === "csr"
                ? "/csr"
                : new URL(location.href).searchParams.get("render") === "prerender"
                  ? "/static"
                  : "/"),
        target,
        history,
        persistenceKey: key,
        session: {},
        domRestore: true,
    });
    const root = handle.hydrate
        ? hydrateRoot(target, createElement(ReactApp, { app: handle }))
        : createRoot(target);
    if (!handle.hydrate) root.render(createElement(ReactApp, { app: handle }));
    const dispose = handle.dispose.bind(handle);
    Object.assign(handle, {
        dispose: async () => {
            try {
                await dispose();
            } finally {
                root.unmount();
            }
        },
    });
    await handle.ready;
    changes.set(handle, (type) => (state.pageType = type));
    guards.set(handle, state);
    return handle;
}
const a = await mount(document.getElementById("a")!, "native-a");
const b = await mount(document.getElementById("b")!, "native-b", "ar", "second");
Object.assign(globalThis, { apps: { a, b }, mount, setType, setGuard, ready: true });
