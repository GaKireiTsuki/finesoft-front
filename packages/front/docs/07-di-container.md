# Dependencies and resource ownership

Declare typed providers on the app/runtime. Ordinary calls use runtime.execute; it owns the invocation scope. Scope providers share one initialization within that invocation; runtime providers live until runtime.dispose. Transient values are created per acquisition and tracked for cleanup. Created values are owned by default; supplied values are external unless owned is true. Async initialization and disposal are awaited in dependency order. Runtime providers cannot capture request-only bindings. The legacy named Container remains available for existing controller dependencies; new asynchronous services should use context.get(token).

```ts
import { createToken, provide, defineApp, defineOperation, createRuntime } from "@finesoft/front";
const tenant = createToken<string>("tenant");
const who = defineOperation({
    id: "who",
    kind: "query",
    handler: async (_: undefined, context) => context.get(tenant),
});
const app = defineApp({
    id: "example",
    operations: [who],
    providers: [
        provide({
            token: tenant,
            lifetime: "scope",
            create: ({ bindings }) => String(bindings.tenant),
        }),
    ],
});
const runtime = createRuntime({ app });
try {
    await runtime.execute(who, undefined, { bindings: { tenant: "one" } });
} finally {
    await runtime.dispose();
}
```
