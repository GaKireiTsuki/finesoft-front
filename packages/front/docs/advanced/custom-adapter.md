# Advanced: custom adapter

Target a platform the framework doesn't ship with. The bundled adapters are Node, Vercel, Cloudflare, Netlify, and Static. Anything else — Deno Deploy, Bun, AWS Lambda, custom on-prem — is a custom adapter.

This recipe walks through writing one end-to-end. The pattern: emit a platform-specific entry file at build time, then point that entry at the framework's SSR + proxy pipeline.

## What an adapter does

At build time:

1. Bundle the SSR entry (`src/ssr.ts`) into a single JS file with all dependencies inlined.
2. Bundle the client entry into the platform's expected shape (`dist/client/` for most).
3. Emit a **platform-specific entry** that:
    - Imports the SSR bundle
    - Receives requests in the platform's native shape (Request, Lambda event, etc.)
    - Calls `createServer({ ssrEntry, proxies })` and serves the response

The framework provides `buildBundle`, `generateSSREntry`, `copyStaticAssets`, and `prerenderRoutes` helpers in `packages/server/src/adapters/shared.ts`. Use them — they handle the heavy lifting consistently across all adapters.

## Example: Deno Deploy adapter

Deno Deploy runs ES modules with web-standard Request/Response. Workflow is similar to Cloudflare Workers but with native Deno APIs available.

### Adapter interface

```ts
// src/lib/adapters/deno-deploy.ts
import type { AdapterDefinition, AdapterContext } from "@finesoft/front";
import { buildBundle, copyStaticAssets, generateSSREntry, prerenderRoutes } from "@finesoft/front";

export const denoDeployAdapter: AdapterDefinition = {
    name: "deno-deploy",

    async build(ctx: AdapterContext): Promise<void> {
        // 1. Bundle SSR
        const ssrEntry = generateSSREntry(ctx, {
            // Deno supports native fetch / URL / Response, so no shims needed
            external: [],
        });
        await buildBundle(ctx, {
            entry: ssrEntry,
            outFile: "dist/server.js",
            format: "esm",
        });

        // 2. Copy static assets
        copyStaticAssets(ctx, "dist/client", "dist/static");

        // 3. Prerender any prerender routes
        await prerenderRoutes(ctx);

        // 4. Emit the Deno entry
        writeEntryFile(
            ctx,
            "dist/main.ts",
            `
            import { createServer } from "./server.js";
            const app = createServer({
                ssrEntry: "./server.js",
                staticDir: "./static",
            });
            Deno.serve(app.fetch);
        `,
        );
    },
};
```

### Registering

```ts
// vite.config.ts
import { finesoftFrontViteConfig } from "@finesoft/front";
import { denoDeployAdapter } from "./src/lib/adapters/deno-deploy";

export default {
    plugins: [
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.ts" },
            adapter: denoDeployAdapter,
        }),
    ],
};
```

The `adapter` option accepts either a string (built-in) or an `AdapterDefinition` (custom).

## Adapter context

The `AdapterContext` passed to `build()` exposes:

```ts
interface AdapterContext {
    root: string; // absolute path to project root
    outDir: string; // absolute path to dist directory
    ssrEntryPath: string; // resolved path to src/ssr.ts
    routes: RouteDefinition[]; // routes from bootstrap (for prerendering)
    proxies: ProxyRouteConfig[]; // proxy config from finesoftFrontViteConfig
    isr: IsrConfig | null; // ISR config if enabled
    env: Record<string, string>; // build-time env vars
}
```

You don't typically read all of these — `buildBundle` and `generateSSREntry` take what they need.

## Common patterns

### Edge runtime (Workers / Deno / Bun)

Standard Web APIs (Request, Response, fetch). Bundle as ESM, target `webworker`. Most edge runtimes accept a default-exported handler:

```ts
export default {
    async fetch(request, env) {
        return app.fetch(request, env);
    },
};
```

The Cloudflare adapter in `packages/server/src/adapters/cloudflare.ts` is the canonical reference.

### Lambda-style (AWS Lambda, GCF, Azure Functions)

Platform-specific event shapes. Convert to/from `Request`:

```ts
import { app } from "./server.js";

export const handler = async (event: APIGatewayProxyEventV2) => {
    const request = lambdaEventToRequest(event);
    const response = await app.fetch(request);
    return responseToLambdaResult(response);
};
```

