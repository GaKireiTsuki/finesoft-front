# 7. DI 容器

框架用一个小型的依赖注入容器，支持父子 scope。它存在的两个理由：

1. **服务端请求隔离** —— 每个 SSR 请求拿到自己的 scope，请求级状态（鉴权、request id）不跨请求泄漏。
2. **解耦测试** —— Controller 从容器里 resolve 依赖，测试时可以任意 swap。

容器有意保持很小。没有装饰器、没有注解、没有自动装配。注册工厂，按 key resolve。

## 注册

```ts
import { Container } from "@finesoft/front";

const container = new Container();

container.register("userApi", () => new UserApi({ baseUrl: "/api" }));
container.register("logger", () => new ConsoleLogger());
```

工厂默认**每个容器调用一次**。结果被缓存。

要每次 resolve 都重新构造（非单例）：

```ts
container.register("requestId", () => crypto.randomUUID(), false);
container.resolve("requestId"); // 每次都是新 id
```

## Resolve

```ts
const api = container.resolve<UserApi>("userApi");
const logger = container.resolve<Logger>("logger");
```

泛型参数只对 TypeScript 生效 —— 运行时无类型检查。

Resolve 未注册的 key 会抛错：

```ts
container.resolve("missing"); // Error: Dependency "missing" not registered
```

## Scope —— 核心特性

```ts
const requestScope = framework.container.createScope();
requestScope.register("currentUser", () => loadUserFromSession(request));

// scope 里没有的 key 回退到父容器：
requestScope.resolve("userApi"); // 父
requestScope.resolve("currentUser"); // scope

requestScope.dispose();
```

子 scope：

- **继承**所有父 key（resolve 时回退）
- **覆盖**任意 key（注册自己的工厂）
- `dispose()` 时**清理** —— 子 scope 递归 dispose；自己从父的 children 集合移除

框架自动按 SSR 请求创建请求级容器，传给守卫和 Controller（作为 `ctx.container` / `execute()` 的第二个参数）。普通请求处理不需要你手动创建 scope。

## 什么时候自己开 scope

- 多租户应用，每个租户有自己的配置 / API 客户端（详见 [advanced/multi-tenant-scopes](./advanced/multi-tenant-scopes.md)）
- 长跑操作需要自己的短期依赖
- 测试时想在基础容器上叠加 override

## Dispose 和泄漏

```ts
const scope = container.createScope();
// ... 使用 scope ...
scope.dispose();
```

`dispose()`：

1. 递归 dispose 任何未完成的子 scope
2. 对工厂结果实现了 `destroy()` 的对象调用（logger、recorder）
3. 自己从父的 children 集合移除
4. 幂等 —— 调用两次安全

**不 dispose 一个 scope 会泄漏里面每一个缓存值。** 请求 scope 活过响应就会持有：

- HTTP 客户端（以及它们待发的请求状态）
- Logger / recorder
- Controller 在里面 resolve 过的任何东西

框架处理它创建的请求 scope 的 dispose。**你**自己创建的 scope 你自己 dispose。

忘记 dispose 的症状，见 [陷阱：container scope 泄漏](./pitfalls/container-scope-leak.md)。

## 标准 DI key

用 `DEP_KEYS` 常量而不是字符串字面量，能在类型检查时抓到拼写错误：

```ts
import { DEP_KEYS } from "@finesoft/front";

container.register(DEP_KEYS.LOGGER, () => new ConsoleLogger());
container.register(DEP_KEYS.EVENT_RECORDER, () => myRecorder);

const logger = container.resolve(DEP_KEYS.LOGGER);
```

常量列表：

