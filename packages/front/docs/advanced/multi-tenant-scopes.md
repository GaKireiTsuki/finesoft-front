# Advanced: multi-tenant scopes

A multi-tenant app serves multiple customers from one deployment, but each customer's request must see their own:

- Database connection / API client
- Logger / metrics tagged with the tenant
- Feature flags / pricing / branding
- Cached translations / content

The DI container's child scopes are the right primitive. This recipe shows how to wire per-tenant isolation through a `beforeLoad` guard.

## Mental model

```
Framework
  └── parent Container        ← shared services (HTTP pool, base recorder, ...)
      └── per-request scope   ← framework creates this for every SSR request
          ↑
          └── tenant overrides registered by a beforeLoad guard
```

The per-request scope is created by the framework automatically. Your guard registers tenant-specific overrides on top. Anything you don't override falls through to the parent.

## Step 1: identify the tenant

This is your business logic. Common sources:

- **Subdomain**: `acme.myapp.com` → `acme`
- **Path prefix**: `/t/acme/...` → `acme`
- **Header**: `X-Tenant-Id: acme`
- **Authenticated user**: cookie → session → tenant

```ts
// src/lib/tenants/resolve.ts
import type { NavigationContext } from "@finesoft/front";

export function resolveTenant(ctx: NavigationContext): string | null {
    const host = ctx.url.hostname;
    const sub = host.split(".")[0];
    if (sub && sub !== "www" && sub !== "myapp") return sub;
    return null;
}
```

## Step 2: load tenant config

```ts
// src/lib/tenants/config.ts
export interface TenantConfig {
    tenantId: string;
    displayName: string;
    upstreamUrl: string;
    apiToken: string;
    featureFlags: Record<string, unknown>;
    locale: string;
}

const cache = new Map<string, TenantConfig>();

export async function getTenantConfig(tenantId: string): Promise<TenantConfig | null> {
    if (cache.has(tenantId)) return cache.get(tenantId)!;

    // Load from your config store — file, DB, KV
    const config = await loadFromStore(tenantId);
    if (!config) return null;

    cache.set(tenantId, config);
    return config;
}
```

A real implementation would have cache invalidation on config updates. For most apps, refresh on a timer or via a webhook is enough.

## Step 3: register tenant services in a guard

```ts
// src/lib/guards/tenant.ts
import { deny, next, type NavigationContext, DEP_KEYS } from "@finesoft/front";
import { resolveTenant } from "../tenants/resolve";
import { getTenantConfig } from "../tenants/config";
import { UserApi } from "../api/user";
import { WithFieldsRecorder } from "@finesoft/front";

export async function tenantGuard(ctx: NavigationContext) {
    const tenantId = resolveTenant(ctx);
    if (!tenantId) return deny(404, "Unknown tenant");

    const config = await getTenantConfig(tenantId);
    if (!config) return deny(404, "Tenant not found");

    // Register tenant-specific services on the request scope
    const scope = ctx.container;
    scope.register("tenantConfig", () => config);

    scope.register(
        "userApi",
        () =>
            new UserApi({
                baseUrl: config.upstreamUrl,
                defaultHeaders: { Authorization: `Bearer ${config.apiToken}` },
            }),
    );

    scope.register(DEP_KEYS.FEATURE_FLAGS, () => ({
        get: (key, fallback) => config.featureFlags[key] ?? fallback,
    }));

    // Decorate the parent's recorder with tenant context
    const baseRecorder = scope.parent!.resolve(DEP_KEYS.EVENT_RECORDER);
    scope.register(
        DEP_KEYS.EVENT_RECORDER,
        () => new WithFieldsRecorder(baseRecorder, [{ getFields: () => ({ tenantId }) }]),
    );

    return next();
}
```

Key insights:

- **The scope is already created by the framework.** You register on `ctx.container` — that's the request scope.
- **Fall-through is automatic.** Anything not registered here resolves from the parent container.
- **Decorate, don't replace.** The recorder is wrapped with tenant fields rather than replaced — base behavior (HTTP transmission, batching) stays in place.

## Step 4: install the guard globally

```ts
// src/bootstrap.ts
import { type Framework, defineRoutes } from "@finesoft/front";
import { tenantGuard } from "./lib/guards/tenant";
// ... other imports

export function bootstrap(framework: Framework): void {
    framework.middleware.use("beforeLoad", tenantGuard);

    defineRoutes(framework, [
        { path: "/", intentId: "home", controller: new HomeController() },
        { path: "/billing", intentId: "billing", controller: new BillingController() },
        // ...
    ]);
}
```

`tenantGuard` runs before any route-specific guard, so by the time any controller executes, the tenant scope is set up.

## Step 5: controllers transparently get the right services

```ts
// src/controllers/billing.ts
export class BillingController extends BaseController<{}, BillingPage> {
    readonly intentId = "billing";

    async execute(_params, container) {
        const config = container.resolve<TenantConfig>("tenantConfig");
        const api = container.resolve<UserApi>("userApi"); // tenant-specific client

        const usage = await api.getUsage();
        const invoices = await api.getInvoices();

        return {
            kind: "billing",
            tenantName: config.displayName,
            usage,
            invoices,
        };
    }
}
```

The controller doesn't know about tenants — it just resolves `userApi` and gets the right one for this request.