Each cloud's SDK ships type definitions and helpers for the event-to-request conversion. Lift-and-shift them; don't reinvent.

### Multi-process server (Bun cluster, PM2)

Bun and modern Node support `cluster`-style multi-process serving for CPU parallelism:

```ts
import { app } from "./server.js";
import { serve } from "@hono/node-server";

const port = parseInt(process.env.PORT ?? "3000", 10);
serve({ fetch: app.fetch, port });
```

Each process is independent. The ISR cache is per-process — for a true shared cache, put a CDN in front.

## Static (no server)

`adapter: "static"` is the simplest target — everything is prerendered, nothing runs at request time.

```ts
export const staticAdapter: AdapterDefinition = {
    name: "static",
    async build(ctx) {
        // Skip SSR bundle entirely
        await prerenderRoutes(ctx); // every route must have renderMode: "prerender"
        copyStaticAssets(ctx, "dist/client", "dist/static");
        // No server entry — just the static files
    },
};
```

Verify every route is prerenderable:

```ts
if (!ctx.routes.every((r) => r.renderMode === "prerender")) {
    throw new Error("Static adapter requires every route to be renderMode: 'prerender'");
}
```

## Auto-detection extension

The built-in `"auto"` adapter checks env vars in order:

```ts
function detectAdapter(env: Record<string, string>): string {
    if (env.VERCEL === "1") return "vercel";
    if (env.CF_PAGES === "1") return "cloudflare";
    if (env.NETLIFY === "true") return "netlify";
    return "node";
}
```

If your custom adapter has a known env signature, you can wrap auto-detection yourself in your project's `vite.config.ts`:

```ts
function pickAdapter() {
    if (process.env.DENO_DEPLOYMENT_ID) return denoDeployAdapter;
    return "node";
}

finesoftFrontViteConfig({
    adapter: pickAdapter(),
});
```

## Testing the adapter

Integration test: run the build, then exercise the emitted entry:

```ts
import { describe, test, expect } from "vite-plus/test";
import { build } from "vite";
import { denoDeployAdapter } from "./deno-deploy";

describe("denoDeployAdapter", () => {
    test("emits a Deno-compatible entry", async () => {
        await build({
            root: "test/fixtures/basic",
            plugins: [
                finesoftFrontViteConfig({
                    ssr: { entry: "src/ssr.ts" },
                    adapter: denoDeployAdapter,
                }),
            ],
        });

        const entry = await readFile("test/fixtures/basic/dist/main.ts", "utf-8");
        expect(entry).toContain("Deno.serve");
        expect(entry).toContain("./server.js");
    });
});
```

Smoke test the runtime: spin up the actual platform locally and hit `/`. This catches platform-specific quirks (CORS, header normalization, body decoding) that unit tests don't.

## Gotchas

### Don't bundle Node built-ins on edge runtimes

`fs`, `path`, `http`, etc. don't exist on Workers / Deno. `generateSSREntry` accepts an `external` list — set it to the platform-incompatible modules so the bundler errors out at build time rather than the deploy crashing at request time.

### `process.env` works differently per platform

- Node, Vercel: `process.env.FOO`
- Cloudflare Workers: secrets via `env` arg to `fetch()`
- Deno: `Deno.env.get("FOO")`

The framework handles `process.env` for declared proxy auth keys, but for your own runtime env reads, wrap them in a platform-aware helper.

### File system access for assets

If you rely on reading files at request time (rare; most serve through `staticDir`), only Node-like adapters have native fs access. For edge runtimes, embed assets into the bundle or proxy through KV stores.

## Submitting upstream

If your adapter targets a popular platform that doesn't ship with the framework, consider opening a PR. Adapters live in `packages/server/src/adapters/` and follow a consistent structure — `cloudflare.ts` is the cleanest reference.

The framework's adapter API is intentionally small. Keep your contribution minimal:

- One file in `adapters/`
- One entry in `auto.ts` for auto-detection (if applicable)
- One section in this doc

## Related

- The bundled adapters: `packages/server/src/adapters/`
- The shared helpers you'll use: `packages/server/src/adapters/shared.ts`
- [Chapter 9: Server & deployment](../09-server-and-deployment.md) — what the adapters wrap
