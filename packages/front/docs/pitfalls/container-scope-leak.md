# Pitfall: container scope leak

## Symptom

Memory usage on the server climbs over hours of uptime and never recovers. Eventually:

- Garbage collection pauses get longer and longer
- Heap snapshots show retained `Container`, `HttpClient`, `Logger`, `EventRecorder` instances that should have died with their requests
- The server eventually OOMs or gets killed by your orchestrator

This is a leak that doesn't show up in tests — they finish too fast — but compounds in production.

## Root cause

A scoped `Container` (typically a request scope) was created but **never disposed**. The framework caches every resolved factory result inside the scope. Anything resolved during the request stays referenced until the scope is collected.

Worse: if the scope has child scopes, **they** also stay referenced. A request that creates 3 child scopes for sub-operations leaks all 4.

The fix (already in the framework) tracks children explicitly and recursively disposes:

```ts
// packages/core/src/dependencies/container.ts
dispose(): void {
    // Snapshot children first — child.dispose() removes itself from this.children
    const childSnapshot = Array.from(this.children);
    for (const child of childSnapshot) {
        child.dispose();
    }
    this.children.clear();
    // ...dispose own resources...
    if (this.parent) {
        this.parent.children.delete(this);
    }
}
```

But this only helps if **someone calls `dispose()` on the root scope.**

## When the framework disposes for you

- Request scopes created by `createSSRRender` are disposed after the response is sent (success or failure)
- The browser-side framework's main container lives for the lifetime of the page, then is GC'd when the page navigates away

So if you're only using the standard request lifecycle, you don't leak.

## When you leak

### Long-lived background work

```ts
// BAD
async execute(params, container) {
    setTimeout(async () => {
        const api = container.resolve("api");
        await api.cleanup();
    }, 60_000);
    return { kind: "done" };
}
```

The `container` reference inside the closure keeps the request scope alive for 60 seconds **after the response was already sent**. The framework disposed the scope, but your closure resurrected the reference. Anything else resolved through `container.resolve()` is now reached through this dangling closure.

Fix: capture the resolved value before the response, not the container:

```ts
// GOOD
async execute(params, container) {
    const api = container.resolve("api");
    setTimeout(async () => {
        await api.cleanup();   // closure captures the resolved value, not the scope
    }, 60_000);
    return { kind: "done" };
}
```

Even better: don't fire-and-forget from inside a request. Queue the work somewhere persistent.

### Manually created scopes you forgot to dispose

```ts
// BAD
async function bulkOperation() {
    const scope = framework.container.createScope();
    scope.register("tenantId", () => "tenant-42");

    for (const item of items) {
        await processItem(scope, item);
    }
    // forgot scope.dispose()
}
```

The scope outlives the function. Every `processItem` call resolved logger, API client, recorder — all retained. If `bulkOperation` runs once per request, that's a leak per request.

Fix: dispose in `finally`:

```ts
// GOOD
async function bulkOperation() {
    const scope = framework.container.createScope();
    try {
        scope.register("tenantId", () => "tenant-42");
        for (const item of items) {
            await processItem(scope, item);
        }
    } finally {
        scope.dispose();
    }
}
```

### Storing references at module scope

```ts
// BAD
let cachedScope: Container | null = null;

async function withTenantContext(tenantId: string, fn: () => Promise<void>) {
    if (!cachedScope) {
        cachedScope = framework.container.createScope();
        cachedScope.register("tenantId", () => tenantId);
    }
    return fn();
}
```

The scope grows monotonically — `cachedScope` survives forever, and every dependency resolved through it is pinned in memory.

Fix: either (a) make the scope properly request-scoped, or (b) make it deliberately app-scoped on the parent container instead of a scope.

## Diagnosing

### Symptom-level check

Watch RSS over time with a steady workload:

```bash
# In production
ps -o pid,rss,command -p $(pidof node)
# RSS climbing without bound = likely leak
```

A healthy server has fluctuating but bounded RSS. A leaking server's RSS grows monotonically.

### Heap snapshots

```bash
# Add to your Node startup
node --inspect=0.0.0.0:9229 server.js

# In Chrome DevTools → Memory → Take heap snapshot
# Run load, take another snapshot, look at "Comparison"
```

Look for:

- `Container` instances increasing
- `HttpClient` instances increasing
- `EventRecorder` instances increasing
- Any of your own registered service classes increasing

The retainer chain in DevTools tells you what holds the reference. Usually a closure or a setTimeout / setInterval.

### Targeted test

For unit testing, instrument `dispose()`:

```ts
test("scope is disposed after request", async () => {
    const disposeSpy = vi.fn();
    const scope = framework.container.createScope();
    const original = scope.dispose.bind(scope);
    scope.dispose = vi.fn(() => {
        disposeSpy();
        original();
    });

    await processRequest(scope);

    expect(disposeSpy).toHaveBeenCalled();
});
```

## Idempotent disposal

The framework's `dispose()` is **idempotent** — calling it twice is safe:

```ts
scope.dispose();
scope.dispose(); // no-op, no error
```

So if you're unsure whether something already disposed, just call dispose anyway in your cleanup. Defensive coding here costs nothing.

## What `destroy()` does

If your registered factory returns something with a `destroy()` method (loggers, recorders, custom services), `dispose()` calls it:

```ts
class MyService {
    destroy() {
        // close DB connections, flush queues, etc.
    }
}

container.register("myService", () => new MyService());
// When the scope is disposed, MyService.destroy() runs.
```

Failure inside `destroy()` is swallowed and logged — one failing service can't prevent the rest from being cleaned up.

## Related

- [Chapter 7: DI container](../07-di-container.md) — the full lifecycle model
- The fix that introduced recursive child disposal: `packages/core/src/dependencies/container.ts` (see the `children: Set<Container>` field)
