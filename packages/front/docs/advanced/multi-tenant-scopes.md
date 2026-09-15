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
