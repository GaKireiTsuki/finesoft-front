# 7. DI container

The framework uses a small dependency-injection container with parent/child scopes. It exists for two reasons:

1. **Request isolation on the server** — every SSR request gets its own scope, so per-request state (auth, request id) doesn't leak across requests.
2. **Decoupled testing** — controllers resolve their dependencies from the container, so tests can swap any of them.

The container is intentionally small. There are no decorators, no annotations, no auto-wiring. You register factories, you resolve by key.

## Registering

```ts
import { Container } from "@finesoft/front";

const container = new Container();

container.register("userApi", () => new UserApi({ baseUrl: "/api" }));
container.register("logger", () => new ConsoleLogger());
```

The factory is invoked **once per container** by default. The result is cached.

For per-resolve construction (non-singleton):

```ts
container.register("requestId", () => crypto.randomUUID(), false);
container.resolve("requestId"); // new id every time
```

## Resolving

```ts
const api = container.resolve<UserApi>("userApi");
const logger = container.resolve<Logger>("logger");
```

The generic parameter is for TypeScript only — there is no runtime type check.

Resolving an unregistered key throws:

```ts
container.resolve("missing"); // Error: Dependency "missing" not registered
```

## Scopes — the core feature

```ts
const requestScope = framework.container.createScope();
requestScope.register("currentUser", () => loadUserFromSession(request));

// Falls back to parent for keys not in the scope:
requestScope.resolve("userApi"); // parent
requestScope.resolve("currentUser"); // scope

requestScope.dispose();
```

A child scope:

- **Inherits** all parent keys via fallback resolution
- **Overrides** any key by registering its own factory
- **Cleans up** on `dispose()` — children are recursively disposed; the scope removes itself from the parent's children set

The framework creates a request-scoped container automatically per SSR request and passes it to your guards and controllers as `ctx.container` / the second argument of `execute()`. You should not need to manually create scopes for normal request handling.

## When to create your own scope

- Multi-tenant apps where each tenant has its own config / API client (see [advanced/multi-tenant-scopes](./advanced/multi-tenant-scopes.md))
- Long-running operations that need their own short-lived dependencies
- Test setup where you want to layer overrides on top of a base container

## Disposal and leaks

```ts
const scope = container.createScope();
// ... use scope ...
scope.dispose();
```

`dispose()`:

1. Recursively disposes any unfinished child scopes
2. Calls `destroy()` on any registered factory whose result implements it (loggers, recorders)
3. Removes itself from the parent's children set
4. Is idempotent — calling twice is safe

**Not disposing a scope leaks every cached value in it.** Request scopes that survive past the response will hold onto:

- HTTP clients (and their pending request state)
- Loggers / recorders
- Anything else the controllers resolved

The framework handles disposal for request scopes it creates. Scopes **you** create are yours to dispose.

See [pitfalls: container scope leak](./pitfalls/container-scope-leak.md) for the symptoms when you forget.

## Standard DI keys

Use `DEP_KEYS` constants instead of string literals to catch typos at type-check time:

```ts
import { DEP_KEYS } from "@finesoft/front";

container.register(DEP_KEYS.LOGGER, () => new ConsoleLogger());
container.register(DEP_KEYS.EVENT_RECORDER, () => myRecorder);

const logger = container.resolve(DEP_KEYS.LOGGER);
```

The constants:

