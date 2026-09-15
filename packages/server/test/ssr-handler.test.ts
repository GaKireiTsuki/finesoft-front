import { expect, test, vi } from "vite-plus/test";
import { createSSRHandler } from "../src/ssr-handler";
const template =
    "<html><head><!--ssr-head--></head><body><!--ssr-body--><!--ssr-extra--><!--ssr-data--></body></html>";
const base = { html: "hello", head: "title", css: "body{}", serverData: { public: true } };

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
    const response = await handler(new Request("https://example.com/"));
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(response.headers.get("content-location")).toBe("/internal");
    const html = await response.text();
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain("custom");
    const redirect = await handler(new Request("https://example.com/go"));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toBe("/login");
    const shell = await handler(new Request("https://example.com/shell/a"));
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
        handler(new Request(`https://example.com${path}`, { headers }));
    const first = await (await request()).text();
    expect(await (await request()).text()).toBe(first);
    await request("/", { cookie: "user=2" });
    await request("/", { authorization: "Bearer private" });
    await request("/cookie");
    await request("/cookie");
    await handler(new Request("https://other.com/"));
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
        await (await handler(new Request("https://example.com/"), { tenant: "t" })).text(),
    ).toContain("ok");
    const bad = createSSRHandler({
        template,
        serializeServerData: JSON.stringify,
        render: () => {
            throw new Error("private secret");
        },
    });
    const failure = await bad(new Request("https://example.com/"));
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
    await handler(new Request("https://example.com/"));
    expect((await handler(new Request("https://example.com/"), { denied: true })).status).toBe(403);
    personalized = true;
    const response = await handler(new Request("https://example.com/"));
    expect(response.headers.getSetCookie()).toEqual(["session=private"]);
    expect(await response.text()).toContain("personal");
});
