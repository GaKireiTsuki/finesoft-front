# 请求隔离

运行时自动打开、关闭调用 scope。可信主机绑定传递租户和身份，嵌套操作继承当前上下文。

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

每请求资源使用 `provide({ token, lifetime: "scope", create, dispose })`。并发初始化去重，初始化失败可重试。runtime 生命周期不能依赖请求生命周期值。外部传入值默认由外部管理，创建值按依赖顺序释放。command 不自动重试或缓存，取消也不会回滚已生效修改。
