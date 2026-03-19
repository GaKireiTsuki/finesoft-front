# @finesoft/front

Full-stack TypeScript framework — router, DI, actions, SSR, and server — all in one package.

Works with **Vue**, **React**, and **Svelte**. Deploy anywhere: Node.js, Vercel, Cloudflare Workers, Netlify, or static hosting.

## Quick Start

```bash
npx create-finesoft-app my-app
cd my-app
vp install
vp dev
```

The CLI scaffolds a project with routing, SSR, controllers, middleware guards, and a ready-to-deploy Vite config.

## Architecture

```
core ← browser       (client runtime)
core ← ssr ← server  (server runtime, Hono-based)
front                 (published aggregation bundle)
```

| Package     | Purpose                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| **core**    | Router, DI container, action/intent dispatchers, middleware pipeline, data mappers      |
| **browser** | Browser bootstrap, action handlers, history management, SSR data hydration              |
| **ssr**     | Server-side rendering, HTML injection, prefetched intent serialization                  |
| **server**  | Hono integration, multi-platform adapters, Vite plugin                                  |
| **front**   | Published package — bundles all above with two entry points (full-stack + browser-only) |

`@finesoft/front` is the only dependency you need. It re-exports everything from the internal packages:

```ts
import {
    Framework,
    defineRoutes,
    BaseController,
    startBrowserApp,
    createSSRRender,
    finesoftFrontViteConfig,
} from "@finesoft/front";
```

## Vite Plugin

Add `finesoftFrontViteConfig()` to your Vite config to enable SSR dev server, build, and preview:

```ts
// vite.config.ts
import { finesoftFrontViteConfig } from "@finesoft/front";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

export default defineConfig({
    plugins: [
        vue(),
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.ts" },
            proxies: [{ prefix: "/api", target: "https://api.example.com" }],
            adapter: "auto",
        }),
    ],
});
```

### Options

