# 依赖与资源归属

在 app/runtime 声明类型化 provider。普通调用使用 runtime.execute，由它管理调用 scope。同调用中的 scope provider 共享初始化；runtime provider 生存至 runtime.dispose。transient 每次获取创建并登记清理。默认拥有创建值，传入值默认外部管理，除非 owned=true。异步初始化和释放按依赖顺序等待。runtime provider 不可捕获请求绑定。命名 Container 仍支持控制器依赖，新的异步服务使用 context.get(token)。

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
