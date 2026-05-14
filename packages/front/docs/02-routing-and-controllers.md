# 2. Routing & controllers

The framework's routing layer maps URLs to **intents**, intents to **controllers**, and controllers produce **pages**. This chapter covers all three.

## The mental model

```
URL  ──Router.resolve()──▶  RouteMatch { intent, renderMode, guards }
                                │
                                ▼
                       IntentDispatcher.dispatch(intent)
                                │
                                ▼
                         Controller.execute()  →  Page
```

A route definition combines:

- A **path pattern** (`/products/:id`)
- An **intent id** (logical name for the operation; one intent can have multiple routes)
- A **controller instance** (where the page data is produced)
- An optional **render mode** (`ssr` / `csr` / `prerender`)
- Optional **guards** (`beforeLoad` / `afterLoad`)

## Defining routes

```ts
// src/bootstrap.ts
import { type Framework, defineRoutes } from "@finesoft/front";
import { HomeController } from "./lib/controllers/home";
import { ProductController } from "./lib/controllers/product";
import { authGuard } from "./lib/guards/auth";

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, [
        // Plain SSR route
        { path: "/", intentId: "home", controller: new HomeController() },

        // Dynamic segment
        { path: "/products/:id", intentId: "product", controller: new ProductController() },

        // CSR-only (server returns an empty shell)
        {
            path: "/dashboard",
            intentId: "dashboard",
            controller: new DashboardController(),
            renderMode: "csr",
        },

        // Statically prerendered at build time
        {
            path: "/about",
            intentId: "about",
            controller: new AboutController(),
            renderMode: "prerender",
        },

        // Protected route — reuses the home intent but gates with a guard
        {
            path: "/admin",
            intentId: "home",
            controller: new HomeController(),
            beforeLoad: [authGuard],
        },
    ]);
}
```

### Route options

| Field        | Type                             | Notes                                                                |
| ------------ | -------------------------------- | -------------------------------------------------------------------- |
| `path`       | `string`                         | Path pattern with `:param` placeholders. Trailing `/` is normalized. |
| `intentId`   | `string`                         | Logical operation name. Used to register the controller.             |
| `controller` | `BaseController<TParams, TPage>` | Optional if the intent is already registered.                        |
| `renderMode` | `"ssr" \| "csr" \| "prerender"`  | Default `"ssr"`. See [chapter 4](./04-rendering-and-hydration.md).   |
| `beforeLoad` | `BeforeLoadGuard[]`              | Run before the controller. See [chapter 3](./03-middleware.md).      |
| `afterLoad`  | `AfterLoadGuard[]`               | Run after the page is produced.                                      |

### Path patterns

- Static: `/about`
- Parameterized: `/products/:id`, `/users/:userId/posts/:postId`
- Trailing wildcard: `/files/*`
- Optional segment is **not** supported — write two routes instead.

Parameters are passed to `controller.execute(params, container)` as a string-keyed object.

## Writing a controller

```ts
// src/lib/controllers/product.ts
import { BaseController, type Container, type HttpClient } from "@finesoft/front";

interface ProductPage {
    kind: "product";
    id: string;
    name: string;
    price: number;
}

export class ProductController extends BaseController<{ id: string }, ProductPage> {
    readonly intentId = "product";

    async execute(params: { id: string }, container: Container): Promise<ProductPage> {
        const http = container.resolve<HttpClient>("http");
        const product = await http.get<{ name: string; price: number }>(
            `/api/products/${params.id}`,
        );
        return {
            kind: "product",
            id: params.id,
            name: product.name,
            price: product.price,
        };
    }

    fallback(params: { id: string }, _error: unknown): ProductPage {
        return { kind: "product", id: params.id, name: "Not available", price: 0 };
    }
}
```

### Controller contract

| Member     | Required | Purpose                                                                            |
| ---------- | -------- | ---------------------------------------------------------------------------------- |
| `intentId` | yes      | Must match the route's `intentId` (or the `IntentDispatcher.register` call).       |
| `execute`  | yes      | Produce the page. Receives parsed path params and the request-scoped DI container. |
| `fallback` | yes      | Return a degraded page when `execute()` throws. Must be synchronous and total.     |

`BaseController` wraps `execute()` in `try/catch` and routes any error through `fallback()`. The framework never throws out of `dispatch()` — your `fallback()` is the last line of defense.

### Why `fallback` is mandatory

A thrown error in `execute()` during SSR would otherwise crash the request and either 500 or render a blank document. `fallback()` lets you return a structured "error" `Page` that your view layer renders as a graceful failure (banner, retry button, etc.). See the [error handling section in observability](./08-observability.md#error-handling-via-fallback) for patterns.

## Render modes

| Mode          | Server returns                               | When to use                                              |
| ------------- | -------------------------------------------- | -------------------------------------------------------- |
| `"ssr"`       | Fully rendered HTML + serialized data        | Default. Best for SEO and TTFB-sensitive pages.          |
| `"csr"`       | Empty shell HTML; controller runs in browser | Authenticated dashboards, heavy-personalization pages.   |
| `"prerender"` | Static HTML built at deploy time             | Marketing, docs, blog. Combine with ISR (see chapter 4). |

The mode is **per-route**, so you can mix freely. The framework rebuilds prerendered routes at build time; SSR routes execute on every request.

## Registering controllers without routes

You can register a controller for an intent without exposing it as a route. This is useful for intents triggered only by `dispatchAction`:

```ts
framework.intentDispatcher.register("checkout", new CheckoutController());

// Elsewhere:
const page = await framework.intentDispatcher.dispatch({
    intentId: "checkout",
    params: { cartId },
});
```

Routes are simply intent dispatches keyed by URL.

## One intent, many routes

Same intent can serve different URLs:

```ts
defineRoutes(framework, [
    { path: "/", intentId: "home", controller: new HomeController() },
    { path: "/welcome", intentId: "home" }, // reuses the registered HomeController
    { path: "/landing/:slug", intentId: "home" }, // same intent, params differ
]);
```

This avoids duplicating controller instances when only the URL surface differs. Authenticated `/admin` reusing the `home` intent in the earlier example is the same pattern.

## Inspecting the resolved match

For diagnostics or custom routing, call `Router.resolve()` directly:

```ts
const match = framework.router.resolve("/products/42");
// {
//   intent: { intentId: "product", params: { id: "42" } },
//   action: { kind: "flow", url: "/products/42" },
//   renderMode: "ssr",
//   guards: { before: [...], after: [...] },
// }
```

`router.resolve()` returns `null` for unmatched URLs — handle this in your server-side 404 logic.

## Next

- [Middleware](./03-middleware.md) — gating navigation, redirects, denies
- [Rendering & hydration](./04-rendering-and-hydration.md) — what happens after the controller produces a page
