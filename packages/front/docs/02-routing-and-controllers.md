# Routes, controllers and typed pages

All six templates load pages with `BaseController`, which remains a public API. `definePage` connects a controller factory or a function handler to a Web application. Both forms share the runtime, execution scopes and policies.

## Responsibilities

| API                               | Responsibility                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `BaseController<TInput, TResult>` | Implement `execute`; inherited `perform` handles parameters, cancellation and `fallback`        |
| `definePage({ id, create })`      | Declare the page-loading factory and provide reusable `route`, `leaf` and `bindView` references |
| `defineWebApp`                    | Assemble page declarations, routes, guards and optional navigation structure                    |
| Native page component             | Receive `page` data, render UI and handle interactions                                          |

Import controllers, pages, routes and public-data declarations from `@finesoft/front`.

## Load a page with BaseController

`src/lib/controllers/product.ts`:

```ts
import { BaseController, DEP_KEYS } from "@finesoft/front";
import { markPublic, type BasePage } from "@finesoft/front";

export interface ProductPage extends BasePage {
    pageType: "product";
    product: { id: number; name: string };
}

export class ProductController extends BaseController {
    async execute({ params, context }): Promise<ProductPage> {
        const logger = await context.get(DEP_KEYS.LOGGER_FACTORY);
        logger.loggerFor("ProductController").info(`Loading product ${params.id}`);
        context.record("product.load", { productId: params.id });

        return markPublic(
            {
                id: String(params.id),
                pageType: "product",
                title: `Product ${params.id}`,
                product: { id: params.id, name: `Product ${params.id}` },
            },
            { product: { id: true, name: true } },
        );
    }

    override fallback({ params }): ProductPage {
        return markPublic(
            {
                id: String(params.id),
                pageType: "product",
                title: "Product unavailable",
                product: { id: params.id, name: "Unavailable" },
            },
            { product: { id: true, name: true } },
        );
    }
}
```

The framework maintains type imports, method annotations and base-class generics from the route declaration below; these are omitted in the initial source shown here. Run `vp dev`, `vp check` or the build to generate them. Types live in `.finesoft/controller-types.d.ts`, with no declaration block appended to the controller. See [automatic controller types](./11-navigation.md) for setup.

Both methods receive one object: `execute({ params, query, context })` and `fallback({ params, query, context, error })`. Destructure only the fields you need. Query remains separate from path parameters and is inferred from the route's `query` schemas.

This example uses local data; application controllers can call services from `execute`. `context` provides its `signal`, `fetch`, `get(token)` and `execute(operation, input)`. Pass `context.signal` to asynchronous request APIs so cancellation reaches the actual work.

`fallback` runs when `execute` throws an ordinary error and still returns `ProductPage`; this example chooses to display an unavailable state. The default implementation rethrows so page loading can handle the error. Cancellation, `AbortError` and `ExecutionError("cancelled")` propagate without entering `fallback`. Runtime policies execute outside the controller, so policy rejection also bypasses controller recovery.

## Register a factory, route and navigation target

`src/app-definition.ts`:

```ts
import { int } from "@finesoft/front";
import { definePage, defineWebApp } from "@finesoft/front";
import { ProductController } from "./lib/controllers/product";

export const product = definePage({
    id: "load-product",
    create: () => new ProductController(),
    routes: [{ path: "/products/:id", params: { id: int() } }],
});
export const target = product.leaf({ id: 42 });

export const app = defineWebApp({
    id: "example",
    pages: [product],
    getErrorPage: (status, message) => ({ id: String(status), pageType: "error", title: message }),
});
```

The page declaration owns the operation id; controllers do not repeat it. The URL `/products/42` is decoded by `int()`, so `execute` receives `params: { id: 42 }`. In application code, `product.leaf({ id: 42 })` retains the same parameter type.

