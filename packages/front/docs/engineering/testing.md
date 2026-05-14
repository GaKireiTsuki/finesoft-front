# Engineering: testing

The framework is built to be tested. Routes, controllers, and middleware all run through the same dispatch path on server and browser, so a single test exercises both worlds.

## What to test

| Subject        | What to assert                                                                                   | Layer       |
| -------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| Controllers    | Given params + scoped container, the page produced is correct.                                   | unit        |
| Guards         | Given a `NavigationContext`, the result is `next` / `redirect` / `rewrite` / `deny` as expected. | unit        |
| Routes         | URL → expected intent + render mode.                                                             | unit        |
| Full request   | URL → final HTML / status code through the full pipeline.                                        | integration |
| Proxy / server | Hono routes return the right responses for synthetic requests.                                   | integration |

## Vitest setup

The repo uses Vite+. Always import from `vite-plus/test`:

```ts
import { describe, expect, test, vi, beforeEach, afterEach } from "vite-plus/test";
```

Run tests with:

```bash
vp test                     # all
vp test path/to/file.test.ts # one file
vp test -t "name match"     # filter by test name
vp test --coverage          # with coverage
```

## Testing a controller

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

Key idea: **build a `Container` per test, register only what the controller needs.** Don't pull in a real `Framework` — you'd be testing the framework, not your controller.

## Testing a guard

Guards take a `NavigationContext` and return a `MiddlewareResult`. Build a fake context inline:

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

The factory function (`makeCtx`) is the pattern — keep it co-located with the guard, parameterize the bits the test actually cares about.

## Testing routes

To assert URL → intent mapping:

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

This catches route regressions during refactors — a renamed intent shows up as a failing test, not a 404 in production.

## Testing the full request pipeline

For SSR end-to-end tests, exercise `createSSRRender`:

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
        const render = createSSRRender({
            /* ... */
        });
        const result = await render("/admin");

        expect(result.status).toBe(302);
        expect(result.redirectUrl).toBe("/login?next=%2Fadmin");
    });
});
```

This is the highest-value test layer — it exercises routing, middleware, controllers, and rendering together.

## Mocking the network

`HttpClient` uses `fetch` directly. Stub it via `vi.stubGlobal`:

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

For tests with many fetches, build a small registry:

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

This makes "what does my test expect to be fetched" readable at a glance.

## Disposing scopes in tests

If your test creates a scope, dispose it in `afterEach`:

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

Vitest isolates tests by default, but disposing exposes leaks if the scope had `destroy()`-able resources (recorders, etc.).

## Testing middleware with `rewrite`

`rewrite` in `beforeLoad` recurses through the router. Test both the rewrite signal and the resolved final route:

```ts
test("legacy URL rewrites to canonical", async () => {
    const render = createSSRRender({ bootstrap /* ... */ });
    const result = await render("/old/products/42");

    // The user-visible URL stays unchanged
    expect(result.status).toBe(200);

    // But the rendered controller was for /products/42 — assert via the rendered HTML
    expect(result.html).toContain("Widget"); // product 42's name
});
```

For `afterLoad` rewrites (canonicalization), assert the `Content-Location` header:

```ts
const result = await render("/page?utm=x");
expect(result.headers["Content-Location"]).toBe("/page");
```

## Coverage targets

The framework itself targets >95% on `core` and >85% on `server`. For application code, aim for:

- **Controllers**: 100% of `execute()` happy paths + at least one `fallback()` test.
- **Guards**: every branch (pass / redirect / deny).
- **Routes**: at least one assertion per route group that the URLs resolve as expected.

Don't chase 100% on view components — those test the view layer, not the framework. Test the page-shape contracts the controllers produce instead.

## Speed

Vitest with vite-plus is fast — ~1ms per test for unit, ~10ms for integration. If you see slower:

- Avoid creating a full `Framework` in tight loops; build a `Container` directly.
- Mock heavy `bootstrap()` calls in unit tests.
- Use `vi.useFakeTimers()` for tests that wait on `setTimeout` (retry logic, debouncing).

## See also

- [Testing the proxy](../09-server-and-deployment.md#proxy-routes) — the framework's own tests at `packages/server/test/proxy.test.ts` are good references
