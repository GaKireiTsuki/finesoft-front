import { expect, test, vi } from "vite-plus/test";
vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));
vi.mock("@finesoft/web", async () => import("../../web/src/index.ts"));
import { BaseController, int, str } from "@finesoft/core";
import {
    definePage,
    defineWebApp,
    createWebRuntime,
    loadPage,
    markPublic,
    next,
    deny,
    redirect,
    rewrite,
    SERVER_CONTROLLER_PATH,
    ServerControllerProxy,
    type ControllerContext,
    type PageControllerInput,
} from "@finesoft/web";
import { BaseServerController, type ServerControllerInput } from "../../ssr/src/server-controller";
import { createSSRRender } from "../../ssr/src/create-render";
import { serializeServerData } from "../../ssr/src/server-data";
import { createSSRHandler } from "../src/ssr-handler";

const errorPage = (status: number, title: string) => ({
    id: String(status),
    pageType: "error",
    title,
});
const routes = [{ path: "/account/:id", params: { id: int() }, query: { q: str() } }] as const;
type Input = ServerControllerInput<{ id: number }, { q: string }>;
const seen: string[] = [];
class AccountController extends BaseServerController<
    Input,
    { id: string; pageType: string; title: string; privateValue: unknown }
> {
    async execute({ params, query, context }: Input) {
        expect(context.isServer).toBe(true);
        expect(context.path).toBe(`/account/${params.id}`);
        const previous = context.getCookie("session");
        const response = await context.fetch("/api/refresh", {
            method: "POST",
            headers: previous ? { cookie: `session=${previous}` } : {},
        });
        for (const cookie of response.headers.getSetCookie())
            context.responseHeaders.append("set-cookie", cookie);
        const session = await response.text();
        expect(session).toBe(`${previous}-fresh`);
        expect(context.getCookie("session")).toBe(previous);
        context.setCookie("seen", String(params.id), { httpOnly: true, secure: true });
        expect(context.getCookie("seen")).toBeUndefined();
        context.responseHeaders.set("x-account", String(params.id));
        return markPublic(
            {
                id: String(params.id),
                pageType: "account",
                title: `${session}:${query.q}`,
                privateValue: context.bindings.privateValue,
            },
            [],
        );
    }
}
function owner(renderModes?: Record<string, string>) {
    seen.length = 0;
    const page = definePage({ id: "account", routes, create: () => new AccountController() });
    const plain = definePage({
        id: "plain",
        routes: ["/plain"],
        handler: () => ({ id: "p", pageType: "plain", title: "plain" }),
    });
    const definition = defineWebApp({
        id: "server-test",
        pages: [page, plain],
        getErrorPage: errorPage,
        beforeLoad: [
            (context) =>
                context.getHeader("x-deny")
                    ? deny(403)
                    : context.getHeader("x-redirect")
                      ? redirect("/plain")
                      : context.query.q === "rewrite"
                        ? rewrite("/account/7?q=ready")
                        : next(),
        ],
        afterLoad: [
            (context) => {
                if (context.intent.id === "account")
                    expect(context.getCookie("session")).not.toContain("-fresh");
                return context.params.id === 7 ? rewrite("/account/7?q=public") : next();
            },
        ],
    });
    const render = createSSRRender({
        definition,
        render: (app) => app.getSnapshot().entries.at(-1)!.page.title,
    });
    const handler = createSSRHandler({
        render,
        serializeServerData,
        ownRenderers: true,
        renderModes,
        template: "<main><!--ssr-body--><!--ssr-data--></main>",
        fetch: async (request) => {
            const cookie = request.headers.get("cookie")!;
            seen.push(cookie);
            const session = /(?:^|; )session=([^;]+)/.exec(cookie)![1];
            return new Response(`${session}-fresh`, {
                headers: [
                    ["set-cookie", `session=${session}-fresh; HttpOnly; Path=/`],
                    ["set-cookie", "extra=1; Path=/"],
                ],
            });
        },
    });
    return { handler, render };
}
const remote = (
    url = "/account/42?q=hello",
    extra: Record<string, string> = {},
    body: Record<string, unknown> = {},
) =>
    new Request(`https://app.test${SERVER_CONTROLLER_PATH}`, {
        method: "POST",
        headers: {
            origin: "https://app.test",
            "content-type": "application/json",
            "x-finesoft-controller": "1",
            cookie: "session=alice",
            ...extra,
        },
        body: JSON.stringify({
            intent: "account",
            params: { id: 42 },
            query: { q: "hello" },
            url,
            ...body,
        }),
    });

