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
            locales: ["en", "zh"],
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