| Key                       | 标准类型           | 用于                                  |
| ------------------------- | ------------------ | ------------------------------------- |
| `DEP_KEYS.LOGGER`         | `Logger`           | 框架日志                              |
| `DEP_KEYS.LOGGER_FACTORY` | `LoggerFactory`    | 分类 logger（`logger.scope("auth")`） |
| `DEP_KEYS.NET`            | `Net`              | 网络状态检查（离线 / 计费网络）       |
| `DEP_KEYS.STORAGE`        | `Storage`          | KV 持久化（localStorage / 内存）      |
| `DEP_KEYS.FEATURE_FLAGS`  | `FeatureFlags`     | Feature flag 读取                     |
| `DEP_KEYS.METRICS`        | `MetricsClient`    | 计数器 / gauge / 计时                 |
| `DEP_KEYS.FETCH`          | `typeof fetch`     | `HttpClient` 底层 fetch（可 mock）    |
| `DEP_KEYS.EVENT_RECORDER` | `EventRecorder`    | 结构化事件记录                        |
| `DEP_KEYS.LOCALE`         | `LocaleAttributes` | 解析出的 locale（lang + dir）         |
| `DEP_KEYS.PLATFORM`       | `PlatformInfo`     | 检测到的 user-agent 平台信息          |
| `DEP_KEYS.TRANSLATOR`     | `Translator`       | 翻译函数                              |

框架在 `Framework.create()` 期间为这些 key 注册默认实现。要覆盖就在 framework 创建后再注册：

```ts
const framework = Framework.create({
    /* ... */
});
framework.container.register(DEP_KEYS.LOGGER, () => myCustomLogger);
```

## 自定义 key

你自己的服务直接用字符串 key：

```ts
container.register("userApi", () => new UserApi({ baseUrl: "/api" }));
container.register("session", () => new SessionService());
container.register("featureBucketing", () => new BucketingService());
```

想让自己的 key 有类型安全，定义自己的常量 map：

```ts
// src/lib/di-keys.ts
export const APP_KEYS = {
    USER_API: "userApi",
    SESSION: "session",
    FEATURE_BUCKETING: "featureBucketing",
} as const;

// 使用
container.register(APP_KEYS.USER_API, () => new UserApi({ baseUrl: "/api" }));
const api = container.resolve<UserApi>(APP_KEYS.USER_API);
```

## 生命周期顺序

```
Framework.create({ ... })
    │
    ▼
默认 DEP_KEYS 注册（logger、locale、platform、...）
    │
    ▼
你的自定义注册（在 onBeforeStart 或 bootstrap 里）
    │
    ▼
─── 每个请求 ──────────────────────────────────
framework.container.createScope()      ← 请求 scope
    │
    ▼
beforeLoad 守卫（ctx.container = scope）
    │
    ▼
controller.execute(params, scope)
    │
    ▼
afterLoad 守卫（ctx.container = scope）
    │
    ▼
renderApp() / response
    │
    ▼
scope.dispose()                        ← 框架清理
```

## 在测试中使用容器

按 scope 层注入 mock：

```ts
import { Framework } from "@finesoft/front";

const framework = Framework.create({
    /* ... */
});
const testScope = framework.container.createScope();
testScope.register("userApi", () => mockUserApi);

const controller = new UserListController();
const page = await controller.execute({}, testScope);

testScope.dispose();
```

完整模式见 [工程实践 · 测试](./engineering/testing.md)。

## 反模式

### 别在模块顶层 resolve

```ts
// 不好 —— import 时跑，在 framework.create() 之前
const logger = container.resolve(DEP_KEYS.LOGGER);
export function log(msg: string) {
    logger.info(msg);
}
```

这里能拿到的 `container` 不是请求 scope；你拿到的是父容器，丢失请求隔离。

正确做法是在能访问 scope 的函数里 resolve：

```ts
export function logFromController(container: Container, msg: string) {
    container.resolve<Logger>(DEP_KEYS.LOGGER).info(msg);
}
```

### dispose 后别留 scoped 实例的引用

```ts
// 不好
let api: UserApi;
beforeLoad: (ctx) => {
    api = ctx.container.resolve("userApi");
    return next();
};
// `api` 现在指向一个 scope 已 dispose 的实例
```

如果你需要跨请求共享状态，注册到父容器，不是请求 scope。

### 别在守卫里注册

```ts
// 不好 —— 每个请求都跑
beforeLoad: (ctx) => {
    ctx.container.register("userApi", () => new UserApi(/*...*/));
    return next();
};
```

每次请求都新建一个工厂闭包。在 framework 启动时注册一次；scope 会继承。

## 下一步

- [可观测性](./08-observability.md) —— 通过 DI 接 Logger / EventRecorder / ReportCallback
- [工程实践：测试](./engineering/testing.md) —— 用 scope 隔离测试
- [陷阱：container scope 泄漏](./pitfalls/container-scope-leak.md) —— 忘记 dispose 时会发生什么