`create` returns a new controller for each actual execution. Declaration, route discovery and reference helpers only read definitions; consuming a prefetched or retained page result also skips controller creation. Keep request identity in execution context or scoped providers, and page drafts in page instances.

`id` is operation identity, `pageType` selects a view, and each leaf receives a fresh EntryId. `product.bindView("product", ProductView)` checks literal result page types without inferring one from the operation id. Retain `ProductPage.pageType: "product"` to get this check; a widened `BasePage.pageType: string` cannot constrain view names.

Typed leaf parameters retain controller types. External URLs still require explicit codec decoding. Generics provide compile-time constraints, not runtime input validation, and cannot prove that an arbitrary codec matches business validation rules.

## Function handlers for simple pages

Use `handler` when a page only needs a direct data-loading function. It can also access dependencies, cancellation and nested operations through execution context. Handle any required recovery inside the function. Choose either `create` or `handler`.

```ts
import { definePage, markPublic } from "@finesoft/front";

export const home = definePage({
    id: "load-home",
    handler: () => markPublic({ id: "home", pageType: "home" as const, title: "Home" }, []),
});
```

Templates use controller classes for consistent organization; function handlers suit short loading logic. Existing function handlers receive `(params, context, query)`. Inheritance is optional: a `create` factory can also return an object implementing `perform(params, context, query)`.

## Controllers for independent business operations

The result generic of `BaseController` does not require a page. Bind a class to an operation with `implementController` to execute it in a standalone data runtime. HTTP and Worker hosts can also invoke that operation.

```ts
import {
    BaseController,
    createRuntime,
    defineApp,
    defineOperation,
    implementController,
    type ControllerInput,
} from "@finesoft/front";

type TotalInput = { unitPrice: number; quantity: number };
interface TotalResult {
    total: number;
}

class TotalController extends BaseController<ControllerInput<TotalInput>, TotalResult> {
    execute({ params }: ControllerInput<TotalInput>): TotalResult {
        return { total: params.unitPrice * params.quantity };
    }
}

const calculateTotal = defineOperation<TotalInput, TotalResult>({
    id: "calculate-total",
    kind: "query",
});
const runtime = createRuntime({
    app: defineApp({
        id: "data-example",
        operations: [calculateTotal],
        implementations: [implementController(calculateTotal, () => new TotalController())],
    }),
});

try {
    const result = await runtime.execute(calculateTotal, { unitPrice: 29, quantity: 2 });
    console.log(result); // { total: 58 }
} finally {
    await runtime.dispose();
}
```

The operation declaration defines the input/output contract; the controller supplies the implementation. Exposing the operation over HTTP still requires an explicit endpoint. Registering a controller does not publish an API.

<Ch02RouteResolver />

## Server controllers and request context

Use `BaseServerController` from `@finesoft/front` for pages requiring secrets, HttpOnly cookies, or response mutation. Keep `execute({ params, query, context })`, `fallback({ params, query, context, error })`, and the same `definePage({ create, routes })` registration. The type generator maintains the existing compact `Input` / `Failure` references and selects the context from the base class.

```ts
import { BaseServerController } from "@finesoft/front";
import { markPublic } from "@finesoft/front";
import { loadAccount } from "./account-service";

export class AccountController extends BaseServerController {
    async execute({ params, context }) {
        const account = await loadAccount(params.id, context.getCookie("session"));
        context.responseHeaders.set("Cache-Control", "private, no-store");
        return markPublic(
            { id: String(params.id), pageType: "account", title: account.name, account },
            { account: { id: true, name: true } },
        );
    }
}
```

Generated annotations are omitted above; `account-service` is application code. The controller may live in any directory. Vite replaces its entire module with browser references, while SSR executes the original implementation directly. Browser navigation uses same-origin `POST /__finesoft/controller`; the server revalidates routes and executes policies and guards. Hydration consumes existing SSR data without another call.

