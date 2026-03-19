# @finesoft/front

Full-stack TypeScript framework — router, DI, actions, SSR, and server — all in one package.

Works with **Vue**, **React**, and **Svelte**. Deploy to Node.js, Vercel, Cloudflare Workers, Netlify, or static hosting.

## Install

```bash
npx create-finesoft-app my-app
```

Or add to an existing project:

```bash
npm install @finesoft/front
```

Peer dependencies: `hono >= 4.0.0`. Optional: `@hono/node-server`, `vite >= 5.0.0`.

## Setup

```ts
// vite.config.ts
import { finesoftFrontViteConfig } from "@finesoft/front";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

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

## Routing

```ts
// src/bootstrap.ts
import { type Framework, defineRoutes } from "@finesoft/front";
import { HomeController } from "./lib/controllers/home";
import { authGuard } from "./lib/guards/auth";

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, [
        { path: "/", intentId: "home", controller: new HomeController() },
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

## Controllers

```ts
import { BaseController, type Container } from "@finesoft/front";

class HomeController extends BaseController<Record<string, string>, HomePage> {
    readonly intentId = "home";

    async execute(_params: Record<string, string>, container: Container) {
        const http = container.resolve<HttpClient>("http");
        return http.get("/api/home");
    }
}
```

## Middleware

Two-phase guards shared between SSR and CSR:

```ts
import { next, redirect, type NavigationContext } from "@finesoft/front";

function authGuard(ctx: NavigationContext) {
    return ctx.getCookie("token") ? next() : redirect("/login");
}
```

Results: `next()`, `redirect(url, status?)`, `rewrite(url)`, `deny(status?, message?)`.

## Lifecycle Hooks

`startBrowserApp` provides hooks for initialization:

```ts
import { startBrowserApp } from "@finesoft/front/browser";

startBrowserApp({
    bootstrap,
    // Pass framework config so locale/reporting/etc. are wired into Framework
    frameworkConfig: {
        locale: "zh-Hans",
    },
    mount: (target, { framework }) => {
        /* ... */
    },
    callbacks: { onNavigate, onExternalUrl },
    onBeforeStart(framework) {
        // Runs after Framework creation, before mount.
        // Good for: error monitoring, analytics SDK, i18n init.
    },
    onAfterStart(framework) {
        // Runs after initial page trigger.
        // Good for: service worker registration, performance marks.
    },
});
```

## Locale (i18n)

Pass `locale` in `FrameworkConfig` to enable automatic locale handling:

```ts
const framework = Framework.create({
    locale: "zh-Hans", // or "en-US", "ar-SA", etc.
});

// SSR: automatically injects <html lang="zh-Hans" dir="ltr">
// Browser: automatically sets document.documentElement.lang/dir on startup
```

For SSR, locale is resolved in this order:

1. Explicit `resolveLocale` callback (if provided)
2. `locale` from `FrameworkConfig` (via DI container)

Access at runtime:

```ts
const locale = framework.getLocale();
// { lang: "zh-Hans", dir: "ltr" }
```

### Translator

For full i18n translation, use `SimpleTranslator`:

```ts
import { SimpleTranslator } from "@finesoft/front";

const t = new SimpleTranslator({
    locale: "zh-Hans",
    messages: {
        hello: "你好",
        "items.one": "{count} 个项目",
        "items.other": "{count} 个项目",
    },
});

t.t("hello"); // "你好"
t.t("hello", { name: "World" }); // "你好"
t.plural("items", 5); // "5 个项目"
```

### RTL Support

```ts
import { isRtl, getTextDirection, getLocaleAttributes } from "@finesoft/front";

isRtl("ar"); // true
getTextDirection("he"); // "rtl"
getLocaleAttributes("ar-SA"); // { lang: "ar-SA", dir: "rtl" }
```

## Metrics & Event Recording

### EventRecorder (recommended)

New pipeline for structured event recording. Default: `ConsoleEventRecorder` (logs to console).

```ts
import { Framework, type EventRecorder } from "@finesoft/front";

// Custom recorder
const framework = Framework.create({
    eventRecorder: myAnalyticsRecorder,
});

// Framework automatically records PageView events via didEnterPage()
```

Compose multiple recorders:

```ts
import { CompositeEventRecorder, ConsoleEventRecorder } from "@finesoft/front";

const recorder = new CompositeEventRecorder([new ConsoleEventRecorder(), myProductionRecorder]);
```

Inject common fields into every event:

```ts
import { WithFieldsRecorder } from "@finesoft/front";

const recorder = new WithFieldsRecorder(baseRecorder, [
    { getFields: () => ({ app: "myApp", version: "1.0" }) },
]);
```

### Impression Tracking

Track element visibility using `IntersectionObserver`:

```ts
import { IntersectionImpressionObserver } from "@finesoft/front";

const observer = new IntersectionImpressionObserver((entries) => {
    for (const entry of entries) {
        analytics.track("impression", { id: entry.id, ...entry.metadata });
    }
});

observer.observe(element, "product-card-123", { category: "featured" });
// Later:
observer.unobserve(element);
observer.destroy();
```

## Error Reporting

Send `warn`/`error` logs to an external monitoring service (Sentry, Datadog, etc.):

```ts
import { Framework, type ReportCallback } from "@finesoft/front";

const framework = Framework.create({
    reportCallback(level, category, args) {
        sentry.captureMessage(`[${category}] ${args.join(" ")}`, level);
    },
});

// Automatically composes with ConsoleLogger — console output is preserved.
// All framework.getLogger().warn(...) and .error(...) calls are forwarded.
```

## HTTP Client

Subclass `HttpClient` to create typed API clients:

```ts
import { HttpClient } from "@finesoft/front";

class MyApi extends HttpClient {
    async getUser(id: string) {
        return this.get<User>(`/users/${id}`);
    }
    async createUser(data: NewUser) {
        return this.post<User>("/users", data);
    }
}
```

### Interceptors

Add request/response interceptors for auth, logging, retries, etc.:

```ts
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
        (response, url) => {
            if (response.status === 401) refreshToken();
            return response;
        },
    ],
});

// Or add dynamically:
api.useRequestInterceptor((url, init) => {
    /* ... */ return init;
});
```

## Platform Detection

Automatically detected from User-Agent and available via DI:

```ts
const platform = framework.getPlatform();
// { os: "ios", browser: "safari", engine: "webkit", isMobile: true, isTouch: true }
```

Standalone usage:

```ts
import { detectPlatform } from "@finesoft/front";
const info = detectPlatform(); // auto-reads navigator.userAgent
```

## PWA Detection

```ts
import { getPWADisplayMode } from "@finesoft/front";

const mode = getPWADisplayMode();
// "standalone" | "twa" | "browser"
```

## Feature Flags

```ts
const framework = Framework.create({
    featureFlags: { darkMode: true, maxRetries: 3 },
});

// Add remote providers (last registered wins):
import { type FeatureFlagsProvider } from "@finesoft/front";

const framework = Framework.create({
    featureFlags: { darkMode: false },
    featureFlagsProviders: [remoteConfigProvider],
});
```

## DI Container

Scoped containers for request isolation (SSR):

```ts
const requestScope = framework.container.createScope();
requestScope.register("user", () => currentUser);
// Falls back to parent container if key not found
```

## SSR

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
        const html = await renderToString(createSSRApp(App, { page }));
        return { html, head: `<title>${page.title}</title>`, css: "" };
    },
});

export { serializeServerData };
```

## Adapters

| Adapter        | Target                     |
| -------------- | -------------------------- |
| `"node"`       | Standalone Node.js server  |
| `"vercel"`     | Vercel Build Output API v3 |
| `"cloudflare"` | Cloudflare Workers         |
| `"netlify"`    | Netlify Functions v2       |
| `"static"`     | Pre-rendered static files  |
| `"auto"`       | Auto-detect at build time  |

## Entry Points

| Import                    | Contents                                   |
| ------------------------- | ------------------------------------------ |
| `@finesoft/front`         | Everything (core + browser + SSR + server) |
| `@finesoft/front/browser` | Browser-only (no server code)              |

## License

MIT
