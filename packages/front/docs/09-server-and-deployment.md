# 9. Server & deployment

The server side of the framework. This chapter covers:

- The Vite plugin (`finesoftFrontViteConfig`) — dev server, build config, code generation
- `createServer` — the standalone Hono server
- The proxy router — declarative API forwarding with SSRF / binary integrity guards
- Adapters — Node, Vercel, Cloudflare, Netlify, static

## The Vite plugin

```ts
// vite.config.ts
import { finesoftFrontViteConfig } from "@finesoft/front";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [
        // ... view layer plugin (Vue/React/Svelte)
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.ts" },
            i18n: { messagesDir: "src/locales" },
            proxies: [{ prefix: "/api", target: "https://upstream.example" }],
            adapter: "auto",
            renderModes: { "/blog/*": "prerender" },
        }),
    ],
});
```

### Options

| Option             | Type                         | Notes                                                                          |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------ |
| `ssr.entry`        | `string`                     | Path to your SSR entry (default `src/ssr.ts`).                                 |
| `i18n.messagesDir` | `string`                     | Folder with `{locale}.json` files (default off).                               |
| `proxies`          | `ProxyRouteConfig[]`         | Declarative API forwarding. See below.                                         |
| `adapter`          | `"auto" \| "node" \| ...`    | Target platform. `"auto"` detects from env vars.                               |
| `renderModes`      | `Record<string, RenderMode>` | Per-route render-mode override (glob keys); `"prerender"` enables ISR caching. |

### What it does

In dev:

- Starts a Hono server that runs your SSR entry on every request
- Hot-reloads SSR code via Vite's module graph
- Serves the proxy routes locally so client-side `fetch("/api/...")` works

In build:

- Bundles the client bundle with Vite's standard pipeline
- Bundles the SSR entry as a separate module
- Generates an adapter-specific entry file (`vercel.func`, `_worker.js`, `node-server.js`, etc.)
- Prerenders any `renderMode: "prerender"` routes to static HTML

## `createServer` — the standalone Hono server

For Node deployments and tests, the framework exports an async factory. It loads `.env`, detects the runtime, builds the Hono app, registers proxies + your `setup` routes, mounts the SSR catch-all, and **starts listening** (port from config or `PORT`, default `3000`) — then returns `{ app, vite, runtime }`:

```ts
import { createServer } from "@finesoft/front";

const { app } = await createServer({
    ssr: { ssrProductionModule: "./dist/server/ssr.js" }, // or ssrEntryPath in dev
    proxies: [{ prefix: "/api", target: "https://upstream.example" }],
    port: 3000,
});

// `app` is the started Hono instance — export it for serverless runtimes whose
// adapter imports the fetch handler (Vercel / Cloudflare / Netlify).
export { app };
```

### What it includes

- Static file serving for the client bundle
- All your proxy routes (registered via `registerProxyRoutes`)
- SSR rendering with full middleware pipeline
- ISR cache for prerendered routes
- Locale resolution from `Accept-Language`

## Proxy routes

Declarative API forwarding with built-in SSRF protection, binary-safe forwarding, and configurable auth/cache.

### Basic config

```ts
proxies: [
    {
        prefix: "/api",                    // must start with /
        target: "https://api.example.com", // must be https:// or http://
    },
],
```

Now `GET /api/users/42` → `GET https://api.example.com/users/42`. Query params and request headers are forwarded.

### Full options

```ts
{
    prefix: "/api/apple",
    target: "https://api.music.apple.com",
    methods: ["get", "post"],                          // default ["all"]
    headers: { "X-App": "finesoft" },                  // injected per request
    auth: { type: "bearer", envKey: "APPLE_TOKEN" },   // reads process.env.APPLE_TOKEN
    cache: "public, max-age=60",                       // Cache-Control on response
    followRedirects: false,                            // default false (redirect: "manual")
}
```

`auth.type`: `"bearer"` → `Authorization: Bearer <token>`. `"basic"` → `Authorization: Basic <token>`. The `envKey` is read at request time, so changing it (or unsetting it) does not require a restart.

### What the framework enforces

- **SSRF protection**: path is rejected if URL-encoded (any `%`-encoded char), starts with `//`, or contains characters outside the allowed set (`[/\w.\-~%:@!$&'()*+,;=]`). Decoded ≠ raw also rejected (prevents `%2F` smuggling).
- **Open-redirect protection**: the constructed target URL must have the same `origin` as the configured `target`. Different origin → `400 Invalid proxy target`.
- **Binary integrity**: response body forwarded via `arrayBuffer()`, not `text()` — preserves bytes exactly. PDF, image, protobuf responses are byte-identical to the upstream response.
- **Size limit**: 10 MB. `Content-Length` header is checked first for fast rejection; actual body byte length is checked after fetch.
- **HTTP warning**: any `http://` target logs a warning at startup. Use HTTPS in production.

### Generated proxy code (serverless / edge)

For serverless functions, the proxy logic is inlined into the deployed function bundle instead of relying on `registerProxyRoutes` at runtime. See [advanced/inline-proxy-codegen](./advanced/inline-proxy-codegen.md).

## Adapters

