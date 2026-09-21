import { expect, test, vi } from "vite-plus/test";
import { createSSRHandler } from "../src/ssr-handler";
const template =
    "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-extra--><!--ssr-data--></body></html>";
const base = { html: "hello", head: "title", css: "body{}", serverData: { public: true } };

test("SSR leaves internal credential and response header forwarding to application code", async () => {
    const requests: Request[] = [];
    const handler = createSSRHandler({
        template,
        serializeServerData: JSON.stringify,
        fetch: async (request) => {
            requests.push(request);
            return new Response("ok", {
                headers: [
                    ["set-cookie", "theme=dark; Path=/"],
                    ["set-cookie", "session=fresh; HttpOnly; Path=/"],
                ],
            });
        },
        render: async (url, context) => {
            const explicit = url === "/explicit";
            const headers = new Headers();
            if (explicit) headers.set("cookie", context!.request.headers.get("cookie")!);
            const response = await context!.fetch!("/api/data", { headers });
            await response.text();
            expect(context!.requestState!.responseHeaders.getSetCookie()).toEqual([]);
            expect(context!.requestState!.cookies.get("session")).toBe("original");
            if (explicit)
                context!.requestState!.responseHeaders.append(
                    "set-cookie",
                    response.headers.getSetCookie()[0]!,
                );
            return base;
        },
    });
    try {
        for (const path of ["/implicit", "/explicit"]) {
            const response = await handler.fetch(
                new Request("https://app.test" + path, {
                    headers: { cookie: "session=original", authorization: "Bearer original" },
                }),
            );
            expect(response.status).toBe(200);
            expect(response.headers.getSetCookie()).toEqual(
                path === "/explicit" ? ["theme=dark; Path=/"] : [],
            );
        }
        expect(requests[0]!.headers.has("cookie")).toBe(false);
        expect(requests[1]!.headers.get("cookie")).toBe("session=original");
        expect(requests.every((request) => !request.headers.has("authorization"))).toBe(true);
    } finally {
        await handler.dispose();
    }
});

test("explicit response headers survive a later renderer failure", async () => {
    const handler = createSSRHandler({
        template,
        serializeServerData: JSON.stringify,
        render: async (_url, context) => {
            context!.requestState!.responseHeaders.append(
                "set-cookie",
                "preference=compact; Path=/",
            );
            context!.requestState!.responseHeaders.append("set-cookie", "locale=en; Path=/");
            context!.requestState!.responseHeaders.set("x-request-tag", "example");
            throw new Error("private-renderer-detail");
        },
    });
    try {
        const response = await handler.fetch(new Request("https://app.test/account"));
        expect(response.status).toBe(500);
        expect(response.headers.getSetCookie()).toHaveLength(2);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-request-tag")).toBe("example");
        expect(await response.text()).toBe("Internal Server Error");
    } finally {
        await handler.dispose();
    }
});

test("portable SSR preserves status, cookies, redirect, slots, locale, rewrite and mode overrides", async () => {
    const render = vi.fn(async (url: string) => ({
        ...base,
        status: 403,
        headers: [
            ["set-cookie", "a=1"],
            ["set-cookie", "b=2"],
        ] as [string, string][],
        slots: { extra: "custom" },
        locale: { lang: "ar", dir: "rtl" },
        rewriteUrl: "/internal",
        ...(url === "/go" ? { redirect: { url: "/login", status: 307 } } : {}),
    }));
    const handler = createSSRHandler({
        template,
        render,
        serializeServerData: JSON.stringify,
        defaultLocale: "ar",
        renderModes: { "/shell/*": "csr" },
    });
    const response = await handler.fetch(new Request("https://example.com/"));
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(response.headers.get("content-location")).toBe("/internal");
    const html = await response.text();
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain("custom");
    const redirect = await handler.fetch(new Request("https://example.com/go"));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe("/login");
    const shell = await handler.fetch(new Request("https://example.com/shell/a"));
    expect(await shell.text()).toContain('lang="ar" dir="rtl"');
    expect(render).toHaveBeenCalledTimes(2);
});

