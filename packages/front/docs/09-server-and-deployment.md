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
            isr: { routes: ["/blog/*"], ttl: 300 },
        }),
    ],
});
```

### Options

| Option             | Type                      | Notes                                                   |
| ------------------ | ------------------------- | ------------------------------------------------------- |
| `ssr.entry`        | `string`                  | Path to your SSR entry (default `src/ssr.ts`).          |
| `i18n.messagesDir` | `string`                  | Folder with `{locale}.json` files (default off).        |
| `proxies`          | `ProxyRouteConfig[]`      | Declarative API forwarding. See below.                  |
| `adapter`          | `"auto" \| "node" \| ...` | Target platform. `"auto"` detects from env vars.        |
| `isr`              | `{ routes, ttl }`         | Incremental Static Regeneration for prerendered routes. |

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

For Node deployments and tests, the framework exports a function that gives you a ready-to-run Hono app:

```ts
import { createServer } from "@finesoft/front";

const app = createServer({
    ssrEntry: "./dist/server/ssr.js",
    proxies: [{ prefix: "/api", target: "https://upstream.example" }],
    staticDir: "./dist/client",
    isr: { routes: ["/blog/*"], ttl: 300 },
});

// app is a Hono instance — mount it however your runtime expects
import { serve } from "@hono/node-server";
serve({ fetch: app.fetch, port: 3000 });
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

```ts
isr: {
    routes: ["/blog/*", "/products/*"],
    ttl: 300,  // seconds
}
```

How it works:

1. First request to `/blog/hello-world`: render fully, cache the HTML, set expiry to now + 300s
2. Subsequent requests within TTL: serve cached HTML directly
3. After expiry: next request triggers re-render; concurrent requests get stale HTML until re-render finishes

The cache is in-memory per server instance. For multi-instance deployments where consistency matters, put a CDN in front and use HTTP `Cache-Control` headers instead.

Routes not matched by `isr.routes` always render fresh.

### Cache invalidation

Programmatic invalidation is not exposed in the public API. To force a refresh:

- Restart the server (loses entire cache)
- Wait for TTL
- Add a cache-busting query param the controller can ignore but that bypasses the cache key

For production, push invalidation up to CDN level — the framework's in-memory cache is for single-instance serving.

## Custom Hono middleware

If you need server logic outside the proxy and SSR (e.g., a webhook endpoint, a health check), mount it on the same Hono app:

```ts
const app = createServer({ ssrEntry: "./dist/server/ssr.js" });

app.get("/health", (c) => c.json({ status: "ok" }));
app.post("/webhook", async (c) => {
    const body = await c.req.json();
    await handleWebhook(body);
    return c.json({ ok: true });
});

// SSR catch-all is registered last by createServer — your routes win.
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
import { serve } from "@hono/node-server";

const app = createServer({
    /* ... */
});
app.get("/health", (c) => c.json({ ok: true }));

const server = serve({ fetch: app.fetch, port: 3000 });

process.on("SIGTERM", () => {
    server.close(() => {
        // dispose Framework if you held a reference
        framework.dispose();
        process.exit(0);
    });
});
```

`framework.dispose()` recursively disposes the container, calls `destroy()` on registered recorders/loggers, and unregisters all routes.

## Next

- [Features, platform, PWA](./10-features-platform-pwa.md) — feature flags, platform detection
- [Engineering: CI & release flow](./engineering/ci-release-flow.md) — automating releases
- [Pitfalls: proxy binary payloads](./pitfalls/proxy-binary-payloads.md) — why `arrayBuffer` matters
