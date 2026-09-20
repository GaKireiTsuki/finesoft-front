import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { runInNewContext } from "node:vm";
import { generateProxyCode, registerProxyRoutes, type ProxyRouteConfig } from "../src/proxy";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.PROXY_TOKEN;
    delete process.env.BASIC_TOKEN;
});

describe("proxy helpers", () => {
    test("follows same-origin redirects but refuses a hop leaving the configured origin", async () => {
        const app = makeApp();
        vi.spyOn(console, "error").mockImplementation(() => {});
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValueOnce(
                new Response(null, { status: 302, headers: { location: "/next" } }),
            )
            .mockResolvedValueOnce(new Response("ok"))
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 302,
                    headers: { location: "http://127.0.0.1/internal" },
                }),
            );
        vi.stubGlobal("fetch", fetch);
        registerProxyRoutes(app, [
            { prefix: "/api", target: "https://upstream.example", followRedirects: true },
        ]);
        const handler = app.all.mock.calls[0][1] as (
            ctx: ReturnType<typeof makeContext>,
        ) => Promise<unknown>;
        expect(
            await handler(makeContext("/api/start", "https://app.example/api/start")),
        ).toMatchObject({ status: 200, body: "ok" });
        expect(fetch.mock.calls[1][0]).toBe("https://upstream.example/next");
        expect(
            await handler(makeContext("/api/start", "https://app.example/api/start")),
        ).toMatchObject({ status: 502 });
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    test.each([undefined, "1"])(
        "cancels an oversized streaming response with length %s before draining it",
        async (length) => {
            const app = makeApp();
            let pulls = 0;
            const cancel = vi.fn();
            const body = new ReadableStream<Uint8Array>(
                {
                    pull(controller) {
                        pulls++;
                        controller.enqueue(new Uint8Array(1024 * 1024));
                        if (pulls === 100) controller.close();
                    },
                    cancel,
                },
                { highWaterMark: 0 },
            );
            vi.stubGlobal(
                "fetch",
                vi.fn(
                    async () =>
                        new Response(body, { headers: length ? { "content-length": length } : {} }),
                ),
            );
            registerProxyRoutes(app, [{ prefix: "/api", target: "https://upstream.example" }]);
            const handler = app.all.mock.calls[0][1] as (
                ctx: ReturnType<typeof makeContext>,
            ) => Promise<unknown>;
            expect(
                await handler(makeContext("/api/large", "https://app.example/api/large")),
            ).toEqual({ kind: "text", body: "Proxy response too large", status: 502 });
            expect(pulls).toBe(11);
            expect(cancel).toHaveBeenCalledTimes(1);
        },
    );
    test("validates proxy configuration and warns on plain HTTP targets", () => {
        const app = makeApp();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(() =>
            registerProxyRoutes(app as never, [
                { prefix: "api", target: "https://upstream.example" },
            ]),
        ).toThrow(/prefix must start with/);
        expect(() =>
            registerProxyRoutes(app as never, [
                { prefix: "/api", target: "ftp://upstream.example" },
            ]),
        ).toThrow(/target must start with/);

        registerProxyRoutes(app as never, [{ prefix: "/api", target: "http://upstream.example" }]);

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('target "http://upstream.example" uses plain HTTP'),
        );
        expect(app.all).toHaveBeenCalledWith("/api/*", expect.any(Function));
    });

    test("registers proxy handlers and forwards requests with query params, cache, and auth", async () => {
        process.env.PROXY_TOKEN = "secret";
        const app = makeApp();
        const fetchMock = vi.fn(
            async () =>
                new Response("proxied", {
                    status: 200,
                    headers: {
                        "Content-Type": "text/plain",
                        "Content-Length": "7",
                    },
                }),
        );
        vi.stubGlobal("fetch", fetchMock);

        registerProxyRoutes(app as never, [
            {
                prefix: "/api",
                target: "https://upstream.example",
                headers: { "X-App": "finesoft" },
                auth: { type: "bearer", envKey: "PROXY_TOKEN" },
                cache: "max-age=60",
                followRedirects: true,
            },
        ]);

        const handler = app.all.mock.calls[0][1] as (
            ctx: ReturnType<typeof makeContext>,
        ) => Promise<unknown>;
        const ctx = makeContext("/api/products", "https://app.example/api/products?page=2");

        await expect(handler(ctx)).resolves.toEqual({
            kind: "response",
            body: "proxied",
            status: 200,
            headers: {
                "Content-Type": "text/plain",
                "Cache-Control": "max-age=60",
            },
        });
        expect(fetchMock).toHaveBeenCalledWith("https://upstream.example/products?page=2", {
            headers: {
                "X-App": "finesoft",
                Authorization: "Bearer secret",
            },
            redirect: "manual",
        });
    });

    test("uses Basic auth headers and defaults content-type when the upstream omits it", async () => {
        process.env.BASIC_TOKEN = "encoded-secret";
        const app = makeApp();
        const fetchMock = vi.fn(
            async () => new Response(new TextEncoder().encode("proxied-basic"), { status: 201 }),
        );
        vi.stubGlobal("fetch", fetchMock);

        registerProxyRoutes(app as never, [
            {
                prefix: "/basic",
                target: "https://upstream.example",
                auth: { type: "basic", envKey: "BASIC_TOKEN" },
            },
        ]);

        const handler = app.all.mock.calls[0][1] as (
            ctx: ReturnType<typeof makeContext>,
        ) => Promise<unknown>;

        await expect(
            handler(makeContext("/basic/profile", "https://app.example/basic/profile")),
        ).resolves.toEqual({
            kind: "response",
            body: "proxied-basic",
            status: 201,
            headers: {
                "Content-Type": "application/json",
            },
        });
        expect(fetchMock).toHaveBeenCalledWith("https://upstream.example/profile", {
            headers: {
                Authorization: "Basic encoded-secret",
            },
            redirect: "manual",
        });
    });

    test("rejects invalid paths, oversized responses, and failed proxy requests", async () => {
        const app = makeApp();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const oversizedBody = "x".repeat(10 * 1024 * 1024 + 1);
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValueOnce(
                    new Response("ok", {
                        status: 200,
                        headers: {
                            "Content-Length": String(10 * 1024 * 1024 + 1),
                        },
                    }),
                )
                .mockResolvedValueOnce(new Response(oversizedBody, { status: 200 }))
                .mockRejectedValueOnce(new Error("network down")),
        );

        registerProxyRoutes(app as never, [
            {
                prefix: "/api",
                target: "https://upstream.example",
                auth: { type: "basic", envKey: "BASIC_TOKEN" },
                methods: ["get", "post"],
            },
        ]);

        expect(app.get).toHaveBeenCalledWith("/api/*", expect.any(Function));
        expect(app.post).toHaveBeenCalledWith("/api/*", expect.any(Function));

        const handler = app.get.mock.calls[0][1] as (
            ctx: ReturnType<typeof makeContext>,
        ) => Promise<unknown>;

        await expect(
            handler(makeContext("/api/%2Fsecret", "https://app.example/api/%2Fsecret")),
        ).resolves.toEqual({ kind: "text", body: "Invalid path", status: 400 });

        await expect(
            handler(makeContext("/api/%E0%A4%A", "https://app.example/api/%E0%A4%A")),
        ).resolves.toEqual({ kind: "text", body: "Invalid path", status: 400 });

        await expect(
            handler(makeContext("/api/large", "https://app.example/api/large")),
        ).resolves.toEqual({
            kind: "text",
            body: "Proxy response too large",
            status: 502,
        });

        await expect(
            handler(makeContext("/api/body-too-large", "https://app.example/api/body-too-large")),
        ).resolves.toEqual({
            kind: "text",
            body: "Proxy response too large",
            status: 502,
        });

        await expect(
            handler(makeContext("/api/fail", "https://app.example/api/fail")),
        ).resolves.toEqual({
            kind: "json",
            body: { error: "Proxy request failed" },
            status: 502,
        });

        expect(warn).toHaveBeenCalledWith('[Proxy /api] Auth env var "BASIC_TOKEN" is not set');
        expect(error).toHaveBeenCalledWith("[Proxy /api]", expect.any(Error));
    });

    test("preserves binary payloads byte-for-byte (regression: text() would corrupt)", async () => {
        const app = makeApp();
        // PNG signature + 一些非 UTF-8 字节
        const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
        const fetchMock = vi.fn(
            async () =>
                new Response(binary, {
                    status: 200,
                    headers: { "Content-Type": "image/png" },
                }),
        );
        vi.stubGlobal("fetch", fetchMock);

        registerProxyRoutes(app as never, [{ prefix: "/img", target: "https://upstream.example" }]);

        const handler = app.all.mock.calls[0][1] as (
            ctx: ReturnType<typeof makeContext>,
        ) => Promise<unknown>;
        const ctx = makeContext("/img/logo.png", "https://app.example/img/logo.png");

        // 自定义 newResponse 捕获原始 ArrayBuffer 用于精确字节比对
        let capturedBuffer: ArrayBuffer | undefined;
        ctx.newResponse = vi.fn((body: ArrayBuffer | string, status: number, headers) => {
            if (body instanceof ArrayBuffer) capturedBuffer = body;
            return { kind: "response", body, status, headers };
        }) as never;

        await handler(ctx);

        expect(capturedBuffer).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(capturedBuffer!)).toEqual(binary);
    });

    test("generates registration code and validates configs", () => {
        expect(generateProxyCode([])).toBe("");
        expect(() => generateProxyCode([{ prefix: "/api", target: "file:///tmp/unsafe" }])).toThrow(
            /target must start with/,
        );

        const code = generateProxyCode([
            {
                prefix: "/api",
                target: "https://upstream.example",
                methods: ["get"],
                headers: { "X-Quote": 'a"b\\c' },
                auth: { type: "basic", envKey: "BASIC_TOKEN" },
                cache: 'max-age=60, x="quoted"',
            },
        ]);

        expect(code).toContain("registerProxyRoutes(app,");
        expect(code).toContain('"X-Quote":"a\\\"b\\\\c"');
        expect(code).toContain('"cache":"max-age=60, x=\\\"quoted\\\""');
    });

    test("executes generated registration code with runtime proxy behavior in Node and edge-like hosts", async () => {
        process.env.PROXY_TOKEN = "node-secret";
        const app = makeApp();
        const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]);
        const fetchMock = vi.fn(
            async () =>
                new Response(binary, {
                    status: 201,
                    headers: { "Content-Type": "image/png" },
                }),
        );
        vi.stubGlobal("fetch", fetchMock);
        const config = {
            prefix: "/api",
            target: "https://upstream.example",
            methods: ["get"],
            headers: { "X-Quote": 'a"b\\c' },
            auth: { type: "bearer" as const, envKey: "PROXY_TOKEN" },
            cache: 'max-age=60, x="quoted"',
            followRedirects: true,
        } satisfies ProxyRouteConfig;

        executeGeneratedProxyCode(generateProxyCode([config]), app);
        const handler = app.get.mock.calls[0][1] as (
            ctx: ReturnType<typeof makeContext>,
        ) => Promise<unknown>;
        const context = makeContext("/api/logo.png", "https://app.example/api/logo.png?v=1");
        let captured: ArrayBuffer | undefined;
        context.newResponse = vi.fn((body: ArrayBuffer, status: number, headers) => {
            captured = body;
            return { kind: "response", body, status, headers };
        }) as never;

        await expect(handler(context)).resolves.toMatchObject({
            kind: "response",
            status: 201,
            headers: { "Content-Type": "image/png", "Cache-Control": config.cache },
        });
        expect(new Uint8Array(captured!)).toEqual(binary);
        expect(fetchMock).toHaveBeenCalledWith("https://upstream.example/logo.png?v=1", {
            headers: { "X-Quote": 'a"b\\c', Authorization: "Bearer node-secret" },
            redirect: "manual",
        });

        vi.stubGlobal("process", undefined);
        fetchMock.mockImplementation(
            async () =>
                new Response("edge", { status: 200, headers: { "Content-Type": "text/plain" } }),
        );
        await handler(makeContext("/api/edge", "https://app.example/api/edge"));
        expect(fetchMock.mock.calls.at(-1)).toEqual([
            "https://upstream.example/edge",
            {
                headers: { "X-Quote": 'a"b\\c' },
                redirect: "manual",
            },
        ]);

        fetchMock.mockResolvedValueOnce(
            new Response("ignored", {
                status: 200,
                headers: { "Content-Length": String(10 * 1024 * 1024 + 1) },
            }),
        );
        await expect(
            handler(makeContext("/api/large", "https://app.example/api/large")),
        ).resolves.toEqual({
            kind: "text",
            body: "Proxy response too large",
            status: 502,
        });

        fetchMock.mockResolvedValueOnce(
            new Response("x".repeat(10 * 1024 * 1024 + 1), { status: 200 }),
        );
        await expect(
            handler(makeContext("/api/body-too-large", "https://app.example/api/body-too-large")),
        ).resolves.toEqual({
            kind: "text",
            body: "Proxy response too large",
            status: 502,
        });

        fetchMock.mockRejectedValueOnce(new Error("edge failure"));
        await expect(
            handler(makeContext("/api/fail", "https://app.example/api/fail")),
        ).resolves.toEqual({
            kind: "json",
            body: { error: "Proxy request failed" },
            status: 502,
        });
    });
});

function executeGeneratedProxyCode(code: string, app: ReturnType<typeof makeApp>): void {
    // The adapter inserts this snippet after its public SSR import. Execute the exact generated
    // source with that import binding to verify it registers the shared runtime implementation.
    runInNewContext(code, { app, registerProxyRoutes });
}

function makeApp() {
    return {
        all: vi.fn(),
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        patch: vi.fn(),
    };
}

function makeContext(path: string, url: string) {
    return {
        req: {
            path,
            url,
        },
        text: vi.fn((body: string, status: number) => ({
            kind: "text",
            body,
            status,
        })),
        // proxy 现在用 arrayBuffer 转发以保留二进制完整性；
        // 测试把 ArrayBuffer 解码回字符串便于断言。
        newResponse: vi.fn(
            (body: string | ArrayBuffer, status: number, headers: Record<string, string>) => ({
                kind: "response",
                body: body instanceof ArrayBuffer ? new TextDecoder().decode(body) : body,
                status,
                headers,
            }),
        ),
        json: vi.fn((body: unknown, status: number) => ({
            kind: "json",
            body,
            status,
        })),
    };
}
