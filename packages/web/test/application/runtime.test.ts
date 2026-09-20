import { expect, test, vi } from "vite-plus/test";
import { DEP_KEYS, HostGuardError, createToken, defineApp, provide } from "@finesoft/core";
import { createWebRuntime, defineWebApp, loadPage, leaf, PrefetchedIntents } from "../../src";
const definition = () =>
    defineWebApp({
        id: "services",
        pages: [
            {
                id: "home",
                routes: ["/"],
                handler: () => ({ id: "actual", pageType: "home", title: "Home" }),
            },
        ],
        getErrorPage: (_status, title) => ({ id: "error", pageType: "error", title }),
    });
test("Web providers use one runtime and execution scope, with locale, translator and shared event recorder", async () => {
    const recorder = { record: vi.fn(), flush: vi.fn() };
    const web = createWebRuntime({
        definition: definition(),
        locale: "en-US",
        messages: { hello: "Hello" },
        eventRecorder: recorder,
        platform: {
            os: "macos",
            browser: "chrome",
            engine: "blink",
            isMobile: false,
            isTouch: false,
        },
        featureFlags: { local: true, greeting: "hello", retries: 3 },
    });
    const a = web.createExecution(),
        b = web.createExecution();
    expect(a.context.runtimeId).toBe(b.context.runtimeId);
    expect(a.context.container).not.toBe(b.context.container);
    expect(await a.context.get(DEP_KEYS.LOCALE)).toEqual({ lang: "en-US", dir: "ltr" });
    expect((await a.context.get(DEP_KEYS.TRANSLATOR)).t("hello")).toBe("Hello");
    expect(await a.context.get(DEP_KEYS.PLATFORM)).toMatchObject({ os: "macos" });
    const flags = await a.context.get(DEP_KEYS.FEATURE_FLAGS);
    expect(flags.isEnabled("local")).toBe(true);
    expect(flags.getString("greeting")).toBe("hello");
    expect(flags.getNumber("retries")).toBe(3);
    const storage = await a.context.get(DEP_KEYS.STORAGE);
    storage.set("key", "value");
    expect((await b.context.get(DEP_KEYS.STORAGE)).get("key")).toBe("value");
    (await a.context.get(DEP_KEYS.EVENT_RECORDER)).record("PageView", { pageId: "home" });
    expect(recorder.record).toHaveBeenCalledWith(
        "PageView",
        expect.objectContaining({ pageId: "home" }),
    );
    await web.dispose();
    expect(() => web.createExecution()).toThrow(/closed/);
});
test("hydrated entry executes policies before using one-shot page data", async () => {
    const cached = { id: "cached", pageType: "home", title: "Cached" };
    const web = createWebRuntime({
        definition: definition(),
        prefetchedIntents: PrefetchedIntents.fromArray([
            { entryId: "entry", intent: { id: "home", params: {} }, data: cached },
        ]),
    });
    expect(await loadPage({ web, target: leaf("home", {}, { entryId: "entry" }) })).toMatchObject({
        kind: "page",
        page: cached,
    });
    expect(await loadPage({ web, target: leaf("home", {}, { entryId: "entry" }) })).toMatchObject({
        kind: "page",
        page: { id: "actual" },
    });
    await web.dispose();
});
test("typed provider overrides and request fetch stay scoped without string registrations", async () => {
    const token = createToken<string>("request-name");
    const app = defineWebApp({
        ...definition(),
        app: defineApp({
            id: "providers",
            providers: [
                provide({ token, lifetime: "scope", create: (ctx) => String(ctx.bindings.name) }),
                provide({
                    token: DEP_KEYS.STORAGE,
                    lifetime: "runtime",
                    create: () => ({ get: () => "custom", set() {}, delete() {} }),
                }),
            ],
        }),
    });
    const web = createWebRuntime({ definition: app });
    const a = web.createExecution({
        bindings: { name: "a" },
        fetch: async () => new Response("a"),
    });
    const b = web.createExecution({
        bindings: { name: "b" },
        fetch: async () => new Response("b"),
    });
    expect(await a.context.get(token)).toBe("a");
    expect(await b.context.get(token)).toBe("b");
    expect(
        await (await a.context.get(DEP_KEYS.FETCH))("https://example.com").then((r) => r.text()),
    ).toBe("a");
    expect((await b.context.get(DEP_KEYS.STORAGE)).get("x")).toBe("custom");
    await web.dispose();
});
test("safe fetch keeps its configured host resolver and blocks private destinations", async () => {
    const fetch = vi.fn(async () => new Response("ok"));
    const web = createWebRuntime({
        definition: definition(),
        fetch,
        safeFetch: { lookup: async () => ["127.0.0.1"] },
    });
    const execution = web.createExecution();
    const safe = await execution.context.get(DEP_KEYS.SAFE_FETCH);
    await expect(safe("https://example.com")).rejects.toBeInstanceOf(HostGuardError);
    expect(fetch).not.toHaveBeenCalled();
    await web.dispose();
});

test("unused optional service factories are not executed while preparing an ordinary page", async () => {
    const create = vi.fn(() => {
        throw Error("optional service must stay lazy");
    });
    const web = createWebRuntime({
        definition: defineWebApp({
            ...definition(),
            app: defineApp({
                id: "lazy",
                providers: [
                    provide({ token: DEP_KEYS.TRANSLATOR, lifetime: "scope", create }),
                    provide({ token: DEP_KEYS.PLATFORM, lifetime: "runtime", create }),
                    provide({ token: DEP_KEYS.FEATURE_FLAGS, lifetime: "runtime", create }),
                ],
            }),
        }),
    });
    await loadPage({ web, target: "/" });
    expect(create).not.toHaveBeenCalled();
    await web.dispose();
});
