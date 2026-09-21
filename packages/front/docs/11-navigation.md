# Structured navigation

Tabs, Stack and Split are immutable navigation declarations. Page references derive operation targets; branch and column names remain intentional layout identities.

## Infer parameters from routes

Declare path and query types in the route and read them separately as `params.id` and `query.tab`. Existing handlers keep path parameters and context as the first two arguments; the third receives query:

```ts
import { definePage, defineWebApp, int, optional, oneOf } from "@finesoft/front";

export const product = definePage({
    id: "product",
    routes: [
        {
            path: "/products/:id",
            params: { id: int() },
            query: { tab: optional(oneOf(["details", "reviews"])) },
        },
    ],
    handler(params, context, query) {
        context.signal.throwIfAborted();
        // params.id: number; query.tab?: "details" | "reviews"
        return { id: params.id.toFixed(), pageType: "product" as const, title: "Product" };
    },
});
export const definition = defineWebApp({
    id: "shop",
    pages: [product],
    getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
});

product.leaf({ id: 42 });
// product.leaf({ id: "42" }); // Type error
```

Use an independent `BaseController` subclass for recovery. `execute` can return synchronously or asynchronously; `fallback` is optional and bypassed on cancellation. Existing `perform` factories remain supported. `create` does not accept objects with only `execute/fallback`.

### Independent controller classes

Keep routes and classes in separate files. Declare input types only in the routes; use `execute({ params, query, context })` and optional `fallback({ params, query, context, error })` methods:

```ts
// controllers/product.ts — no repeated input annotations when authoring
import { BaseController } from "@finesoft/front";
import type { ProductPage } from "../models/product";

export class ProductController extends BaseController {
    execute({ params, query, context }): ProductPage {
        return { id: params.id.toFixed(), pageType: "product", title: "Product" };
    }
}
```

```ts
// app-definition.ts
import { definePage, int } from "@finesoft/front";
import { ProductController } from "./controllers/product";

export const product = definePage({
    id: "product",
    routes: [{ path: "/products/:id", params: { id: int() } }],
    create: () => new ProductController(),
});
```

The framework finds `BaseController` subclasses through the `create` return type. It maintains only type imports, parameter annotations and base-class generics. Declarations live in `.finesoft/controller-types.d.ts`; no declaration block is appended to controller files. These references appear in saved source, but application authors do not maintain them. Handwritten annotations are preserved; remove the input annotations and base input generic to let the generator manage a class. Keep explicit page return types on methods.

Generated source uses short type names and passes the complete input contract to the base class:

```ts
import type {
    ProductControllerInput as Input,
    ProductControllerFailure as Failure,
} from "../../../.finesoft/controller-types";

export class ProductController extends BaseController<Input, ProductPage> {
    async execute({ params, query, context }: Input): Promise<ProductPage> {
        /* application logic */
    }
    fallback({ params, error }: Failure): ProductPage {
        /* recovery logic */
    }
}
```

`Input` includes `params`, `query` and `context`; `Failure` adds `error`. The generator uses class-qualified aliases when multiple controllers share a file or names are occupied. `BaseController<Input, Result>` is the only generic form; handwritten inputs can use `ControllerInput<Params, Query>`. Direct `perform` calls retain parameter and result checks.

Migrate existing positional `execute` / `fallback` methods to the object argument first. The generator updates type references; it does not rewrite method bodies and reports a migration error for the old multi-argument signature.

Standard TypeScript declarations provide editor completion and command-line checking. Generation never executes application modules or instantiates controllers, and adds no runtime code. A class registered against several routes receives their input union, with normal narrowing required.

When a route registration is removed but its class remains, generation retains that class's last input contract for independent use. Registering it again updates the contract from the new routes. Solution-style `tsconfig.json` files automatically select the referenced application project containing `src`; use `controllerTypes.tsconfig` when several projects qualify.

Templates already enable generation. For existing apps, install `typescript` as a development dependency and create the framework plugin outside `lazyPlugins` so `vp check` generates types when reading the config:

```ts
const front = finesoftFrontViteConfig({
    controllerTypes: { root: import.meta.dirname },
});
export default defineConfig({
    lint: { options: { typeAware: true, typeCheck: true } },
    plugins: lazyPlugins(() => [front, react()]),
});
```

`vp dev` watches source changes; `vp check` and builds also generate declarations. Run one of these commands when first opening a project. Ignore `.finesoft/` in Git and commit the managed source references. With standalone `tsc` or a custom toolchain, first call `generateControllerTypes({ root })` from `@finesoft/front`. Set `controllerTypes: false` to disable maintenance.

The app returned by `createBrowserApp({ definition, target })`, `createWebSession`, and the SSR `render(app)` callback retain the definition's parameter map:

```ts
await app.perform({ kind: "push", intent: "product", params: { id: 42 } });
// A string id, missing id, or unknown intent produces a type error.
```

`route()` and page reference `.route()` results retain their declared codec types. Keep the inferred factory return types instead of annotating `definition` with the broad `WebAppDefinition`. An explicit `PageRoute` annotation permits absent codecs, so inferred inputs must also account for that possibility; use `satisfies PageRoute` to check the declaration without erasing its concrete type. Components needing an explicit app type can use `WebAppView<typeof definition>` or `ViewProps<ProductPage, typeof definition>` without repeating parameter interfaces. The default `WebAppView` remains suitable for generic layouts and Outlets.

