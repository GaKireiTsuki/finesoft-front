# 工程实践：测试

框架为可测试性而设计。路由、Controller、中间件在服务端和浏览器都走同一个 dispatch 路径，所以一个测试同时检验两端。

## 测什么

| 对象           | 断言什么                                                                             | 层级 |
| -------------- | ------------------------------------------------------------------------------------ | ---- |
| Controller     | 给定 params + scope 化容器，产出的 page 正确。                                       | 单元 |
| 守卫           | 给定 `NavigationContext`，结果是 `next` / `redirect` / `rewrite` / `deny` 的预期值。 | 单元 |
| 路由           | URL → 预期的 intent + 渲染模式。                                                     | 单元 |
| 完整请求       | URL → 经完整管线产出的最终 HTML / 状态码。                                           | 集成 |
| Proxy / 服务器 | Hono 路由对合成请求返回正确的响应。                                                  | 集成 |

## Vitest 设置

仓库用 Vite+。总是从 `vite-plus/test` 导入：

```ts
import { describe, expect, test, vi, beforeEach, afterEach } from "vite-plus/test";
```

跑测试：

```bash
vp test                      # 全部
vp test path/to/file.test.ts # 一个文件
vp test -t "name match"      # 按测试名过滤
vp test --coverage           # 带覆盖率
```

## 测一个 Controller

```ts
// src/controllers/product.test.ts
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { Container } from "@finesoft/front";
import { ProductController } from "./product";

describe("ProductController", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("returns product page on success", async () => {
        const container = new Container();
        container.register("productApi", () => ({
            getById: vi.fn(async (id) => ({ name: "Widget", price: 9.99 })),
        }));

        const controller = new ProductController();
        const page = await controller.execute({ id: "42" }, container);

        expect(page).toEqual({
            kind: "product",
            id: "42",
            name: "Widget",
            price: 9.99,
        });
    });

    test("fallback returns degraded page on api failure", () => {
        const controller = new ProductController();
        const page = controller.fallback({ id: "42" }, new Error("network down"));

        expect(page).toMatchObject({
            kind: "product",
            id: "42",
            name: "Not available",
        });
    });
});
```

关键点：**每个测试建一个 `Container`，只注册 Controller 真正需要的。** 别拉一个真实的 `Framework` 进来 —— 那是在测框架而不是测你的 Controller。

## 测一个守卫

守卫接 `NavigationContext` 返回 `MiddlewareResult`。内联构造一个假 context：

```ts
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { Container } from "@finesoft/front";
import { authGuard } from "./auth";

function makeCtx(overrides: Partial<{ cookie: string | null }> = {}) {
    return {
        url: new URL("http://app.test/admin"),
        intent: { intentId: "admin", params: {} },
        container: new Container(),
        getCookie: vi.fn((name: string) => overrides.cookie ?? null),
        getHeader: vi.fn(() => null),
        isSsr: true,
    };
}

describe("authGuard", () => {
    test("redirects unauthenticated user to /login", () => {
        const ctx = makeCtx({ cookie: null });
        const result = authGuard(ctx);

        expect(result).toEqual({
            kind: "redirect",
            url: "/login?next=%2Fadmin",
            status: 302,
        });
    });

    test("passes through when token is present", () => {
        const ctx = makeCtx({ cookie: "valid-token" });
        const result = authGuard(ctx);

        expect(result).toEqual({ kind: "next" });
    });
});
```

工厂函数（`makeCtx`）是套路 —— 跟守卫放一起，把测试真正关心的位参数化。

## 测路由

断言 URL → intent 映射：

```ts
import { describe, expect, test } from "vite-plus/test";
import { Framework } from "@finesoft/front";
import { bootstrap } from "./bootstrap";

describe("routes", () => {
    test("resolves /products/42 to product intent", () => {
        const framework = Framework.create({});
        bootstrap(framework);

        const match = framework.router.resolve("/products/42");

        expect(match).toMatchObject({
            intent: { intentId: "product", params: { id: "42" } },
            renderMode: "ssr",
        });
    });

    test("returns null for unmatched URL", () => {
        const framework = Framework.create({});
        bootstrap(framework);

        expect(framework.router.resolve("/does-not-exist")).toBeNull();
    });
});
```

这能在重构时抓住路由回归 —— 一个改名的 intent 表现为失败的测试，而不是生产里的 404。

## 测完整请求管线

SSR 端到端测试，调 `createSSRRender`：

