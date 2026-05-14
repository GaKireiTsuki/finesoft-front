# 高阶：多租户 scope

多租户应用一份部署服务多个客户，每个客户的请求要看到自己的：

- 数据库连接 / API 客户端
- 带租户 tag 的 logger / 指标
- Feature flag / 价格 / 品牌
- 缓存的翻译 / 内容

DI 容器的子 scope 是正确的原语。本配方展示通过 `beforeLoad` 守卫接通按租户隔离。

## 心智模型

```
Framework
  └── 父 Container        ← 共享服务（HTTP 池、基础 recorder、...）
      └── 每个请求 scope  ← 框架为每个 SSR 请求创建
          ↑
          └── 一个 beforeLoad 守卫注册的租户覆盖
```

每请求 scope 由框架自动创建。你的守卫在它之上注册租户级覆盖。你没覆盖的东西都回退到父。

## 步骤 1：识别租户

这是你的业务逻辑。常见来源：

- **子域**：`acme.myapp.com` → `acme`
- **路径前缀**：`/t/acme/...` → `acme`
- **头**：`X-Tenant-Id: acme`
- **鉴权用户**：cookie → session → tenant

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

## 步骤 2:加载租户配置

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

    // 从配置存储读 —— 文件、DB、KV
    const config = await loadFromStore(tenantId);
    if (!config) return null;

    cache.set(tenantId, config);
    return config;
}
```

真实实现要在配置更新时让缓存失效。多数应用按定时器刷或通过 webhook 即可。

## 步骤 3：在守卫里注册租户服务

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

    // 在请求 scope 上注册租户专属服务
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

    // 用租户上下文装饰父的 recorder
    const baseRecorder = scope.parent!.resolve(DEP_KEYS.EVENT_RECORDER);
    scope.register(
        DEP_KEYS.EVENT_RECORDER,
        () => new WithFieldsRecorder(baseRecorder, [{ getFields: () => ({ tenantId }) }]),
    );

    return next();
}
```

要点：

- **scope 已经由框架创建。** 你在 `ctx.container` 上注册 —— 那就是请求 scope。
- **回退自动。** 这里没注册的会从父容器 resolve。
- **装饰而不替换。** recorder 用租户字段包起来而不是替换 —— 基础行为（HTTP 传输、批处理）保持原样。

## 步骤 4：全局安装守卫

```ts
// src/bootstrap.ts
import { type Framework, defineRoutes } from "@finesoft/front";
import { tenantGuard } from "./lib/guards/tenant";
// ... 其他 import

export function bootstrap(framework: Framework): void {
    framework.middleware.use("beforeLoad", tenantGuard);

    defineRoutes(framework, [
        { path: "/", intentId: "home", controller: new HomeController() },
        { path: "/billing", intentId: "billing", controller: new BillingController() },
        // ...
    ]);
}
```

`tenantGuard` 在任何路由级守卫之前跑，所以任何 Controller 跑时租户 scope 都已经设好。

## 步骤 5：Controller 透明地拿到正确的服务

```ts
// src/controllers/billing.ts
export class BillingController extends BaseController<{}, BillingPage> {
    readonly intentId = "billing";

    async execute(_params, container) {
        const config = container.resolve<TenantConfig>("tenantConfig");
        const api = container.resolve<UserApi>("userApi"); // 租户专属客户端

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

Controller 不知道租户存在 —— 它只 resolve `userApi`，拿到本请求对应的那个。

## 跨租户禁止

防 A 租户认证的用户访问 B 租户数据：

```ts
async function sameTenantGuard(ctx: NavigationContext) {
    const session = await ctx.container.resolve<SessionService>("session").current();
    const requestedTenant = ctx.container.resolve<TenantConfig>("tenantConfig").tenantId;

    if (!session) return redirect("/login");
    if (session.tenantId !== requestedTenant) return deny(403, "Cross-tenant access forbidden");

    return next();
}

// 在 tenantGuard 之后应用：
framework.middleware.use("beforeLoad", tenantGuard);
framework.middleware.use("beforeLoad", sameTenantGuard);
```

守卫顺序重要 —— `tenantGuard` 必须先注册 `tenantConfig`，`sameTenantGuard` 才能读到。

## Hydration 考虑

租户配置含 `featureFlags`，两端都读。框架的 `PrefetchedIntents` 序列化处理这个 —— 浏览器拿到服务端看到的同样 flag 值，所以客户端读保持一致。

租户配置本身**不**自动序列化。view 要显示 `tenantConfig.displayName` 的话，Controller 应该把它放进 `Page`：

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

`Page` 被序列化所以能跨 SSR → CSR 边界。完整 `TenantConfig`（含秘密）永不应该出现在 `Page` 里。

## 浏览器端考虑

`tenantGuard` 在浏览器也跑 —— 首次导航和每次后续导航。仅浏览器应用（`renderMode: "csr"`）只在这跑。

但浏览器不能安全地 resolve `apiToken` 这种秘密。两种方法：

**方法 1：服务器代理所有 API 调用。** 浏览器打 `/api/users`（你的 proxy），它转发到 `${upstreamUrl}/users` 并从 `process.env[apiTokenEnvKey]` 注入 auth 头。浏览器从不见 token。

**方法 2：短期 session token。** 服务器颁发 scope 到租户的 JWT；浏览器用它直接调上游。token 轮换由你的 auth 层处理。

多数应用走方法 1。框架的 proxy router 就是为这个设计的。

## 注意事项

### 别跨请求缓存租户 scope

```ts
// 不好
const tenantScopeCache = new Map<string, Container>();

async function tenantGuard(ctx) {
    let scope = tenantScopeCache.get(tenantId);
    if (!scope) {
        scope = framework.container.createScope();
        tenantScopeCache.set(tenantId, scope);
    }
    // 用 scope...
}
```

每个请求需要自己的 scope —— 即使同租户 —— 因为：

- 其他守卫加请求专属覆盖（auth、trace id），不该跨请求泄漏
- scope 持有有状态服务的 resolve 实例；跨请求共享破坏隔离

租户**配置**可以缓存。租户**scope**不行。

### 共享服务实例要小心

把 `UserApi` 实例缓存到模块级而不是注册工厂，所有请求共享状态：

```ts
// 不好
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

`UserApi` 有任何请求级状态（捕获请求专属值的拦截器闭包）就跨租户泄。注册新鲜工厂；让容器按 scope 缓存。

## 测试

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

## 参考

- [第 7 章：DI 容器](../07-di-container.md) —— scope 和回退 resolve
- [第 3 章：中间件](../03-middleware.md) —— 全局守卫
- [陷阱：container scope 泄漏](../pitfalls/container-scope-leak.md) —— 缓存 scope 会出什么问题
