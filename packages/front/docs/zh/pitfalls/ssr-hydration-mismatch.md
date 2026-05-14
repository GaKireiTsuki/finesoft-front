# 陷阱：SSR Hydration 不匹配

## 症状

SSR 之后浏览器控制台打 hydration warning：

```
[Vue warn]: Hydration node mismatch — server rendered "<div>Loading...</div>" but client expected "<div>Welcome, Alice</div>"
```

页面在 SSR 渲染内容和客户端渲染内容之间闪。本该已经加载完毕的状态触发重新请求。

## 根因（最常见）

服务端和浏览器为同一 URL 产出了**不同的 `Page` 对象**，因为两端读的东西在某处不一致：

- 随机/时间相关值（`Math.random()`、`Date.now()`）
- 在服务端读 `window` / `localStorage` / `document.cookie`（都是 `undefined`）
- 在浏览器读 `process.env`（打包后是 `undefined`）
- SSR 看不到真实 UA 时却做了 UA 相关的渲染
- 异步竞争：Controller 的 `execute()` 每次返回不同数据

hydration 缓存（`PrefetchedIntents`）查找未命中，浏览器重跑 Controller —— 拿到不同结果。

## 根因（较不常见）

`PrefetchedIntents` 的 key（intentId + 稳定字符串化的 params）在两端不匹配：

- params 对象含不能确定性序列化的值（Map、Set、类实例、Symbol）
- Controller 原地改 `params` —— dispatch key 是从原始 params 算的，Controller 看到的是改过的

## 诊断

```ts
// 在 view 里两端都 log page：
console.log("[hydration]", typeof window === "undefined" ? "SSR" : "CSR", page);
```

对比两份 log。第一个不同的字段就是根因。

`PrefetchedIntents` 调试，浏览器里 log 缓存状态：

```ts
startBrowserApp({
    bootstrap,
    onBeforeStart(framework) {
        console.log("[prefetched]", framework.prefetchedIntents.dump());
    },
    mount: /* ... */,
});
```

dump 里有 intent 但 **params 跟浏览器首次 dispatch 不同**就是 key 不匹配。

## 修法

### 别在模块顶层读平台专属全局

```ts
// 不好
const userId = localStorage.getItem("uid"); // SSR 抛错
const isDarkMode = matchMedia("(prefers-color-scheme: dark)").matches; // SSR 抛错
const csrfToken = document.querySelector("meta[name=csrf]")?.content; // SSR 是 null

export class HomeController extends BaseController {
    /* 用 userId */
}
```

```ts
// 好
export class HomeController extends BaseController {
    async execute(_params, container) {
        // 从 DI resolve；请求 scope 里两端都有正确的值
        const session = container.resolve<Session>("session");
        return { kind: "home", userId: session.userId };
    }
}
```

cookie 两端都能通过 `container.resolve("session")` 拿到（注册之后）。`localStorage` 只在浏览器 —— SSR 也要同一个值时，通过 cookie 或 query 参数暴露。

### `execute()` 里别用随机性/时间相关逻辑

```ts
// 不好 —— 服务端和浏览器算不同的值
async execute() {
    return { kind: "home", randomGreeting: pick(greetings) };
}
```

需要随机性的话在服务端算一次，让客户端通过 `PrefetchedIntents` 复用（它会自动复用）。别尝试「在客户端重新随机」—— 那正是 hydration mismatch 的成因。

时间相关逻辑在服务端决定后送出结果：

```ts
async execute() {
    const isOfficeHours = new Date().getHours() >= 9 && new Date().getHours() < 17;
    return { kind: "home", isOfficeHours };
}
```

两端都看到同一个 `isOfficeHours: true`，因为浏览器从缓存读，不重新评估。

### `params` 用纯 JSON 类型

```ts
// 不好 —— dispatchAction 带非可序列化 params
framework.dispatch({
    intentId: "search",
    params: {
        query: "widget",
        filters: new Set(["red", "small"]), // Set JSON.stringify 不好
        startDate: new Date(), // 变 ISO string，能用，但...
        validator: new Validator(), // 类实例 —— 不会留下
    },
});
```

```ts
// 好 —— 仅原语 + 纯对象
framework.dispatch({
    intentId: "search",
    params: {
        query: "widget",
        filters: ["red", "small"],
        startDate: "2026-05-14",
    },
});
```

`PrefetchedIntents` 缓存用**稳定字符串化** —— 同 key 不同顺序产出相同 key，能检测循环引用。但非 JSON 值会被强转为字符串或静默丢弃。

### 别改 `params`

```ts
// 不好
async execute(params, container) {
    params.userId = container.resolve("session").userId;   // 改了
    return loadFor(params);
}
```

```ts
// 好
async execute(params, container) {
    const effective = { ...params, userId: container.resolve("session").userId };
    return loadFor(effective);
}
```

dispatcher 用原始 `params` 算了 cache key。改了之后，下次同样形状的 dispatch 就缓存未命中。

## 为什么 `stableStringify` 重要

框架的 `stableStringify`（在 `packages/core/src/prefetched-intents/stable-stringify.ts`）处理对象键顺序。它用 `seen` Set + `try/finally` 清理来支持 DAG（同一对象被多次引用）—— 没有清理的话 DAG 会被误判为循环引用，key 在两端会悄悄不同。

如果 SSR 期间看到 "Circular reference detected" warning 但数据确实是 DAG，提 bug —— 清理本该处理这个。

## 参考

- [陷阱：SSR vs CSR 全局变量](./ssr-vs-csr-globals.md) —— 平台专属全局住在哪
- [第 4 章：渲染与 Hydration](../04-rendering-and-hydration.md) —— `PrefetchedIntents` 怎么工作