```ts
import { describe, expect, test } from "vite-plus/test";
import { createSSRRender } from "@finesoft/front";
import { bootstrap } from "./bootstrap";

describe("SSR pipeline", () => {
    test("renders home page with serialized data", async () => {
        const render = createSSRRender({
            bootstrap,
            getErrorPage: () => ({ kind: "error", title: "Error" }),
            async renderApp(page) {
                return {
                    html: `<main>${(page as any).title}</main>`,
                    head: "",
                    css: "",
                };
            },
        });

        const result = await render("/", {
            template: `<!doctype html><html><head><!--head--></head><body><!--ssr--></body></html>`,
        });

        expect(result.status).toBe(200);
        expect(result.html).toContain("<main>Welcome</main>");
        expect(result.html).toContain('id="__finesoft_data__"');
    });

    test("returns 302 when guard redirects", async () => {
        const render = createSSRRender({/* ... */});
        const result = await render("/admin");

        expect(result.status).toBe(302);
        expect(result.redirectUrl).toBe("/login?next=%2Fadmin");
    });
});
```

这是最高价值的测试层 —— 同时检验路由、中间件、Controller、渲染。

## Mock 网络

`HttpClient` 直接用 `fetch`。通过 `vi.stubGlobal` stub：

```ts
import { afterEach, beforeEach, test, vi, expect } from "vite-plus/test";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

test("UserApi.list parses JSON response", async () => {
    fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: "1", name: "Alice" }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }),
    );

    const api = new UserApi({ baseUrl: "/api" });
    const users = await api.list();

    expect(users).toEqual([{ id: "1", name: "Alice" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/users", expect.any(Object));
});
```

测试里 fetch 多时建个小注册表：

```ts
function setupFetch(routes: Record<string, () => Response>) {
    fetchMock.mockImplementation(async (url: string) => {
        const handler = routes[url];
        if (!handler) throw new Error(`Unexpected fetch: ${url}`);
        return handler();
    });
}

setupFetch({
    "/api/users": () => new Response(JSON.stringify(users), { status: 200 }),
    "/api/products": () => new Response(JSON.stringify(products), { status: 200 }),
});
```

让「测试预期 fetch 什么」一眼可读。

## 测试中 dispose scope

测试里创建了 scope，在 `afterEach` 里 dispose：

```ts
let scope: Container | null = null;

afterEach(() => {
    scope?.dispose();
    scope = null;
});

test("...", () => {
    scope = framework.container.createScope();
    scope.register("api", () => mockApi);
    // ...
});
```

Vitest 默认隔离测试，但 dispose 能暴露 scope 含 `destroy()` 资源（recorder 等）时的泄漏。

## 测带 `rewrite` 的中间件

`beforeLoad` 里的 rewrite 通过 router 递归。测试时同时断言 rewrite 信号和最终解析到的路由：

```ts
test("legacy URL rewrites to canonical", async () => {
    const render = createSSRRender({ bootstrap /* ... */ });
    const result = await render("/old/products/42");

    // 用户可见的 URL 不变
    expect(result.status).toBe(200);

    // 但渲染走的 Controller 是 /products/42 的 —— 通过渲染后 HTML 断言
    expect(result.html).toContain("Widget"); // product 42 的名字
});
```

`afterLoad` rewrite（canonicalization），断言 `Content-Location` 头：

```ts
const result = await render("/page?utm=x");
expect(result.headers["Content-Location"]).toBe("/page");
```

## 覆盖率目标

框架本身在 `core` 上瞄准 >95%，`server` 上 >85%。应用代码目标：

- **Controller**：100% `execute()` 主路径 + 至少一个 `fallback()` 测试。
- **守卫**：每个分支（通过 / redirect / deny）。
- **路由**：每个路由组至少一个 URL 解析断言。

视图组件不必追求 100% —— 那是测视图层，不是测框架。测 Controller 产出的 page 形状契约就够了。

## 速度

vite-plus 的 Vitest 很快 —— 单元 ~1ms 一个测试，集成 ~10ms。慢的话：

- 紧密循环里别建完整 `Framework`；直接建 `Container`。
- 单元测试里 mock 重的 `bootstrap()`。
- 等 `setTimeout`（重试、debounce）的测试用 `vi.useFakeTimers()`。

## 参考

- [测试 proxy](../09-server-and-deployment.md#proxy-路由) —— 框架自己的 proxy 测试 `packages/server/test/proxy.test.ts` 是好参考