String arrays such as `routes: ["/items/:id", "/products/:id"]` still declare aliases. Unspecified path codecs produce strings; `:tab?` is optional. Different alias parameter shapes produce a union that the controller must narrow. When several aliases match the same parameters, provide `url` on the structured destination to select a path, for example `product.leaf({ id: 42 }, { url: "/products/42" })`.

`optional`, `withDefault`, `list`, and third-party Standard Schema outputs determine receiver types. References and structured actions use this same output shape, so defaulted fields remain required there; URL navigation can omit them and let the Router apply defaults. The existing Router still validates and converts parameters, without a second schema pass.

### Query and path parameters

Both use the same codecs and inference, supplied as separate properties of the controller argument. No manual URL parsing is required:

```ts
routes: [
    {
        path: "/products/:id",
        params: { id: int() },
        query: {
            q: withDefault(str(), ""),
            tags: optional(list(str())),
        },
    },
];
// execute({ params, query, context }):
// params.id: number; query.q: string; query.tags: string[] | undefined.
await app.perform({
    kind: "push",
    intent: "product",
    params: { id: 42 },
    query: { q: "a & b", tags: ["new", "sale"] },
});
```

The router encodes params in the path and query in the query string. Arrays preserve their order as repeated keys. URL navigation also accepts `/products/42?q=a%20%26%20b&tags=new&tags=sale` directly.

Query names are not restricted to path placeholders. `optional` permits missing values; `withDefault` supplies missing values while explicit empty strings still undergo validation. `list` collects repeated keys and yields `[]` when absent. `optional(list(...))` yields `undefined` when absent; `withDefault(list(...), [...])` uses the default array. Single-value schemas keep the last repeated value. Undeclared query fields retain string compatibility without declared-field type guarantees; same-named path and query fields retain their independent values.

## Tree / 导航树

```ts
import { stack, tabs, split } from "@finesoft/front";
import { home, product } from "./pages";
export const navigation = tabs({
    active: "catalog",
    branches: {
        catalog: stack([home.leaf(), product.leaf({ id: 42 })]),
        compare: split([{ id: "left", content: product.leaf({ id: 42 }) }, { id: "right" }]),
    },
});
// defineWebApp({ ..., navigation })
```

Each equal target still receives its own EntryId and draft. ResourceKey may share explicitly cached query data without sharing view state. Standard browser start owns URL actions, redirects and popstate; obsolete URL results cannot commit over later work. Explicit tree operations use one serialized controller queue. Tabs retain branches, Stack retains present entries, Split guards each destination. Choose renderer mode `entries` when native entry lifetimes should follow the tree.

## Navigation actions

All navigation uses `app.perform(action)`. URLs use `{ kind: "flow", url }`; structured navigation uses these actions:

| kind              | Fields                                                        |
| ----------------- | ------------------------------------------------------------- |
| push / replaceTop | intent, params?, query?, target?, url?                        |
| pop               | count?, target?                                               |
| popToRoot         | target?                                                       |
| popTo             | index, target?                                                |
| selectTab         | key, target?                                                  |
| selectColumn      | columnId, intent (undefined clears), params?, query?, target? |
| setVisibility     | visibility, target?                                           |
| reuseEntry        | entryId                                                       |
| refresh           | —                                                             |
| hydrate           | tree                                                          |

## Transaction policies

`defineWebApp({ beforeNavigate, beforeCommit })` adds optional whole-tree policies. Each policy in its array runs once per transaction, even when the target tree is empty. Definition policies run before controller-local policies. `beforeLoad` / `afterLoad` still run for each visible page.

```ts
import { next, deny, type BeforeCommitPolicy } from "@finesoft/front";
import { hasUnsavedDraft } from "./editor-state";
export const preserveDraft: BeforeCommitPolicy = ({ from, candidate }) => {
    // Inspect application-owned draft state and both trees here.
    const leavingEditor =
        from.destinations.some((page) => page.intent === "editor") &&
        !candidate.destinations.some((page) => page.intent === "editor");
    return leavingEditor && hasUnsavedDraft()
        ? deny(409, "Save your draft before leaving")
        : next();
};
// defineWebApp({ ..., beforeCommit: [preserveDraft] })
```

Admission receives `from`, candidate `tree`, stable `transitionId`, active `execution`, its `signal`, and `isServer`. It returns `next`, `deny`, or `redirect`. Page redirects keep the same transaction identity and do not repeat admission. Commit policies also receive the loaded `candidate`; they return only `next` or `deny`, before cache consumption, committed state, history, events or views change. Each redirect hop retains its existing execution cleanup; the final commit policy sees the final hop's execution. Async policies must honor cancellation for their own I/O; stale results cannot commit.

A denial returns an uncommitted snapshot with `rejection`, including for empty trees. Session restore rejects it before replacing scopes or slices. Initial browser denial renders the error without committing navigation or recording a page visit; later denial preserves the displayed draft. Both flat and navigation SSR honor these policies and emit no rejected page data or public-cache permission. CSR shells still defer navigation to the browser.

Owned back/forward rejection compensates to the committed history entry and restores its scroll identity. Additive history metadata preserves ownership and position across reloads. Entries without compatible ownership metadata are diagnosed; the framework cannot infer a safe traversal distance for external entries.

Low-level hosts configuring `createWebSession({ createContext })` return a `NavigationContext` directly. The execution supplies its DI container and cancellation signal; request cookies and headers stay in the host context. The session uses the application's `getErrorPage` unless explicitly overridden.
