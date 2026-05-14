# Engineering: project structure

Recommended layout for apps past the scaffolded starter. The shape that works for ~20 routes and ~10 engineers without major reorganization.

## Layout

```
my-app/
├── src/
│   ├── bootstrap.ts             # routes + DI setup (shared SSR + CSR)
│   ├── main.ts                  # browser entry
│   ├── ssr.ts                   # SSR entry
│   ├── App.vue                  # root component
│   │
│   ├── routes/                  # route definitions, grouped by domain
│   │   ├── home.ts
│   │   ├── product.ts
│   │   ├── checkout.ts
│   │   └── admin.ts
│   │
│   ├── controllers/             # controllers, one file per intent
│   │   ├── home.ts
│   │   ├── product.ts
│   │   └── checkout.ts
│   │
│   ├── views/                   # view components, mirror controllers
│   │   ├── Home.vue
│   │   ├── Product.vue
│   │   └── Checkout.vue
│   │
│   ├── lib/
│   │   ├── api/                 # HttpClient subclasses
│   │   │   ├── user.ts
│   │   │   └── product.ts
│   │   ├── guards/              # reusable middleware
│   │   │   ├── auth.ts
│   │   │   ├── locale.ts
│   │   │   └── analytics.ts
│   │   ├── di/
│   │   │   ├── keys.ts          # APP_KEYS const map
│   │   │   └── register.ts      # central registration
│   │   ├── i18n/
│   │   │   └── translator.ts    # Translator factory
│   │   └── pages/
│   │       └── types.ts         # Page union type
│   │
│   ├── locales/
│   │   ├── en-US.json
│   │   ├── zh-Hans.json
│   │   └── ja-JP.json
│   │
│   └── env.ts                   # env var parsing + validation
│
├── public/                      # static assets, served at /
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

## Why this shape

### `routes/` separate from `controllers/`

A route is **where** an intent is exposed (URL pattern, guards, render mode). A controller is **what** an intent does. Splitting them lets you:

- Reuse a controller across multiple URLs without route definitions cluttering its file
- Find "what URLs does my app serve" by reading one folder
- Find "what does intent X compute" by reading one folder

### `controllers/` mirrors `views/`

One file per intent on both sides. The intent id, controller file, and view file share the same name. Finding the rendering code for `/products/:id` becomes mechanical.

### `lib/` for everything cross-cutting

Anything that isn't a route, controller, or view. The framework's `bootstrap()` reaches into `lib/di/register.ts` for the heavy registration; controllers reach into `lib/api/*` for clients; guards live in `lib/guards/`.

### `env.ts` at the top of `src/`

Parse and validate environment variables once, in one file. Use [zod](https://zod.dev/) or hand-rolled checks. Re-export typed constants everywhere else.

```ts
// src/env.ts
function requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env: ${name}`);
    return v;
}

export const env = {
    UPSTREAM_URL: requireEnv("UPSTREAM_URL"),
    SESSION_SECRET: requireEnv("SESSION_SECRET"),
    NODE_ENV: process.env.NODE_ENV ?? "development",
} as const;
```

This makes "what env vars does this app need" trivially discoverable, and the build fails fast on missing values instead of crashing at request time.

## `bootstrap.ts` shape

Keep `bootstrap.ts` thin — it should orchestrate, not contain logic:

```ts
// src/bootstrap.ts
import { type Framework } from "@finesoft/front";
import { registerDependencies } from "./lib/di/register";
import { homeRoutes } from "./routes/home";
import { productRoutes } from "./routes/product";
import { checkoutRoutes } from "./routes/checkout";
import { adminRoutes } from "./routes/admin";

export function bootstrap(framework: Framework): void {
    registerDependencies(framework.container);

    homeRoutes(framework);
    productRoutes(framework);
    checkoutRoutes(framework);
    adminRoutes(framework);
}
```

Each `*Routes` function calls `defineRoutes(framework, [...])` with its own routes. Adding a new route group is one import + one call.

## Per-domain route file

```ts
// src/routes/product.ts
import { defineRoutes, type Framework } from "@finesoft/front";
import { ProductController } from "../controllers/product";
import { ProductListController } from "../controllers/product-list";
import { authGuard } from "../lib/guards/auth";

export function productRoutes(framework: Framework): void {
    defineRoutes(framework, [
        { path: "/products", intentId: "product-list", controller: new ProductListController() },
        { path: "/products/:id", intentId: "product", controller: new ProductController() },
        {
            path: "/products/:id/edit",
            intentId: "product-edit",
            controller: new ProductEditController(),
            beforeLoad: [authGuard],
            renderMode: "csr",
        },
    ]);
}
```

## Central DI registration

```ts
// src/lib/di/register.ts
import { type Container, DEP_KEYS } from "@finesoft/front";
import { APP_KEYS } from "./keys";
import { UserApi } from "../api/user";
import { ProductApi } from "../api/product";
import { ConsoleLogger } from "@finesoft/front";
import { env } from "../../env";

export function registerDependencies(container: Container): void {
    container.register(DEP_KEYS.LOGGER, () => new ConsoleLogger("app"));

    container.register(
        APP_KEYS.USER_API,
        () =>
            new UserApi({
                baseUrl: env.UPSTREAM_URL,
            }),
    );
    container.register(
        APP_KEYS.PRODUCT_API,
        () =>
            new ProductApi({
                baseUrl: env.UPSTREAM_URL,
            }),
    );
}
```

Centralizing keeps the wiring inspectable. Adding a service is a single edit, not a search across the project.

## Typed DI keys

```ts
// src/lib/di/keys.ts
export const APP_KEYS = {
    USER_API: "userApi",
    PRODUCT_API: "productApi",
    SESSION: "session",
    FEATURE_BUCKETING: "featureBucketing",
} as const;

export type AppKey = (typeof APP_KEYS)[keyof typeof APP_KEYS];
```

Then in any controller:

```ts
import { APP_KEYS } from "../lib/di/keys";

async execute(params, container) {
    const api = container.resolve<UserApi>(APP_KEYS.USER_API);
    // ...
}
```

A typo in `APP_KEYS.USER_PAI` is a compile error. A typo in `"userPai"` is a runtime error.

## Page type union

```ts
// src/lib/pages/types.ts
import type { HomePage } from "../../controllers/home";
import type { ProductPage } from "../../controllers/product";
import type { CheckoutPage } from "../../controllers/checkout";
import type { ErrorPage } from "./error";

export type Page = HomePage | ProductPage | CheckoutPage | ErrorPage;
```

Use a discriminated union with a `kind` field. The view layer's root component switches on `page.kind`:

```vue
<script setup lang="ts">
import type { Page } from "@/lib/pages/types";
const props = defineProps<{ page: Page }>();
</script>

<template>
    <Home v-if="page.kind === 'home'" :page="page" />
    <Product v-else-if="page.kind === 'product'" :page="page" />
    <Checkout v-else-if="page.kind === 'checkout'" :page="page" />
    <Error v-else-if="page.kind === 'error'" :page="page" />
</template>
```

The discriminant narrows the type inside each branch — view components get a fully typed `page` prop without casts.

## Splitting the SSR and browser entries

Keep `ssr.ts` and `main.ts` thin. They differ only in:

- `ssr.ts` calls `createSSRRender` and exports `render` + `serializeServerData`
- `main.ts` calls `startBrowserApp` and mounts the view layer

Everything else — routes, controllers, DI, i18n — is shared via `bootstrap.ts`.

```ts
// src/ssr.ts
import { createSSRRender, serializeServerData } from "@finesoft/front";
import { renderToString } from "vue/server-renderer";
import { createSSRApp } from "vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

export const render = createSSRRender({
    bootstrap,
    getErrorPage: () => ({ kind: "error", title: "Server error" }),
    async renderApp(page) {
        const html = await renderToString(createSSRApp(App, { page }));
        return { html, head: `<title>${page.title}</title>`, css: "" };
    },
});

export { serializeServerData };
```

```ts
// src/main.ts
import { startBrowserApp } from "@finesoft/front/browser";
import { createSSRApp } from "vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

startBrowserApp({
    bootstrap,
    mount(target, { framework }) {
        createSSRApp(App, { framework }).mount(target);
    },
});
```

## When to break this layout

The shape above works through ~50 routes. Past that, consider:

- **Per-feature folders** (`src/features/checkout/{routes,controllers,views,api}.ts`) for very large apps. Each feature is independently understandable.
- **Lazy-loaded route bundles** with `import()` inside the route definition. The Vite plugin splits them automatically.
- **Workspace packages** if multiple apps share the same controllers / API clients. Move shared code to `packages/shared` and import from there.

Don't pre-emptively reorganize. The flat `routes/` + `controllers/` shape is fine well into the hundreds of files.

## See also

- [Engineering: testing](./testing.md) — how to test against this structure
- [DI container](../07-di-container.md) — registration patterns
