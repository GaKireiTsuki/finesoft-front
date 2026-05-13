import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { generateProxyCode, registerProxyRoutes } from "../src/proxy";

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.PROXY_TOKEN;
    delete process.env.BASIC_TOKEN;
});

describe("proxy helpers", () => {
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
            redirect: "follow",
        });
    });

    test("uses Basic auth headers and defaults content-type when the upstream omits it", async () => {
        process.env.BASIC_TOKEN = "encoded-secret";
        const app = makeApp();
        const fetchMock = vi.fn(async () => ({
            status: 201,
            headers: {
                get: vi.fn(() => null),
            },
            arrayBuffer: vi.fn(async () => new TextEncoder().encode("proxied-basic").buffer),
        }));
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

    test("generates inline proxy code and validates configs", () => {
        expect(generateProxyCode([])).toBe("");
        expect(() => generateProxyCode([{ prefix: "/api", target: "file:///tmp/unsafe" }])).toThrow(
            /target must start with/,
        );

        const code = generateProxyCode([
            {
                prefix: "/api",
                target: "https://upstream.example",
                methods: ["get"],
                headers: { Accept: "application/json" },
                auth: { type: "basic", envKey: "BASIC_TOKEN" },
                cache: "max-age=60",
            },
        ]);

        expect(code).toContain('app.get("/api/*"');
        expect(code).toContain('const _headers = {"Accept":"application/json"}');
        expect(code).toContain('process.env["BASIC_TOKEN"]');
        expect(code).toContain('"Cache-Control"');
        expect(code).toContain('"manual"');
    });

    test("generated proxy code embeds the same response size limit as runtime (parity)", () => {
        const code = generateProxyCode([{ prefix: "/api", target: "https://upstream.example" }]);

        // 与 registerProxyRoutes 一致的 10MB 上限
        const MAX = String(10 * 1024 * 1024);

        // Content-Length fast-reject 路径
        expect(code).toMatch(/Content-Length/);
        expect(code).toContain(`parseInt(_cl, 10) > ${MAX}`);

        // 实际 body byteLength 拒绝路径
        expect(code).toContain(`_body.byteLength > ${MAX}`);

        // 两条路径都返回相同的 502 错误
        const matches = code.match(/"Proxy response too large"/g);
        expect(matches?.length).toBeGreaterThanOrEqual(2);
    });
});

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