## Cross-tenant prohibitions

To prevent a user authenticated for tenant A from accessing tenant B's data:

```ts
async function sameTenantGuard(ctx: NavigationContext) {
    const session = await ctx.container.resolve<SessionService>("session").current();
    const requestedTenant = ctx.container.resolve<TenantConfig>("tenantConfig").tenantId;

    if (!session) return redirect("/login");
    if (session.tenantId !== requestedTenant) return deny(403, "Cross-tenant access forbidden");

    return next();
}

// Apply after tenantGuard:
framework.middleware.use("beforeLoad", tenantGuard);
framework.middleware.use("beforeLoad", sameTenantGuard);
```

Guard order matters — `tenantGuard` must register `tenantConfig` before `sameTenantGuard` reads it.

## Hydration considerations

Tenant configs include `featureFlags`, which are read on both server and client. The framework's `PrefetchedIntents` serialization handles this — the browser receives the same flag values the server saw, so client-side reads stay consistent.

Tenant config itself is **not** automatically serialized. If your view needs to display `tenantConfig.displayName`, the controller should include it in the `Page` object:

```ts
async execute(_params, container) {
    const config = container.resolve<TenantConfig>("tenantConfig");
    return {
        kind: "home",
        tenant: {
            id: config.tenantId,
            displayName: config.displayName,
        },
        // ...
    };
}
```

The `Page` is serialized, so it survives the SSR → CSR boundary. The full `TenantConfig` (with secrets) should never end up in a `Page`.

## Browser-side considerations

`tenantGuard` runs on the browser too — on initial navigation and on every subsequent navigation. For browser-only apps (`renderMode: "csr"`), this is the only time it runs.

But the browser can't safely resolve secrets like `apiToken`. Two approaches:

**Approach 1: server proxies all API calls.** The browser hits `/api/users` (your proxy), which forwards to `${upstreamUrl}/users` with the auth header injected from `process.env[apiTokenEnvKey]`. The browser never sees the token.

**Approach 2: short-lived session token.** The server issues a JWT scoped to the tenant; the browser uses it for direct upstream calls. Token rotation handled by your auth layer.

Most apps go with approach 1. The framework's proxy router is designed for it.

## Caveats

### Don't cache tenant scopes across requests

```ts
// BAD
const tenantScopeCache = new Map<string, Container>();

async function tenantGuard(ctx) {
    let scope = tenantScopeCache.get(tenantId);
    if (!scope) {
        scope = framework.container.createScope();
        tenantScopeCache.set(tenantId, scope);
    }
    // Use scope...
}
```

Each request needs its own scope — even for the same tenant — because:

- Other guards add request-specific overrides (auth, trace id) that shouldn't leak across requests
- The scope holds resolved instances of stateful services; sharing them across requests breaks isolation

Tenant **config** can be cached. Tenant **scope** cannot.

### Be careful with shared service instances

If you cache the `UserApi` instance at module level instead of registering a factory, all requests share state:

```ts
// BAD
const apiByTenant = new Map<string, UserApi>();
scope.register("userApi", () => {
    let api = apiByTenant.get(tenantId);
    if (!api) {
        api = new UserApi({ baseUrl: config.upstreamUrl });
        apiByTenant.set(tenantId, api);
    }
    return api;
});
```

If `UserApi` has any request-scoped state (interceptors that capture closures over request-specific values), they'll bleed across tenants. Register a fresh factory; let the container cache it per scope.

## Testing

```ts
import { describe, test, expect, vi, afterEach } from "vite-plus/test";
import { Container } from "@finesoft/front";
import { tenantGuard } from "./tenant";

afterEach(() => vi.restoreAllMocks());

describe("tenantGuard", () => {
    test("registers tenant services for known tenant", async () => {
        const parent = new Container();
        const scope = parent.createScope();

        vi.spyOn(await import("../tenants/config"), "getTenantConfig").mockResolvedValue({
            tenantId: "acme",
            displayName: "Acme Co",
            upstreamUrl: "https://acme.example",
            apiToken: "token-123",
            featureFlags: { darkMode: true },
            locale: "en-US",
        });

        const ctx = {
            url: new URL("https://acme.myapp.com/"),
            container: scope,
            intent: { intentId: "home", params: {} },
            getCookie: () => null,
            getHeader: () => null,
            isSsr: true,
        };

        const result = await tenantGuard(ctx as any);

        expect(result).toEqual({ kind: "next" });
        expect(scope.resolve("tenantConfig")).toMatchObject({ tenantId: "acme" });
    });

    test("denies unknown tenant", async () => {
        const ctx = {
            url: new URL("https://unknown.myapp.com/"),
            container: new Container(),
            intent: { intentId: "home", params: {} },
            getCookie: () => null,
            getHeader: () => null,
            isSsr: true,
        };

        const result = await tenantGuard(ctx as any);
        expect(result).toMatchObject({ kind: "deny", status: 404 });
    });
});
```

## Related

- [Chapter 7: DI container](../07-di-container.md) — scopes and fallback resolution
- [Chapter 3: Middleware](../03-middleware.md) — global guards
- [Pitfall: container scope leak](../pitfalls/container-scope-leak.md) — what goes wrong if you cache scopes
