import { afterEach, expect, test, vi } from "vite-plus/test";
import { defineWebApp } from "@finesoft/web";
import { createBrowserApp } from "../src/index";
import { routePages } from "../../web/test/helpers/definition";

afterEach(() => vi.unstubAllGlobals());

test("a native root acknowledges the first committed browser view", async () => {
    const attributes = new Map<string, string>();
    const win = {
        location: {
            pathname: "/",
            search: "",
            href: "https://app.test/",
            origin: "https://app.test",
            assign: vi.fn(),
        },
        navigator: { userAgent: "test", maxTouchPoints: 0 },
    };
    const document = { cookie: "", documentElement: { lang: "en" }, defaultView: win };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", document);
    const target = {
        ownerDocument: document,
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        contains: () => true,
        hasChildNodes: () => false,
    } as unknown as HTMLElement;
    const recorder = { record: vi.fn(), flush: vi.fn() };
    const definition = defineWebApp({
        id: "native-start",
        configuration: { eventRecorder: recorder },
        pages: routePages(
            [{ id: "home", handler: () => ({ id: "home", pageType: "home", title: "Home" }) }],
            [{ path: "/", intentId: "home" }],
        ),
        getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
    });

    const handle = await createBrowserApp({ definition, target, history: "memory" });
    const snapshot = handle.getSnapshot();
    expect(snapshot.entries).toHaveLength(1);
    expect(attributes.get("data-fs-app")).toBe("native-start");
    const pageViews = () => recorder.record.mock.calls.filter(([type]) => type === "PageView");
    expect(pageViews()).toHaveLength(0);
    handle.commit(snapshot.revision - 1);
    expect(pageViews()).toHaveLength(0);
    handle.commit(snapshot.revision);
    await handle.ready;
    expect(pageViews()).toHaveLength(1);
    handle.commit(snapshot.revision);
    expect(pageViews()).toHaveLength(1);
    await handle.dispose();
    expect(attributes.has("data-fs-app")).toBe(false);
});
