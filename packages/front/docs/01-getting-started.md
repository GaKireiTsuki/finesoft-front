# 1. Getting started

A working `@finesoft/front` app in five minutes. By the end you have a Vue/React/Svelte page rendering on the server, hydrating in the browser, and ready to deploy.

## Prerequisites

- Node.js `>= 22.12.0`
- A package manager: pnpm (recommended), npm, or yarn
- A view layer (Vue 3, React 19, or Svelte 5) — these docs use Vue, but every example translates one-to-one

## Scaffold a new app

```bash
npx @finesoft/create-app my-app
cd my-app
pnpm install
pnpm dev
```

The scaffolder generates a runnable app with routing, SSR, and proxy already wired. Open <http://localhost:5173>.

If you want to understand what was generated, the rest of this page builds the same setup from scratch.

## Add to an existing project

```bash
pnpm add @finesoft/front
pnpm add -D vite hono
```

Peer dependencies: `hono >= 4.0.0`. Optional but recommended: `@hono/node-server` for Node deployment, `vite >= 5.0.0` for the dev server.

## Minimal project layout

```
my-app/
├── src/
│   ├── bootstrap.ts       # routes + controllers (shared SSR + CSR)
│   ├── main.ts            # browser entry
│   ├── ssr.ts             # SSR entry
│   ├── App.vue            # root component
│   └── lib/
│       └── controllers/
│           └── home.ts
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

## Vite config

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
            i18n: { messagesDir: "src/locales" },
            adapter: "auto",
        }),
    ],
});
```

What `finesoftFrontViteConfig` adds:

- A Hono-based dev server that runs your SSR entry on every request
- Locale JSON auto-loading from `messagesDir`
- A build pipeline that emits both the client bundle and a server entry
- Platform adapter wiring for `adapter: "auto" | "node" | "vercel" | "cloudflare" | "netlify" | "static"`

## Bootstrap (shared by SSR and CSR)

```ts
// src/bootstrap.ts
import { type Framework, defineRoutes } from "@finesoft/front";
import { HomeController } from "./lib/controllers/home";

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, [{ path: "/", intentId: "home", controller: new HomeController() }]);
}
```

The same `bootstrap()` runs on both sides. This is what guarantees the server and browser resolve URLs identically.

## Controller

```ts
// src/lib/controllers/home.ts
import { BaseController, type Container } from "@finesoft/front";

interface HomePage {
    kind: "home";
    title: string;
    items: string[];
}

export class HomeController extends BaseController<Record<string, string>, HomePage> {
    readonly intentId = "home";

    async execute(_params: Record<string, string>, _container: Container): Promise<HomePage> {
        return {
            kind: "home",
            title: "Welcome",
            items: ["one", "two", "three"],
        };
    }

    fallback(_params: Record<string, string>, error: unknown): HomePage {
        return { kind: "home", title: "Failed", items: [] };
    }
}
```

`BaseController` wraps `execute()` in `try/catch` and calls `fallback()` on error. Always provide a `fallback` — see [error handling](./08-observability.md#error-handling-via-fallback) for why.

## SSR entry

```ts
// src/ssr.ts
import { createSSRRender, serializeServerData } from "@finesoft/front";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

export const render = createSSRRender({
    bootstrap,
    getErrorPage: () => ({ kind: "error", title: "Error" }),
    async renderApp(page) {
        const html = await renderToString(createSSRApp(App, { page }));
        return { html, head: `<title>${(page as { title: string }).title}</title>`, css: "" };
    },
});

export { serializeServerData };
```

`createSSRRender` returns a function that takes a URL and returns rendered HTML + serialized prefetched intent data. The Vite plugin and adapters call it for you — you do not invoke it directly.

## Browser entry

```ts
// src/main.ts
import { startBrowserApp } from "@finesoft/front/browser";
import { createSSRApp } from "vue";
import App from "./App.vue";
import { bootstrap } from "./bootstrap";

startBrowserApp({
    bootstrap,
    mount(target, { framework }) {
        const app = createSSRApp(App, { framework });
        app.mount(target);
    },
});
```

`startBrowserApp` reads the SSR-injected `PrefetchedIntents` from the DOM, creates the `Framework`, runs the same `bootstrap()` as the server, and triggers the first page. By the time `mount()` runs the framework already has the initial `Page` ready.

Import from `@finesoft/front/browser` (not `@finesoft/front`) on the client to avoid pulling server-only modules into your client bundle.

## Root component (Vue example)

```vue
<!-- src/App.vue -->
<script setup lang="ts">
import { computed } from "vue";
import type { Framework } from "@finesoft/front";

const props = defineProps<{ framework?: Framework; page?: { title: string; items: string[] } }>();

// SSR receives `page` directly; CSR pulls the current page from the framework.
const page = computed(() => props.page ?? props.framework?.getCurrentPage());
</script>

<template>
    <main>
        <h1>{{ page?.title }}</h1>
        <ul>
            <li v-for="item in page?.items" :key="item">{{ item }}</li>
        </ul>
    </main>
</template>
```

## index.html

```html
<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <!--head-->
    </head>
    <body>
        <div id="app"><!--ssr--></div>
        <script type="module" src="/src/main.ts"></script>
    </body>
</html>
```

The `<!--head-->` and `<!--ssr-->` placeholders are where the framework injects the SSR head fragment and rendered HTML. The placeholder names are exported as `SSR_PLACEHOLDERS` if you need them.

## Run it

```bash
pnpm dev          # development with HMR
pnpm build        # production build
pnpm preview      # serve the production build locally
```

Done. You have an app that:

- Renders on the server with prefetched data
- Hydrates without an extra fetch (SSR data is reused via `PrefetchedIntents`)
- Routes client-side without page reloads
- Is ready to deploy to any of the supported adapters

## Next

- [Routing & controllers](./02-routing-and-controllers.md) — define more routes and control how they render
- [Project structure](./engineering/project-structure.md) — recommended layout once the app grows past a handful of pages
