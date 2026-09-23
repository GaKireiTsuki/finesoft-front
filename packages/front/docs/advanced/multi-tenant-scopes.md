# Request isolation

Runtime execution opens and closes an invocation scope automatically. Trusted host bindings carry tenant/identity; nested operations inherit the current context.

## Invocation / 调用

```ts
// Derive these values from trusted authentication at the host boundary.
await runtime.execute(operation, input, {
    identity: authenticatedUser,
    bindings: { tenant: tenantId },
    signal: request.signal,
});
// Inside an operation: await context.execute(otherOperation, input);
```

Use `provide({ token, lifetime: "scope", create, dispose })` for per-request resources. Concurrent initialization deduplicates and a failed initialization may retry. Runtime-scoped providers cannot depend on request-scoped values. Externally supplied values remain external unless owned explicitly; created values are released in dependency order. A command is not retried or cached automatically; cancellation does not roll back an already applied mutation.

## Query cache partitions

Cached queries with invocation bindings or an invocation-specific `fetch` default to execution-local reuse, even with `scope: "runtime"`. Bindings can contain opaque resources and tenant-specific providers, so the runtime does not serialize them into a shared key. Web and SSR hosts also supply bindings and therefore use this isolation by default. Queries without invocation bindings/fetch retain runtime reuse partitioned by identity, locale and input.

To share completed results across executions, explicitly declare the complete trusted security partition:

```ts
const tenantSummary = defineOperation({
    id: "tenant-summary",
    kind: "query",
    cache: {
        ttlMs: 10_000,
        partition: (context) => {
            const tenant = context.bindings.tenant;
            if (typeof tenant !== "string") throw new ExecutionError("configuration");
            return tenant;
        },
    },
    handler: loadTenantSummary,
});
```

The partition must cover every result-affecting binding and fetch authority in addition to the existing identity, locale and input key. A constant partition asserts that the result is independent of all other invocation state. `cache.key(input)` still controls only the input key; it cannot enable shared caching by itself. Policies run before every cache hit, invalidation still applies across partitions, and `scope: "execution"` always remains local.