| Option           | Type                         | Description                                                |
| ---------------- | ---------------------------- | ---------------------------------------------------------- |
| `ssr.entry`      | `string`                     | SSR entry file (default `"src/ssr.ts"`)                    |
| `proxies`        | `ProxyRouteConfig[]`         | Declarative proxy routes with SSRF protection              |
| `setup`          | `Function \| string`         | Custom Hono routes                                         |
| `adapter`        | `string \| Adapter`          | Deploy adapter (see [Adapters](#adapters))                 |
| `renderModes`    | `Record<string, RenderMode>` | Per-route render mode overrides                            |
| `bootstrapEntry` | `string`                     | Route definitions entry (default `"src/lib/bootstrap.ts"`) |

## Routing & Controllers

Use `defineRoutes()` for declarative route registration:

```ts
// src/bootstrap.ts
import { type Framework, defineRoutes } from "@finesoft/front";
import { HomeController } from "./lib/controllers/home";
import { ProductController } from "./lib/controllers/product";
import { authGuard } from "./lib/guards/auth";

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, [
        { path: "/", intentId: "home", controller: new HomeController() },
        {
            path: "/products/:id",
            intentId: "product",
            controller: new ProductController(),
        },
        {
            path: "/about",
            intentId: "about",
            controller: new AboutController(),
            renderMode: "csr",
        },
        { path: "/admin", intentId: "home", beforeLoad: [authGuard] },
    ]);
}
```

### BaseController

Controllers extend `BaseController<TParams, TResult>` with a built-in try/catch → `fallback()` pattern:

```ts
import { BaseController, type Container, HttpClient } from "@finesoft/front";

class ProductController extends BaseController<{ id: string }, ProductPage> {
    readonly intentId = "product";

    async execute(params: { id: string }, container: Container) {
        const http = container.resolve<HttpClient>("http");
        return http.get(`/api/products/${params.id}`);
    }

    fallback(_params: { id: string }, error: Error) {
        return { title: "Error", error: error.message };
    }
}
```

### Render Modes

Each route can specify a render mode:

| Mode          | Behavior                                              |
| ------------- | ----------------------------------------------------- |
| `"ssr"`       | Server-side rendering (default)                       |
| `"csr"`       | Client-side only — server returns an empty HTML shell |
| `"prerender"` | Build-time static HTML generation with ISR caching    |

## Middleware

Two-phase navigation guards — shared between SSR and CSR:

```ts
import {
    next,
    redirect,
    deny,
    type NavigationContext,
    type PostLoadContext,
} from "@finesoft/front";

// beforeLoad — runs after route match, before data loading
function authGuard(ctx: NavigationContext) {
    const token = ctx.getCookie("auth_token");
    return token ? next() : redirect("/login");
}

// afterLoad — runs after data loading, before rendering
function seoGuard(ctx: PostLoadContext) {
    if (ctx.page.canonicalUrl && ctx.url !== ctx.page.canonicalUrl) {
        return redirect(ctx.page.canonicalUrl, 301);
    }
    return next();
}
```

Guards can be registered globally or per-route:

```ts
framework.beforeLoad(authGuard); // global
framework.afterLoad(seoGuard); // global

defineRoutes(framework, [
    { path: "/admin", intentId: "admin", beforeLoad: [authGuard] }, // per-route
]);
```

Guard results: `next()`, `redirect(url, status?)`, `rewrite(url)`, `deny(status?, message?)`.

## SSR Entry

The SSR entry file exports a `render` function and `serializeServerData`:

```ts
// src/ssr.ts
import { createSSRRender, serializeServerData } from "@finesoft/front";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

export const render = createSSRRender({
    bootstrap,
    getErrorPage: () => ({ title: "Error", kind: "error" }),
    async renderApp(page) {
        const app = createSSRApp(App, { page });
        const html = await renderToString(app);
        return { html, head: `<title>${page.title}</title>`, css: "" };
    },
});

export { serializeServerData };
```

## Browser Entry

The browser entry hydrates the SSR output and handles client-side navigation:

```ts
// src/main.ts
import { startBrowserApp, type Framework, type BasePage } from "@finesoft/front";
import { createApp, reactive } from "vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

void startBrowserApp({
    bootstrap,
    // Pass framework config (locale, error reporting, etc.)
    frameworkConfig: {
        locale: "zh-Hans",
        reportCallback(level, category, args) {
            sentry.captureMessage(`[${category}] ${args.join(" ")}`, level);
        },
    },
    mount(target, { framework }) {
        const state = reactive({ page: null, loading: false });
        createApp(App, { state }).mount(target);

        return ({ page, isFirstPage }) => {
            if (page instanceof Promise) {
                if (!isFirstPage) state.loading = true;
                page.then((p) => {
                    state.page = p;
                    state.loading = false;
                });
            } else {
                state.page = page;
                state.loading = false;
            }
        };
    },
    // Lifecycle hooks
    onBeforeStart(framework) {
        // After Framework creation, before mount — init monitoring, analytics, etc.
    },
    onAfterStart(framework) {
        // After initial page trigger — register service worker, etc.
    },
});
```

## Configuration

`Framework.create()` accepts a `FrameworkConfig` with the following options:

```ts
const framework = Framework.create({
    // Locale — auto-injects <html lang="" dir=""> in SSR & browser
    locale: "zh-Hans",
    // Error reporting — auto-composes with console logger
    reportCallback(level, category, args) {
        sentry.captureMessage(`[${category}] ${args.join(" ")}`, level);
    },
    // Custom event recorder (default: ConsoleEventRecorder)
    eventRecorder: myAnalyticsRecorder,
    // Feature flags with optional remote providers
    featureFlags: { darkMode: true },
    featureFlagsProviders: [remoteConfigProvider],
    // Custom platform info (default: auto-detected from UA)
    platform: customPlatformInfo,
    // Custom fetch implementation
    fetch: customFetch,
});
```

### Locale & i18n

```ts
// Runtime access
framework.getLocale(); // { lang: "zh-Hans", dir: "ltr" }

// RTL detection utilities
import { isRtl, getTextDirection, getLocaleAttributes } from "@finesoft/front";
isRtl("ar"); // true
getTextDirection("he"); // "rtl"
getLocaleAttributes("ar-SA"); // { lang: "ar-SA", dir: "rtl" }

// Translator for full i18n
import { SimpleTranslator } from "@finesoft/front";
const t = new SimpleTranslator({
    locale: "zh-Hans",
    messages: {
        hello: "你好",
        "items.one": "{count} 个",
        "items.other": "{count} 个",
    },
});
t.t("hello"); // "你好"
t.plural("items", 5); // "5 个"
```

### Error Reporting

Pass `reportCallback` to automatically forward `warn`/`error` logs to an external service while preserving console output:

```ts
Framework.create({
    reportCallback(level, category, args) {
        sentry.captureMessage(`[${category}] ${args.join(" ")}`, level);
    },
});
```

### Metrics & Event Recording

```ts
import {
    CompositeEventRecorder,
    ConsoleEventRecorder,
    WithFieldsRecorder,
    IntersectionImpressionObserver,
} from "@finesoft/front";

// Compose multiple recorders
const recorder = new CompositeEventRecorder([new ConsoleEventRecorder(), myProductionRecorder]);

// Inject common fields
const withFields = new WithFieldsRecorder(recorder, [
    { getFields: () => ({ app: "myApp", version: "1.0" }) },
]);

// Impression tracking
const observer = new IntersectionImpressionObserver((entries) => {
    for (const entry of entries) {
        analytics.track("impression", { id: entry.id, ...entry.metadata });
    }
});
observer.observe(element, "card-123", { category: "featured" });
```

### Platform & PWA Detection

```ts
// Auto-detected from UA, available via DI
framework.getPlatform();
// { os: "ios", browser: "safari", engine: "webkit", isMobile: true, isTouch: true }

// Standalone usage
import { detectPlatform, getPWADisplayMode } from "@finesoft/front";
detectPlatform(); // auto-reads navigator.userAgent
getPWADisplayMode(); // "standalone" | "twa" | "browser"
```

### HTTP Client Interceptors

```ts
import { HttpClient } from "@finesoft/front";

class MyApi extends HttpClient {
    async getUser(id: string) {
        return this.get<User>(`/users/${id}`);
    }
}

const api = new MyApi({
    baseUrl: "/api",
    requestInterceptors: [
        (url, init) => {
            init.headers = {
                ...init.headers,
                Authorization: `Bearer ${token}`,
            };
            return init;
        },
    ],
    responseInterceptors: [
        (response) => {
            if (response.status === 401) refreshToken();
            return response;
        },
    ],
});
```

### Scoped DI Container

Create child containers for request-level isolation (useful in SSR):

```ts
const scope = framework.container.createScope();
scope.register("user", () => currentUser);
// Falls back to parent container for unregistered keys
```

## Adapters

Deploy to any platform by setting the `adapter` option:

| Adapter        | Target                            |
| -------------- | --------------------------------- |
| `"node"`       | Standalone Node.js HTTP server    |
| `"vercel"`     | Vercel (Build Output API v3)      |
| `"cloudflare"` | Cloudflare Workers                |
| `"netlify"`    | Netlify Functions v2              |
| `"static"`     | Pre-rendered static files         |
| `"auto"`       | Auto-detect runtime at build time |

```ts
finesoftFrontViteConfig({
    adapter: "vercel",
});
```

Custom adapters implement the `Adapter` interface:

```ts
const myAdapter: Adapter = {
    name: "my-platform",
    async build(ctx) {
        // ctx.buildBundle(), ctx.copyStaticAssets(), ctx.generateSSREntry()
    },
};
```

## Proxy Routes

Declarative proxy configuration with built-in SSRF protection:

```ts
finesoftFrontViteConfig({
    proxies: [{ prefix: "/api", target: "https://api.example.com" }],
});
```

## Development

```bash
vp install            # Install dependencies
vp dev                # Start dev server
vp check              # Format + lint + type-check
vp test               # Run tests
vp run build -r       # Build all packages
vp ready              # fmt + lint + build (full validation)
```

## Release

```bash
changeset             # Create a changeset
vp run build -r && changeset publish --access public
```

## License

MIT
