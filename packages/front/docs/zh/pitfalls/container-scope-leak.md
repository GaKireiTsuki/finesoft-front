# 陷阱：Container scope 泄漏

## 症状

服务器内存随运行时间上涨从不回落。最终：

- GC 暂停越来越长
- 堆快照显示该跟着请求死掉的 `Container`、`HttpClient`、`Logger`、`EventRecorder` 实例被保留
- 服务器最终 OOM 或被编排器杀掉

测试里看不到的泄漏 —— 测试结束太快 —— 但生产里累积。

## 根因

scope 化的 `Container`（通常是请求 scope）被创建了但**从未 dispose**。框架在 scope 里缓存每个 resolve 过的工厂结果。请求中 resolve 的任何东西都被引用持有直到 scope 被 GC。

更糟：如果 scope 有子 scope，**它们**也持续被引用。一个请求创建 3 个子 scope 做子操作，泄漏 4 个。

修复（框架内已有）显式跟踪子 scope 并递归 dispose：

```ts
// packages/core/src/dependencies/container.ts
dispose(): void {
    // 先快照 children —— child.dispose() 会自己从 this.children 移除
    const childSnapshot = Array.from(this.children);
    for (const child of childSnapshot) {
        child.dispose();
    }
    this.children.clear();
    // ...dispose 自身资源...
    if (this.parent) {
        this.parent.children.delete(this);
    }
}
```

但这只在**有人调用根 scope 的 `dispose()`** 时管用。

## 什么时候框架替你 dispose

- `createSSRRender` 创建的请求 scope，在响应发送后（无论成功失败）dispose
- 浏览器端框架的主容器活到页面生命周期结束，导航离开后 GC

只用标准请求生命周期就不会泄漏。

## 什么时候你会泄漏

### 长跑后台工作

```ts
// 不好
async execute(params, container) {
    setTimeout(async () => {
        const api = container.resolve("api");
        await api.cleanup();
    }, 60_000);
    return { kind: "done" };
}
```

闭包里 `container` 引用让请求 scope 在响应已发送**之后**活了 60 秒。框架 dispose 了 scope，但你的闭包让引用复活。任何通过 `container.resolve()` resolve 出的东西现在都通过这个悬挂闭包能到达。

修：捕获 resolve 后的值，不捕获 container：

```ts
// 好
async execute(params, container) {
    const api = container.resolve("api");
    setTimeout(async () => {
        await api.cleanup();   // 闭包捕获 resolve 后的值，不是 scope
    }, 60_000);
    return { kind: "done" };
}
```

更好：请求内别 fire-and-forget。把工作排到持久的地方。

### 自己开的 scope 忘了 dispose

```ts
// 不好
async function bulkOperation() {
    const scope = framework.container.createScope();
    scope.register("tenantId", () => "tenant-42");

    for (const item of items) {
        await processItem(scope, item);
    }
    // 忘了 scope.dispose()
}
```

scope 活过函数。每次 `processItem` 调用 resolve 了 logger、API 客户端、recorder —— 都被保留。`bulkOperation` 一次请求跑一次，每个请求都泄漏。

修：在 `finally` 里 dispose：

```ts
// 好
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

### 模块级存引用

```ts
// 不好
let cachedScope: Container | null = null;

async function withTenantContext(tenantId: string, fn: () => Promise<void>) {
    if (!cachedScope) {
        cachedScope = framework.container.createScope();
        cachedScope.register("tenantId", () => tenantId);
    }
    return fn();
}
```

scope 单调增长 —— `cachedScope` 永远活着，通过它 resolve 的每个依赖都被钉在内存里。

修：要么 (a) 让 scope 正确按请求 scope 化，要么 (b) 把它有意按应用级注册到父容器，而不是 scope。

## 诊断

### 症状级检查

稳定负载下观察 RSS：

```bash
# 生产
ps -o pid,rss,command -p $(pidof node)
# RSS 无界增长 = 多半泄漏
```

健康服务器 RSS 浮动但有界。泄漏服务器 RSS 单调增长。

### 堆快照

```bash
# Node 启动加
node --inspect=0.0.0.0:9229 server.js

# Chrome DevTools → Memory → Take heap snapshot
# 跑负载，再拍一张，看 "Comparison"
```

找：

- `Container` 实例增多
- `HttpClient` 实例增多
- `EventRecorder` 实例增多
- 你自己注册的服务类增多

DevTools 里的 retainer chain 告诉你什么持有引用。通常是闭包或 setTimeout / setInterval。

### 针对性测试

单元测试，给 `dispose()` 加监控：

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

## 幂等 dispose

框架的 `dispose()` 是**幂等**的 —— 调两次安全：

```ts
scope.dispose();
scope.dispose(); // no-op，不报错
```

不确定是不是已经 dispose 过，直接调 dispose。这里防御性写代码不花成本。

## `destroy()` 做什么

注册的工厂返回的对象有 `destroy()` 方法（logger、recorder、自定义服务），`dispose()` 会调它：

```ts
class MyService {
    destroy() {
        // 关 DB 连接、flush 队列等
    }
}

container.register("myService", () => new MyService());
// scope dispose 时，MyService.destroy() 跑。
```

`destroy()` 里抛错被吞掉并记录 —— 一个服务失败不阻止其他服务清理。

## 参考

- [第 7 章：DI 容器](../07-di-container.md) —— 完整生命周期模型
- 引入递归子 dispose 的修复：`packages/core/src/dependencies/container.ts`（看 `children: Set<Container>` 字段）
