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
- Optional **param codecs** (`params` / `query`) that validate and type the URL params
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

| Field        | Type                             | Notes                                                                    |
| ------------ | -------------------------------- | ------------------------------------------------------------------------ |
| `path`       | `string`                         | Path pattern with `:param` placeholders. Trailing `/` is normalized.     |
| `intentId`   | `string`                         | Logical operation name. Used to register the controller.                 |
| `controller` | `BaseController<TParams, TPage>` | Optional if the intent is already registered.                            |
| `params`     | codec map                        | Validate/convert **path** params. Keys must appear in `path`. See below. |
| `query`      | codec map                        | Validate/convert **query** params. Keys are open. See below.             |
| `renderMode` | `"ssr" \| "csr" \| "prerender"`  | Default `"ssr"`. See [chapter 4](./04-rendering-and-hydration.md).       |
| `beforeLoad` | `BeforeLoadGuard[]`              | Run before the controller. See [chapter 3](./03-middleware.md).          |
| `afterLoad`  | `AfterLoadGuard[]`               | Run after the page is produced.                                          |

### Path patterns

- Static: `/about`
- Parameterized: `/products/:id`, `/users/:userId/posts/:postId`
- Optional param: `/blog/:slug?` matches both `/blog` and `/blog/hello`.

By default, path and query params arrive in `controller.execute(params, container)` as a **string-keyed object**. Attach codecs (next section) to validate and convert them.

## Typed route params

Codecs turn raw string params into validated, converted, **compile-time-typed** values. Built-ins cover the common cases with zero dependencies; any [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, …) works too.

```ts
import { defineRoutes, int, list, oneOf, optional, str, withDefault } from "@finesoft/front";

defineRoutes(framework, [
    {
        path: "/products/:id",
        intentId: "product",
        controller: new ProductController(),
        params: { id: int({ min: 1 }) }, // :id validated as a positive integer, converted to number
        query: {
            page: withDefault(int({ min: 1 }), 1), // ?page= → number, defaults to 1 when absent
            sort: optional(oneOf(["asc", "desc"] as const)), // optional "asc" | "desc"
            tags: list(str()), // ?tags=a&tags=b → string[]
        },
    },
]);
```

### Built-in codecs

| Codec                   | Output        | Validates                                                   |
| ----------------------- | ------------- | ----------------------------------------------------------- |
| `str(opts?)`            | `string`      | `minLength` / `maxLength` / `pattern` (`RegExp`)            |
| `int(opts?)`            | `number`      | integer + `min` / `max`                                     |
| `num(opts?)`            | `number`      | finite number + `min` / `max`                               |
| `bool()`                | `boolean`     | `"true" \| "1" \| "false" \| "0"`                           |
| `oneOf([...] as const)` | literal union | membership                                                  |
| `uuid()`                | `string`      | UUID v1–v5                                                  |
| `list(item, opts?)`     | `T[]`         | multi-value query; each item via `item` + `min`/`max` count |

Modifiers wrap a codec (codecs stay plain serializable data — no chained `.optional()`):

- `optional(codec)` — missing input → `undefined`; renders the key as **optional** (`page?: T`).
- `withDefault(codec, fallback)` — missing input → `fallback`; key stays required.

### Validation = fall-through to 404

A failed codec means the route **doesn't match** — the router continues to the next route, falling through to your existing 404 if nothing else catches it. There is no separate `400` channel. This lets overlapping routes disambiguate by type:

```ts
defineRoutes(framework, [
    { path: "/item/:id", intentId: "item-by-id", controller, params: { id: int() } },
    { path: "/item/:slug", intentId: "item-by-slug", controller, params: { slug: str() } },
]);
// /item/42    → item-by-id   (int matches)
// /item/hello → item-by-slug (int rejects → falls through to str)
```

### Compile-time param types

`InferParams` / `InferQuery` derive the controller's param type straight from the codec objects — no hand-written generics to keep in sync:

```ts
import {
    BaseController,
    type InferParams,
    type InferQuery,
    int,
    oneOf,
    optional,
} from "@finesoft/front";

const params = { id: int() };
const query = { sort: optional(oneOf(["asc", "desc"] as const)) };

class ProductController extends BaseController<
    InferParams<typeof params> & InferQuery<typeof query>, // { id: number; sort?: "asc" | "desc" }
    ProductPage
> {
    readonly intentId = "product";
    execute(params) {
        // params.id: number, params.sort: "asc" | "desc" | undefined
    }
}
```

### `route()` — param-key safety

The plain array-object form already checks that every `params` key appears in the `path`. The `route(path, def)` helper gives the same check as a standalone, composable entry:

```ts
route("/products/:id", { intentId: "product", params: { id: int() } }); // ✓
route("/products/:id", { intentId: "product", params: { slug: str() } }); // ✗ compile error: "slug" is not in the path
```

### `defineRoute()` — auto-typed handlers

`defineRoute(path, def)` takes a **handler** function instead of a controller class, and infers its params type from the codecs automatically — no `InferParams` needed. It mirrors `BaseController`'s `try/catch → fallback`:

```ts
defineRoute("/products/:id", {
    intentId: "product",
    params: { id: int() },
    query: { page: withDefault(int(), 1) },
    handler: (params, container) => {
        // params: { id: number; page: number } — inferred from the codecs
        return loadProduct(params.id, params.page);
    },
    fallback: (params, error) => errorPage(error), // optional
});
```

Routes without `params` / `query` behave exactly as before — params stay strings, runtime is unchanged.

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

For diagnostics or custom routing, call `Router.resolve()` directly. It is **async** (codecs may validate asynchronously), so `await` it:

```ts
const match = await framework.router.resolve("/products/42");
// {
//   intent: { id: "product", params: { id: "42" } },
//   action: { kind: "flow", url: "/products/42" },
//   renderMode: "ssr",
//   beforeGuards: [...],
//   afterGuards: [...],
// }
```

`router.resolve()` resolves to `null` for unmatched URLs — handle this in your server-side 404 logic.

## Try it

A live `Router` instance is registered with the sample routes below. Type a URL on the left and watch `Router.resolve()` produce a `RouteMatch` on the right — the same code path the framework uses at runtime.

<Ch02RouteResolver />

## Next

- [Middleware](./03-middleware.md) — gating navigation, redirects, denies
- [Rendering & hydration](./04-rendering-and-hydration.md) — what happens after the controller produces a page