| Adapter        | Target                     | Build output                                           |
| -------------- | -------------------------- | ------------------------------------------------------ |
| `"node"`       | Standalone Node.js server  | `dist/server/index.js` — `serve({ fetch: app.fetch })` |
| `"vercel"`     | Vercel Build Output API v3 | `.vercel/output/` with `functions/` and `static/`      |
| `"cloudflare"` | Cloudflare Workers         | `dist/_worker.js` + `dist/_routes.json`                |
| `"netlify"`    | Netlify Functions v2       | `netlify/functions/` + `_redirects`                    |
| `"static"`     | Pre-rendered static files  | `dist/client/` only (no server)                        |
| `"auto"`       | Auto-detect at build time  | Picks one of the above by environment variable         |

### Auto-detection

`adapter: "auto"` checks (in order):

1. `VERCEL=1` → vercel
2. `CF_PAGES=1` → cloudflare
3. `NETLIFY=1` → netlify
4. otherwise → node

This works for most CI environments — Vercel / Cloudflare / Netlify all set these automatically during their build.

## ISR (Incremental Static Regeneration)

Mark routes `prerender` — per route (`renderMode: "prerender"`) or per glob via the Vite plugin's `renderModes` (config-level wins over route-level):

```ts
finesoftFrontViteConfig({
    ssr: { entry: "src/ssr.ts" },
    renderModes: { "/blog/*": "prerender", "/products/*": "prerender" },
});
```

A `prerender` route is served two ways:

1. **Build-time static** — the static adapter renders each prerender route at build and writes `dist/<route>.html` (one per locale when i18n is on). Served as plain static files; no controller runs at request time.
2. **Runtime cache** — the bundled server (`createServer`) and `vp preview` render a prerender route on its **first** request and store the HTML in an in-memory LRU (`ISR_CACHE_MAX = 1000` entries, evicted least-recently-used). Subsequent requests serve the cached HTML without re-running the controller.

> **No TTL, no background regeneration.** The runtime cache has no time-based expiry and no stale-while-revalidate — an entry lives until it is LRU-evicted or the process restarts. The "regenerate after N seconds" semantics live at the **CDN**, not in the framework (below). There is no `isr` config option and no programmatic invalidation API.

### Stale-while-revalidate is delegated to the CDN

Platform adapters set cache headers on prerender responses so the edge does the real ISR:

| Adapter                   | Header on prerender responses                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| Netlify                   | `Netlify-CDN-Cache-Control: max-age=3600, stale-while-revalidate=3600, durable` (true SWR) |
| Cloudflare                | `Cache-Control: public, max-age=3600`                                                      |
| Node (self-host) / Vercel | none — relies on the in-memory LRU                                                         |

The `3600`s window is a hard-coded per-adapter constant, not user-configurable. For multi-instance / multi-region deployments the CDN headers are what give you consistent caching; the in-memory LRU is per-instance single-server serving.

### Cache invalidation

There is no programmatic invalidation API. To force a refresh:

- Restart the server (clears the entire in-memory LRU)
- Redeploy (rebuilds build-time static and resets caches)
- On Netlify / Cloudflare, purge the CDN cache for the path

## Custom Hono middleware

If you need server logic outside the proxy and SSR (e.g., a webhook endpoint, a health check), register it via the `setup` hook — it runs after proxies but **before** the SSR catch-all, so your routes win:

```ts
await createServer({
    ssr: { ssrProductionModule: "./dist/server/ssr.js" },
    setup: (app) => {
        app.get("/health", (c) => c.json({ status: "ok" }));
        app.post("/webhook", async (c) => {
            const body = await c.req.json();
            await handleWebhook(body);
            return c.json({ ok: true });
        });
    },
});
```

## Environment variables

The framework reads:

- `NODE_ENV` — `"production"` enables prod-only optimizations
- `PROXY_TOKEN` / `BASIC_TOKEN` / any `auth.envKey` — proxy auth secrets
- `VERCEL`, `CF_PAGES`, `NETLIFY` — adapter auto-detection

Anything else is yours. Access via `process.env` directly or by registering a config object in the DI container:

```ts
framework.container.register("config", () => ({
    upstreamUrl: process.env.UPSTREAM_URL ?? "https://api.example.com",
    sessionSecret: requireEnv("SESSION_SECRET"),
}));
```

## Health checks and graceful shutdown

For Node deployments behind a load balancer:

```ts
await createServer({
    ssr: { ssrProductionModule: "./dist/server/ssr.js" },
    setup: (app) => app.get("/health", (c) => c.json({ ok: true })),
});

// createServer starts the listener itself — no manual serve() needed.
process.on("SIGTERM", () => process.exit(0));
```

`createServer` does not return the underlying `http.Server`, so there's no built-in `server.close()` connection-drain. If you need graceful draining — or a handle to call `framework.dispose()` (recursively disposes the container, calls `destroy()` on recorders/loggers, unregisters routes) on shutdown — compose the lower level instead: build the Hono app and own framework yourself and `serve()` it so you keep both handles.

## Next

- [Features, platform, PWA](./10-features-platform-pwa.md) — feature flags, platform detection
- [Engineering: CI & release flow](./engineering/ci-release-flow.md) — automating releases
- [Pitfalls: proxy binary payloads](./pitfalls/proxy-binary-payloads.md) — why `arrayBuffer` matters
