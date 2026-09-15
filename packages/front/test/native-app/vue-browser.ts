import { startBrowserApp } from "@finesoft/front/browser";
import { createVueRenderer } from "@finesoft/front/renderers/vue/browser";
import Other from "./VueOther.vue";
import Probe from "./VueProbe.vue";
import { definition } from "./definition";
const mode = new URL(location.href).searchParams.get("mode") === "entries" ? "entries" : "root";
const renderer = createVueRenderer({ mode, views: { probe: Probe, other: Other } });
const changes = new WeakMap<object, (type: string) => void>();
export const setType = (app: object, type: string) => changes.get(app)?.(type);
export async function mount(
    target: HTMLElement,
    key: string,
    locale = "en",
    label = "first",
    history: "memory" | "browser" = "memory",
) {
    const state = { pageType: "probe" };
    const handle = await startBrowserApp({
        app: definition(
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
        renderer,
        target,
        history,
        persistenceKey: key,
        session: {},
        domRestore: true,
    });
    changes.set(handle, (type) => (state.pageType = type));
    return handle;
}
const a = await mount(document.getElementById("a")!, "native-a");
const b = await mount(document.getElementById("b")!, "native-b", "ar", "second");
Object.assign(globalThis, { apps: { a, b }, mount, setType, ready: true });