| Capability                                      | Shared page ControllerContext                    | ServerControllerContext                             |
| ----------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| `params`, `query`                               | Separate, route-inferred inputs                  | Same                                                |
| `url`, `path`, `intent`, `isServer`             | Current page and execution environment           | Same; `isServer: true`                              |
| `getCookie(name)`                               | Browser-readable cookies, or SSR request cookies | Original request cookies, including HttpOnly        |
| `getHeader(name)`                               | SSR request headers; unavailable in the browser  | Current request headers                             |
| DI, fetch, signal, operations, logging, tracing | Existing execution capabilities                  | Same                                                |
| `request`, `responseHeaders`                    | No dedicated interface                           | Original Request and outgoing Headers               |
| `setCookie`, `deleteCookie`                     | No dedicated interface                           | Write outgoing cookies; leave the request unchanged |

Generated page inputs use `ControllerContext` or `ServerControllerContext`. Portable data operations continue to use `ExecutionContext`. Direct page-operation execution without navigation has empty `url` / `path`. For remote loads, `request.url` names the transport endpoint; use `context.url` for the page address.

### Module isolation

A server controller module may export controller classes and types only. Its local runtime imports are also private to the server; importing these dependencies from client code fails. Use `import type` for shared contracts and separate modules for client implementations. Keep secret-dependent construction inside the protected module or server configuration, rather than arguments to the shared `create` factory.

The compiler recognizes module-scope class declarations, variable-bound and default class expressions, transparent parentheses/type assertions, local aliases, namespace imports and static re-exports. Unsupported factories or computed selections involving the raw server base fail the browser build instead of returning original source. Prefer a module-scope class when that diagnostic occurs. Pure re-export barrels and ordinary consumers of the generated controller references remain shared.

Client bundles and source maps omit the replaced implementation. The development plugin rejects raw controller assets and direct browser source requests for protected dependencies. It indexes modules once, caches ASTs, and reanalyzes changed files. Dependencies remain protected for the lifetime of a development server; restart when intentionally moving one back into shared code. Computed file paths, `public/` assets, and independently copied source are outside the static import boundary. Development servers still belong on trusted development networks.

Use the framework Vite plugin and a request host such as Node or Worker. Static-only hosting cannot run the remote endpoint. The endpoint loads registered server page controllers; it does not expose arbitrary methods or replace explicit login/registration command endpoints.

### Explicit request and response tools

The framework supplies `request`, `getHeader`, `getCookie`, `fetch`, `responseHeaders`, `setCookie` and `deleteCookie`. Applications own login state, authentication, token storage/refresh and the choice to forward credentials.

Server `context.fetch` uses only caller-supplied headers. It does not inherit Cookie/Authorization from the outer request or copy internal Set-Cookie values to the page response. The credentials option does not create a server-side cookie store. Requests made by the browser retain the browser's native same-origin cookie behavior.

For example, application code can choose to forward Authorization to a particular internal endpoint and copy that endpoint's cookies to the outgoing response:

```ts
const headers = new Headers();
const authorization = context.getHeader("authorization");
if (authorization) headers.set("authorization", authorization);

const response = await context.fetch("/api/account", { headers });
for (const cookie of response.headers.getSetCookie()) {
    context.responseHeaders.append("set-cookie", cookie);
}
```

The destination and header/cookie selection are application decisions. Reuse a business HttpClient interceptor or request-scoped provider through context.get when several controllers share the policy.

Applications can also construct outgoing cookies directly:

```ts
context.setCookie("theme", "dark", { path: "/", sameSite: "Lax" });
context.deleteCookie("theme", { path: "/" });
```

getCookie always reads the incoming request. Writing a response cookie does not change that request view or update identity. Later business logic uses its own result when it needs a new value. Explicit response headers are assembled into the final response, including error responses, with the framework retaining control of its error body content type and no-store policy.

Client-supplied context or bindings are never accepted as identity. markPublic continues to control data sent to the browser; secrets must also stay out of rendered HTML.
