# Advanced: inline proxy codegen

For serverless and edge deployments where you want proxy logic inlined into the function bundle — no runtime call to `registerProxyRoutes`, no extra dependencies — the framework exposes `generateProxyCode`.

## Use case

You're deploying to Cloudflare Workers / Vercel Edge / AWS Lambda@Edge. Each function has:

- Tight cold-start budget
- Cold-bundle-size budget (Workers: 1 MB compressed)
- No `process.env` in some runtimes

Importing the proxy router and its support files (validators, Hono integration) adds bytes. `generateProxyCode` emits **only** the lines you need for the routes you declared. The output is self-contained: a few `app.get(...)` / `app.all(...)` calls plus a single `_sanitizeProxyPath` helper.

## Generated output

Given this input:

```ts
import { generateProxyCode } from "@finesoft/front";

const code = generateProxyCode([
    {
        prefix: "/api",
        target: "https://upstream.example",
        headers: { "X-App": "myapp" },
        auth: { type: "bearer", envKey: "API_TOKEN" },
        cache: "max-age=60",
    },
]);

console.log(code);
```

You get something like:

```js
// ─── 框架声明式代理路由 ───
function _sanitizeProxyPath(raw) {
    if (raw.length > 2048) return null;
    try {
        if (decodeURIComponent(raw) !== raw) return null;
    } catch {
        return null;
    }
    if (raw.startsWith("//")) return null;
    if (!/^[/\w.\-~%:@!$&'()*+,;=]*$/.test(raw)) return null;
    return raw.startsWith("/") ? raw : "/" + raw;
}

app.all("/api/*", async (c) => {
    const _sub = _sanitizeProxyPath(c.req.path.replace("/api", ""));
    if (!_sub) return c.text("Invalid path", 400);
    const _target = new URL(_sub, "https://upstream.example");
    if (_target.origin !== "https://upstream.example") return c.text("Invalid proxy target", 400);
    const _reqUrl = new URL(c.req.url);
    _reqUrl.searchParams.forEach((v, k) => _target.searchParams.set(k, v));
    const _headers = { "X-App": "myapp" };
    const _token =
        (typeof process !== "undefined" && process.env && process.env["API_TOKEN"]) || "";
    if (_token) _headers.Authorization = "Bearer " + _token;
    try {
        const _resp = await fetch(_target.toString(), { headers: _headers, redirect: "manual" });
        const _cl = _resp.headers.get("Content-Length");
        if (_cl && parseInt(_cl, 10) > 10485760) {
            return c.text("Proxy response too large", 502);
        }
        const _body = await _resp.arrayBuffer();
        if (_body.byteLength > 10485760) {
            return c.text("Proxy response too large", 502);
        }
        const _rh = { "Content-Type": _resp.headers.get("Content-Type") || "application/json" };
        if ("max-age=60") _rh["Cache-Control"] = "max-age=60";
        return c.newResponse(_body, _resp.status, _rh);
    } catch (_e) {
        console.error("[Proxy /api]", _e);
        return c.json({ error: "Proxy request failed" }, 502);
    }
});
```

Everything is inline. No imports from `@finesoft/front` for the proxy path. Drop this into your function bundle alongside the SSR entry.

## When to use codegen vs runtime registration

| Concern                                   | Runtime (`registerProxyRoutes`) | Codegen (`generateProxyCode`)               |
| ----------------------------------------- | ------------------------------- | ------------------------------------------- |
| Long-lived server (Node, Workers)         | ✅ preferred                    | ✅ also fine                                |
| Tiny edge functions (Lambda@Edge)         | Heavier import                  | ✅ minimal                                  |
| Need to update routes without redeploying | ✅ change config, restart       | ❌ redeploy required                        |
| Config from a remote service              | ✅ supported                    | ❌ codegen runs at build time               |
| Multiple proxies sharing helpers          | ✅ shared at runtime            | Code duplication unless you dedupe yourself |

Use codegen specifically when bundle size matters. For most deployments, the runtime path is fine.

## Build-time integration

A typical setup:

```ts
// scripts/build-proxy.mjs
import { generateProxyCode } from "@finesoft/front";
import { writeFile } from "node:fs/promises";

const code = generateProxyCode([
    { prefix: "/api/users", target: "https://users.internal" },
    { prefix: "/api/products", target: "https://products.internal", cache: "max-age=30" },
    {
        prefix: "/api/orders",
        target: "https://orders.internal",
        auth: { type: "bearer", envKey: "ORDERS_TOKEN" },
    },
]);

const wrapper = `
import { Hono } from "hono";
const app = new Hono();

${code}

export default app;
`;

await writeFile("dist/proxy.js", wrapper, "utf8");
```

Then import `./proxy.js` from your serverless function entry:

```ts
// dist/main.ts (for Cloudflare Worker)
import proxyApp from "./proxy.js";
import ssrApp from "./ssr-bundle.js";

const app = new Hono();
app.route("/", proxyApp);
app.route("/", ssrApp);

export default app;
```

## What the generated code does for you

The generated handler enforces the same guarantees as the runtime path:

- **SSRF protection**: path validation rejects encoded chars, `//` prefix, non-allowed characters
- **Open-redirect protection**: `target.origin` must match the configured target's origin
- **10 MB response size limit**: `Content-Length` fast-reject + `byteLength` actual-bytes check
- **Binary integrity**: `arrayBuffer()` forwarding (no UTF-8 decoding)
- **Auth from env**: reads `process.env[envKey]` at request time

The framework's test suite asserts **parity** between runtime and generated code with these checks:

```ts
// packages/server/test/proxy.test.ts
test("generated proxy code embeds the same response size limit as runtime (parity)", () => {
    const code = generateProxyCode([{ prefix: "/api", target: "https://upstream.example" }]);

    const MAX = String(10 * 1024 * 1024);
    expect(code).toContain(`parseInt(_cl, 10) > ${MAX}`);
    expect(code).toContain(`_body.byteLength > ${MAX}`);
});
```

If you patch the runtime path's size limit, the generated code's limit is updated in lockstep.

## Caveats

### `process.env` may not exist

The generated code guards with `typeof process !== "undefined"`. On runtimes without `process` (some edge environments), the auth header is simply not added — the upstream sees no auth.

For platforms like Cloudflare Workers that inject env via function args instead of `process.env`, you'll need to either:

- Wrap the generated code to inject the auth header from the worker's env arg
- Replace the auth section after generation with the platform-appropriate access

### No retries, no breakers

The generated handler does one `fetch` and bubbles failures up as `502 Proxy request failed`. For retry / breaker logic, write your own proxy code — `generateProxyCode` is intentionally minimal.

### Multiple proxies share helper code

`_sanitizeProxyPath` is emitted once at the top of the generated string. Multiple `app.all` calls share it. If you `generateProxyCode` separately for each route and concatenate, you'll get the helper repeated — call it once with all routes.

### Validation at generation time

`generateProxyCode` runs the same `validateConfig` as `registerProxyRoutes`. Invalid configs throw at build time:

```ts
generateProxyCode([{ prefix: "/api", target: "file:///etc/passwd" }]);
// Error: [proxy] target must start with "https://" or "http://": "file:///etc/passwd"
```

This catches config errors before the deploy ships.

## Related

- [Chapter 9: Server & deployment — proxy routes](../09-server-and-deployment.md#proxy-routes)
- The implementation: `packages/server/src/proxy.ts`
- The parity test: `packages/server/test/proxy.test.ts`