test("CSR shells defer execution but still support remote server controllers", async () => {
    const { handler } = owner({ "/account/*": "csr" });
    try {
        const shell = await handler.fetch(new Request("https://app.test/account/42?q=hello"));
        expect(await shell.text()).not.toContain("alice-fresh");
        expect(seen).toEqual([]);
        const result = await handler.fetch(remote());
        expect((await result.json()).payload.pages[0].data.title).toBe("alice-fresh:hello");
        expect(result.headers.getSetCookie()).toHaveLength(3);
    } finally {
        await handler.dispose();
    }
});

test("application-selected cookie forwarding remains isolated through concurrent SSR responses", async () => {
    const { handler } = owner();
    try {
        const results = await Promise.all(
            ["alice", "bob"].map((session) =>
                handler.fetch(
                    new Request("https://app.test/account/42?q=hello", {
                        headers: { cookie: `session=${session}` },
                    }),
                    { privateValue: `${session}-private` },
                ),
            ),
        );
        for (const [index, response] of results.entries()) {
            const session = index ? "bob" : "alice";
            expect(response.headers.getSetCookie()).toEqual([
                `session=${session}-fresh; HttpOnly; Path=/`,
                "extra=1; Path=/",
                "seen=42; Path=/; HttpOnly; Secure",
            ]);
            expect(response.headers.get("x-account")).toBe("42");
            const html = await response.text();
            expect(html).toContain(`${session}-fresh:hello`);
            expect(html).not.toContain(`${session}-private`);
        }
        expect(seen.sort()).toEqual(["session=alice", "session=bob"]);
    } finally {
        await handler.dispose();
    }
});

test("browser proxy executes the server implementation, publishes only page data, and reruns guards", async () => {
    const { handler } = owner();
    const page = definePage({ id: "account", routes, create: () => new ServerControllerProxy() });
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = remote("/account/42?q=hello");
        return handler.fetch(new Request(request, { ...init, headers: request.headers }), {
            privateValue: "server-confidential",
        });
    });
    const web = createWebRuntime({
        definition: defineWebApp({ id: "client", pages: [page], getErrorPage: errorPage }),
        fetch,
    });
    try {
        const loaded = await loadPage({
            web,
            target: "/account/42?q=hello",
            createContext: ({ url, intent, execution }) => ({
                url,
                path: "/account/42",
                params: intent.params ?? {},
                query: intent.query ?? {},
                intent,
                isServer: false,
                container: execution.context.container,
                getCookie: () => undefined,
                getHeader: () => undefined,
            }),
        });
        expect(loaded).toMatchObject({ kind: "page", page: { title: "alice-fresh:hello" } });
        if (loaded.kind === "page") expect(loaded.page).not.toHaveProperty("privateValue");
        expect(fetch).toHaveBeenCalledTimes(1);
        for (const result of [
            { redirect: { url: "/plain", status: 302 } },
            { rejection: { status: 403, message: "Access denied" } },
        ]) {
            fetch.mockResolvedValueOnce(Response.json(result));
            const navigation = await loadPage({
                web,
                target: "/account/42?q=hello",
                createContext: ({ url, intent, execution }) => ({
                    url,
                    path: "/account/42",
                    intent,
                    params: intent.params ?? {},
                    query: intent.query ?? {},
                    container: execution.context.container,
                    isServer: false,
                    getCookie: () => undefined,
                    getHeader: () => undefined,
                }),
            });
            expect(navigation).toEqual(
                "redirect" in result
                    ? { kind: "redirect", ...result.redirect }
                    : { kind: "deny", ...result.rejection },
            );
        }
        fetch.mockImplementationOnce(async (_input, init) =>
            handler.fetch(new Request(remote(), { ...init, headers: remote().headers })),
        );
        const rewritten = await loadPage({
            web,
            target: "/account/42?q=rewrite",
            createContext: ({ url, intent, execution }) => ({
                url,
                path: "/account/42",
                intent,
                params: intent.params ?? {},
                query: intent.query ?? {},
                container: execution.context.container,
                isServer: false,
                getCookie: () => undefined,
                getHeader: () => undefined,
            }),
        });
        expect(rewritten).toMatchObject({
            kind: "page",
            target: { intent: "account", params: { id: 7 }, query: { q: "ready" } },
            rewriteUrl: "/account/7?q=public",
        });
        expect(
            await (await handler.fetch(remote(undefined, { "x-deny": "yes" }))).json(),
        ).toMatchObject({ rejection: { status: 403 } });
        expect(
            await (await handler.fetch(remote(undefined, { "x-redirect": "yes" }))).json(),
        ).toEqual({ redirect: { url: "/plain", status: 302 } });
        expect(await (await handler.fetch(remote("/account/not-an-int?q=x"))).json()).toMatchObject(
            { rejection: { status: 404 } },
        );
        expect(
            await (await handler.fetch(remote("/plain", {}, { intent: "plain" }))).json(),
        ).toMatchObject({ rejection: { status: 404 } });
    } finally {
        await web.dispose();
        await handler.dispose();
    }
});

