# Routes, controllers and typed pages

All six templates load pages with `BaseController`, which remains a public API. `definePage` connects a controller factory or a function handler to a Web application. Both forms share the runtime, execution scopes and policies.

## Responsibilities

| API                               | Responsibility                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `BaseController<TInput, TResult>` | Implement `execute`; inherited `perform` handles parameters, cancellation and `fallback`        |
| `definePage({ id, create })`      | Declare the page-loading factory and provide reusable `route`, `leaf` and `bindView` references |
| `defineWebApp`                    | Assemble page declarations, routes, guards and optional navigation structure                    |
| Native page component             | Receive `page` data, render UI and handle interactions                                          |

Import `BaseController` from `@finesoft/front`. Import pages, routes and public-data declarations from `@finesoft/front/web`.

## Load a page with BaseController

`src/lib/controllers/product.ts`:

```ts
import { BaseController, DEP_KEYS } from "@finesoft/front";
import { markPublic, type BasePage } from "@finesoft/front/web";

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
import { definePage, defineWebApp } from "@finesoft/front/web";
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
import { definePage, markPublic } from "@finesoft/front/web";

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
