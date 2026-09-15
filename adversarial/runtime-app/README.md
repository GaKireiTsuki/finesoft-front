# Portable runtime fixture

`src/business.ts` is the one operation/provider/endpoint definition used by direct execution,
Node HTTP and the real workerd fetch handler. It imports only public `@finesoft/front` subentries.
`config.ts` owns fixture binding values and their inferred type; it contains no credentials.
The test-only identity header is not a production authentication example.

From the repository root:

```sh
vp run --filter @finesoft/front build
vp run --filter @finesoft/runtime-app build
vp exec node scripts/verify-portable-runtime.mjs
```

The script exercises the built public API and starts a local Node listener and a real workerd
instance. It closes both. Miniflare is a root development dependency; there is no Cloudflare
account, deployment or `nodejs_compat`. The Worker is bundled as one module under `dist/worker`
and initializes the shared runtime during its first request. Request bindings are passed on every
fetch; the runtime does not capture the first environment.

Task 6/7 can import `createFixture` and `inspect` from `src/business.ts` inside an actual browser
Worker, then call `runtime.execute(inspect, n, {identity: "fixture-authorized", bindings})` and
`runtime.dispose()` on shutdown. This reuses the operation, nested policy and scoped provider.

## Response and task ownership

`createHttpHandler` owns one `ExecutionHandle` per matched request. A bodyless response releases
it before returning. A response with a body keeps it alive until the consumer reads EOF, cancels
the body, aborts the request, or encounters a read failure. Consumers must consume or cancel
bodies they abandon. Producers must cooperate with cancellation and await their own I/O cleanup
in their stream's `cancel` callback. Pending reads cannot release the scope ahead of that callback.
Cancellation does not roll back writes.

`runManagedTask(context, async taskContext => {...})` registers work while the request is being
handled. A supported host is required before the callback starts. The callback gets a separate
execution scope with inherited identity, locale, trace and bindings, and an independent signal.
Acquire resources from `taskContext`; capturing request-owned services does not extend their
lifetime. Await all work in the callback; do not return streams or leave detached promises.
The host's `waitUntil` receives a promise that includes task scope disposal on success or failure.
Response completion/cancellation releases request resources without cancelling managed work.
Nested task scheduling is deliberately unsupported. Node's `startNodeHandler().dispose()` stops
accepting connections, drains full handler/response lifetimes (including disconnected encoders) and
managed tasks, then disposes an explicitly
transferred runtime. `onTaskError(error)` reports callback and cleanup failures and is awaited during
drain; the default reporter uses `console.error`. If both fail, it receives an AggregateError containing
both failures. Hosts retaining their own runtime must drain registered tasks before disposing
it. Worker tasks inherit the host's limits and shutdown behavior; this is not a durable queue.

`createSSRHandler` owns only portable HTML response assembly and its bounded public HTML cache.
Its `render` callback owns application execution. Hosts that load modules per request may provide
`loadModule(request)` instead of static render/serializeServerData callbacks. The shared handler
selects the serializer from that invocation's module only when HTML data injection requires it.
Task 4 must use the Runtime for policies/data
and finish request execution before returning its materialized HTML result. The SSR handler calls
render on every request, including cache hits, so current guards cannot be bypassed. Shared HTML
caching requires `cache: "public"`, prerender mode, status 200 and no response metadata. Requests
with Cookie/Authorization bypass it. Result locale and full URL partition the cache; cached HTML
saves assembly, not rendering or policy execution. Data caching belongs to Runtime operations.
