# 陷阱：SSR 与 CSR 的全局变量

## 症状

build 成功。dev server 起来。任何 SSR 路由的首次请求崩：

```
ReferenceError: window is not defined
    at /src/lib/foo.ts:3:13
```

或者更隐蔽：

```
TypeError: Cannot read properties of undefined (reading 'getItem')
    at /src/lib/storage.ts:5:34
```

浏览器专属全局（`window`、`document`、`localStorage`、`navigator`、`matchMedia`、`IntersectionObserver` 等）在 Node 上不存在 —— Node 没有。

## 根因

你在被 SSR 入口导入的文件**模块求值时**读了浏览器专属全局。即使你只在客户端用它，模块图也把它拖进来了。

常见入口：

- `controllers/foo.ts` 导入 `lib/analytics.ts`，后者顶层用 `window.gtag`
- `lib/storage.ts` 工厂在 import 时调 `localStorage.getItem`
- 动画库 import 时自动跑 `requestAnimationFrame`

反过来浏览器也会遇到同样问题：

- 服务端专属代码（`process.env.X`、Node `fs`、`path`）被浏览器 bundle 拖进来的东西 import 了
- Vite 把大多数 tree-shake 掉，但不是全部，动态 import 也可能让 tree-shake 失效

## 诊断

SSR 入口崩时错误信息含文件。从上往下读 —— 第一条 `import` 链触到浏览器全局的就是元凶。

预先找浏览器专属代码，grep：

```bash
rg -n '\b(window|document|localStorage|sessionStorage|navigator|matchMedia|location)\b' src/
```

交叉对照从 `src/ssr.ts` 传递可达的东西。从 `ssr.ts` 可达的任何代码都必须 SSR 安全。

## 修法

### 用环境检查守卫

```ts
// 好 —— 两端都安全
function getStoredTheme(): "light" | "dark" {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("theme") as "light" | "dark") ?? "light";
}
```

`typeof window === "undefined"` 是 SSR 检查的标准写法。比 `typeof process !== "undefined"` 更安全，因为有些打包器在客户端 polyfill `process`。

### 移到生命周期 hook

```ts
// 不好 —— import 时跑
const analytics = createAnalytics(window.location.host);
export function track(event: string) {
    analytics.send(event);
}
```

```ts
// 好 —— 浏览器里 framework 启动之后跑
let analytics: Analytics | null = null;

export function track(event: string) {
    if (!analytics) {
        if (typeof window === "undefined") return;
        analytics = createAnalytics(window.location.host);
    }
    analytics.send(event);
}
```

或用 `startBrowserApp` 的 `onBeforeStart`：

```ts
startBrowserApp({
    bootstrap,
    onBeforeStart(framework) {
        const analytics = createAnalytics(window.location.host);
        framework.container.register("analytics", () => analytics);
    },
    mount: /* ... */,
});
```

然后在 Controller / view 里从 DI resolve —— 共享代码里永远别直接碰 `window`。

### 条件 import

import 时崩 Node 的库（动画库、音频库），只在浏览器动态 import：

```ts
let confetti: ((options?: any) => void) | null = null;

if (typeof window !== "undefined") {
    import("canvas-confetti").then((m) => {
        confetti = m.default;
    });
}

export function celebrate() {
    confetti?.();
}
```

或在 `onBeforeStart` 里 import：

```ts
onBeforeStart: async (framework) => {
    const { default: confetti } = await import("canvas-confetti");
    framework.container.register("confetti", () => confetti);
},
```

### 用框架的抽象

框架提供两端都能用的 DI key：

- `DEP_KEYS.PLATFORM` —— 服务端是解析的 user-agent，客户端是 navigator 派生
- `DEP_KEYS.STORAGE` —— 客户端 `localStorage`，服务端内存 map
- `DEP_KEYS.LOCALE` —— 两端解析后的 locale

用这些替代直接读全局。它们就是为跨平台设计的。

## 症状：本地能跑，生产构建挂

有时 dev server 容忍某个全局访问（Vite 的懒求值），但生产构建崩。原因通常是某个模块 dev 下被 tree-shake 掉而 prod 下没被，或者反过来。

部署前测生产构建：

```bash
pnpm build
pnpm preview
# 访问 SSR 路由
```

`vp preview` 跑生产同一代码路径 —— 它不崩，部署也不会崩（至少不会因为这类 bug）。

## 症状：生产能跑，dev 里空白页

反向问题 —— 服务端专属代码漏进了客户端 bundle，浏览器 hydration 之前就崩了。

打开浏览器 devtools，看 console 里有没有 `process is not defined` / `require is not defined`。修法同前：用 `typeof window === "undefined"`（反过来用 `typeof window !== "undefined"`）守卫，或移到生命周期 hook。

## 为什么 import 重要，不是「不调函数」

你可能想「不调那个函数」而不是守卫 import：

```ts
// 在 import 时检查
if (typeof window !== "undefined") {
    // SSR 永不调用
    setupAnalytics();
}
```

但 `import` 本身会跑模块顶层代码。如果 `lib/analytics.ts` 顶层调了 `window.gtag`（如 `const analytics = window.gtag.bind(window)`），崩**发生在 import 时**，在你的 `if` 检查之前。

修被 import 的模块让它 import 安全，不是只让 call 安全。

## 参考

- [陷阱：SSR Hydration 不匹配](./ssr-hydration-mismatch.md) —— SSR 跑了但产出与 CSR 不同
- [DI 容器](../07-di-container.md) —— 注册跨平台服务