| Key                       | Standard type      | Used by                                       |
| ------------------------- | ------------------ | --------------------------------------------- |
| `DEP_KEYS.LOGGER`         | `Logger`           | Framework logging                             |
| `DEP_KEYS.LOGGER_FACTORY` | `LoggerFactory`    | Per-category loggers (`logger.scope("auth")`) |
| `DEP_KEYS.NET`            | `Net`              | Network state checks (offline / metered)      |
| `DEP_KEYS.STORAGE`        | `Storage`          | Key-value persistence (localStorage / memory) |
| `DEP_KEYS.FEATURE_FLAGS`  | `FeatureFlags`     | Feature flag reads                            |
| `DEP_KEYS.METRICS`        | `MetricsClient`    | Counter / gauge / timing                      |
| `DEP_KEYS.FETCH`          | `typeof fetch`     | `HttpClient`'s underlying fetch (mockable)    |
| `DEP_KEYS.EVENT_RECORDER` | `EventRecorder`    | Structured event recording                    |
| `DEP_KEYS.LOCALE`         | `LocaleAttributes` | Resolved locale (lang + dir)                  |
| `DEP_KEYS.PLATFORM`       | `PlatformInfo`     | Detected user-agent platform info             |
| `DEP_KEYS.TRANSLATOR`     | `Translator`       | Translation function                          |

The framework registers default implementations for these during `Framework.create()`. Override them by registering after framework creation:

```ts
const framework = Framework.create({/* ... */});
framework.container.register(DEP_KEYS.LOGGER, () => myCustomLogger);
```

## Custom keys

For your own services, use string keys directly:

```ts
container.register("userApi", () => new UserApi({ baseUrl: "/api" }));
container.register("session", () => new SessionService());
container.register("featureBucketing", () => new BucketingService());
```

To get type safety for your own keys, define your own const map:

```ts
// src/lib/di-keys.ts
export const APP_KEYS = {
    USER_API: "userApi",
    SESSION: "session",
    FEATURE_BUCKETING: "featureBucketing",
} as const;

// Usage
container.register(APP_KEYS.USER_API, () => new UserApi({ baseUrl: "/api" }));
const api = container.resolve<UserApi>(APP_KEYS.USER_API);
```

## Lifecycle ordering

```
Framework.create({ ... })
    │
    ▼
default DEP_KEYS registered (logger, locale, platform, ...)
    │
    ▼
your custom registrations (in onBeforeStart or bootstrap)
    │
    ▼
─── per request ───────────────────────────────────
framework.container.createScope()      ← request scope
    │
    ▼
beforeLoad guards (ctx.container = scope)
    │
    ▼
controller.execute(params, scope)
    │
    ▼
afterLoad guards (ctx.container = scope)
    │
    ▼
renderApp() / response
    │
    ▼
scope.dispose()                        ← framework cleans up
```

## Testing with the container

Inject mocks at the scope level:

```ts
import { Framework } from "@finesoft/front";

const framework = Framework.create({/* ... */});
const testScope = framework.container.createScope();
testScope.register("userApi", () => mockUserApi);

const controller = new UserListController();
const page = await controller.execute({}, testScope);

testScope.dispose();
```

The full pattern is in [engineering/testing](./engineering/testing.md).

## Antipatterns

### Don't resolve in module top-level

```ts
// BAD — runs at import time, before framework.create()
const logger = container.resolve(DEP_KEYS.LOGGER);
export function log(msg: string) {
    logger.info(msg);
}
```

The `container` you'd reach here isn't the request scope; you'd get the parent and lose request isolation.

Instead, resolve inside the function that has access to the scope:

```ts
export function logFromController(container: Container, msg: string) {
    container.resolve<Logger>(DEP_KEYS.LOGGER).info(msg);
}
```

### Don't keep refs to scoped instances after dispose

```ts
// BAD
let api: UserApi;
beforeLoad: (ctx) => {
    api = ctx.container.resolve("userApi");
    return next();
};
// `api` now points at an instance whose scope was disposed
```

If you need to share state across requests, register it on the parent container, not the request scope.

### Don't register inside a guard

```ts
// BAD — runs per request
beforeLoad: (ctx) => {
    ctx.container.register("userApi", () => new UserApi(/*...*/));
    return next();
};
```

This creates a fresh factory closure per request. Register once at framework setup; the scope inherits.

## Next

- [Observability](./08-observability.md) — wiring Logger / EventRecorder / ReportCallback via DI
- [Engineering: testing](./engineering/testing.md) — using scopes to isolate tests
- [Pitfalls: container scope leak](./pitfalls/container-scope-leak.md) — what happens when you forget to dispose