test("remote calls reject cross-origin, oversized bodies, and forged context data", async () => {
    const { handler } = owner();
    try {
        expect(
            (await handler.fetch(remote(undefined, { origin: "https://attacker.test" }))).status,
        ).toBe(403);
        expect(
            (await handler.fetch(remote(undefined, { "sec-fetch-site": "cross-site" }))).status,
        ).toBe(403);
        expect((await handler.fetch(remote("//attacker.test/account/42"))).status).toBe(400);
        expect(
            (await handler.fetch(remote(undefined, {}, { padding: "x".repeat(65536) }))).status,
        ).toBe(400);
        const response = await handler.fetch(
            remote(
                undefined,
                {},
                { bindings: { privateValue: "forged" }, context: { identity: "admin" } },
            ),
        );
        expect(await response.text()).not.toContain("forged");
    } finally {
        await handler.dispose();
    }
});

test("shared controllers receive page metadata without server-only response capabilities", async () => {
    class Shared extends BaseController<
        PageControllerInput,
        { id: string; pageType: string; title: string }
    > {
        execute({ context }: PageControllerInput) {
            expect(context).toMatchObject({ url: "/shared", path: "/shared", isServer: false });
            expect(context).not.toHaveProperty("request");
            expect(context).not.toHaveProperty("responseHeaders");
            return { id: "shared", pageType: "shared", title: context.getCookie("theme")! };
        }
    }
    const definition = defineWebApp({
        id: "shared",
        pages: [definePage({ id: "shared", routes: ["/shared"], create: () => new Shared() })],
        getErrorPage: errorPage,
    });
    const web = createWebRuntime({ definition });
    try {
        const result = await loadPage({
            web,
            target: "/shared",
            createContext: ({ url, intent, execution }) => ({
                url,
                path: url,
                params: {},
                query: {},
                intent,
                isServer: false,
                container: execution.context.container,
                getCookie: () => "dark",
                getHeader: () => undefined,
            }),
        });
        expect(result).toMatchObject({ kind: "page", page: { title: "dark" } });
        const execution = web.createExecution();
        await expect(
            Promise.resolve().then(() =>
                new AccountController().perform({ id: 42 }, execution.context, { q: "" }),
            ),
        ).rejects.toThrow("server request");
        await execution.dispose();
    } finally {
        await web.dispose();
    }
});

// Public contexts expose only capabilities their owner actually supplies.
function contracts(shared: ControllerContext, server: Input["context"]) {
    server.request.headers.get("authorization");
    server.setCookie("a", "b");
    // @ts-expect-error shared controllers do not have a server request
    void shared.request;
    // @ts-expect-error shared controllers cannot mutate response cookies
    shared.setCookie("a", "b");
}
void contracts;