test("caches only explicit public prerender results, isolates origins, bypasses authenticated requests and cookie results", async () => {
    let count = 0;
    const render = vi.fn(async (url: string) => ({
        ...base,
        html: String(++count),
        renderMode: "prerender",
        cache: "public" as const,
        ...(url === "/cookie" ? { headers: { "set-cookie": "session=secret" } } : {}),
    }));
    const handler = createSSRHandler({ template, render, serializeServerData: JSON.stringify });
    const request = (path = "/", headers?: HeadersInit) =>
        handler.fetch(new Request(`https://example.com${path}`, { headers }));
    const first = await (await request()).text();
    expect(await (await request()).text()).toBe(first);
    await request("/", { cookie: "user=2" });
    await request("/", { authorization: "Bearer private" });
    await request("/cookie");
    await request("/cookie");
    await handler.fetch(new Request("https://other.com/"));
    expect(count).toBe(7);
});

test("internal fetch carries per-request bindings, depth and cancellation and hides render failures", async () => {
    const fetch = vi.fn(async (request: Request, bindings?: Readonly<Record<string, unknown>>) => {
        expect(bindings?.tenant).toBe("t");
        expect(request.headers.get("x-ssr-depth")).toBe("1");
        expect(request.signal.aborted).toBe(false);
        return Response.json({ ok: true });
    });
    const handler = createSSRHandler({
        template,
        serializeServerData: JSON.stringify,
        fetch,
        render: async (_url, ctx) => ({ ...base, html: await (await ctx!.fetch!("/api")).text() }),
    });
    expect(
        await (await handler.fetch(new Request("https://example.com/"), { tenant: "t" })).text(),
    ).toContain("ok");
    const bad = createSSRHandler({
        template,
        serializeServerData: JSON.stringify,
        render: () => {
            throw new Error("private secret");
        },
    });
    const failure = await bad.fetch(new Request("https://example.com/"));
    expect(failure.status).toBe(500);
    expect(await failure.text()).toBe("Internal Server Error");
});

test("a warmed public cache cannot skip current request guards or replay into a personalized result", async () => {
    let personalized = false;
    const handler = createSSRHandler({
        template,
        serializeServerData: JSON.stringify,
        render: async (_url, ctx) => {
            if (ctx?.bindings.denied) return { ...base, status: 403 };
            if (personalized)
                return { ...base, html: "personal", headers: { "set-cookie": "session=private" } };
            return { ...base, renderMode: "prerender", cache: "public" };
        },
    });
    await handler.fetch(new Request("https://example.com/"));
    expect(
        (await handler.fetch(new Request("https://example.com/"), { denied: true })).status,
    ).toBe(403);
    personalized = true;
    const response = await handler.fetch(new Request("https://example.com/"));
    expect(response.headers.getSetCookie()).toEqual(["session=private"]);
    expect(await response.text()).toContain("personal");
});

test("per-request module selection retains each serializer and skips it on an HTML cache hit", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const serialized: string[] = [];
    const handler = createSSRHandler({
        template,
        loadModule: (request) => {
            const name = new URL(request.url).pathname;
            return {
                render: async () => {
                    if (name === "/first") await gate;
                    return { ...base, renderMode: "prerender", cache: "public" };
                },
                serializeServerData: (data) => {
                    serialized.push(name);
                    return JSON.stringify({ name, data });
                },
            };
        },
    });
    const first = handler.fetch(new Request("https://test/first"));
    const second = await handler.fetch(new Request("https://test/second"));
    release();
    expect(await (await first).text()).toContain('"name":"/first"');
    expect(await second.text()).toContain('"name":"/second"');
    await handler.fetch(new Request("https://test/second"));
    expect(serialized).toEqual(["/second", "/first"]);
});
