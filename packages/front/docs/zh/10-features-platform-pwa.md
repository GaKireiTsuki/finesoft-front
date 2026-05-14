# 10. Feature flags、平台、PWA

三个小而独立的运行时辅助：

- **Feature flags** —— 不重新部署就能变的配置
- **平台检测** —— 解析 User-Agent 得到 OS / 浏览器 / 引擎
- **PWA 模式** —— 检测应用是否已安装（standalone）

每个都可替换，每个都可组合自定义 provider。

## Feature flags

```ts
const framework = Framework.create({
    featureFlags: {
        darkMode: true,
        maxRetries: 3,
        experimentalCheckout: false,
    },
});

const flags = framework.container.resolve(DEP_KEYS.FEATURE_FLAGS);
flags.get("darkMode"); // true
flags.get("maxRetries"); // 3
flags.get("missing"); // undefined
flags.get("missing", "fallback"); // "fallback"
```

Flag 值可以是任何 JSON 可序列化的：布尔、字符串、数字、数组、对象。

### 静态配置

最简单的情况 —— flag 跟 bundle 一起发：

```ts
Framework.create({
    featureFlags: {
        darkMode: process.env.NODE_ENV !== "production",
        analytics: true,
        cdnUrl: "https://cdn.example.com",
    },
});
```

适用于由环境驱动的 flag，而不是用户属性驱动的。

### 远端 provider

接入从远端服务拉的 provider（LaunchDarkly、GrowthBook、Unleash、自家配置服务）：

```ts
import { type FeatureFlagsProvider } from "@finesoft/front";

const remoteConfigProvider: FeatureFlagsProvider = {
    async load() {
        const resp = await fetch("https://config.example.com/flags");
        return resp.json(); // { ...flags }
    },
};

const framework = Framework.create({
    featureFlags: {
        darkMode: false,
        maxRetries: 3,
    },
    featureFlagsProviders: [remoteConfigProvider],
});
```

provider 按注册顺序跑。后注册的 provider 对同 key 覆盖之前的值 —— 「后注册者胜」。

### 缓存生命周期

框架在 `Framework.create()` 期间加载一次 provider 值。之后 flag 同步从内存读。

调 `flags.refresh()` 刷新：

```ts
const flags = framework.container.resolve(DEP_KEYS.FEATURE_FLAGS);
await flags.refresh(); // 重跑所有 provider
```

通常按定时器或响应服务端推送事件调。

### 用户级 targeting

内置 flag 是全局的（每个用户同一个值）。需要用户级 targeting 的话，让你的 provider 返回函数，或用单独的评估步骤：

```ts
class TargetingProvider implements FeatureFlagsProvider {
    constructor(private userId: string) {}
    async load() {
        const resp = await fetch(`https://config.example.com/flags?userId=${this.userId}`);
        return resp.json();
    }
}

// 在 beforeLoad 守卫里按请求注册：
async function flagsGuard(ctx) {
    const userId = await getUserIdFromCookie(ctx);
    const targeting = new TargetingProvider(userId);
    const flags = await targeting.load();
    ctx.container.register(DEP_KEYS.FEATURE_FLAGS, () => ({
        get: (key, fallback) => flags[key] ?? fallback,
    }));
    return next();
}
```

复杂分桶交给专门的服务（GrowthBook SDK 等），把它的 evaluator 存进 DI。

### SSR / CSR 一致性

服务端评估而浏览器端不重新评估的 flag 会引起 hydration 不匹配。Controller 读 flag 时框架会把 flag 值序列化进 `PrefetchedIntents`。浏览器读到的就是服务端看到的值。

对于*应当*不同的 flag（如 A/B 变体），在 `beforeLoad` 守卫里评估并存到请求 scope 里 —— 服务端和浏览器都会用服务端解析出的值。

## 平台检测

```ts
import { detectPlatform } from "@finesoft/front";

const info = detectPlatform();
// {
//   os: "ios" | "android" | "macos" | "windows" | "linux" | "other",
//   browser: "safari" | "chrome" | "firefox" | "edge" | ...,
//   engine: "webkit" | "blink" | "gecko" | "other",
//   isMobile: boolean,
//   isTouch: boolean,
//   isServer: boolean,
// }
```

浏览器端 `detectPlatform()` 读 `navigator.userAgent`。服务端框架自动解析请求的 `User-Agent` 头：

```ts
const platform = framework.getPlatform();
```

Controller 和守卫从 DI resolve：

```ts
const platform = ctx.container.resolve(DEP_KEYS.PLATFORM);
if (platform.isMobile) {
    return rewrite("/m" + ctx.url.pathname);
}
```

### 可靠性

User-Agent 字符串会撒谎 —— 每个现代浏览器为了兼容性嵌入了其他浏览器的子串。框架的检测优先匹配众所周知的模式，遇到模糊就回退到 `"other"`。别单纯靠 `browser` 做关键决策：

- ✅ 按 `isMobile` 调整布局
- ✅ 非 WebKit 浏览器隐藏 Safari 专有特性
- ❌ 锁定特定浏览器
- ❌ 按浏览器版本选代码路径

## PWA 检测

```ts
import { getPWADisplayMode } from "@finesoft/front";

const mode = getPWADisplayMode();
// "standalone" | "twa" | "browser"
```

- `"standalone"` —— 作为已安装 PWA 跑（Safari 加到主屏、Chrome install）
- `"twa"` —— Trusted Web Activity（Android，包装成原生应用）
- `"browser"` —— 普通浏览器标签

函数读 `window.matchMedia("(display-mode: standalone)")` 和 Android 的 TWA referrer。服务端返回 `"browser"`。

### 常见用途

```ts
const mode = getPWADisplayMode();

if (mode === "browser") {
    showInstallBanner();
}

if (mode === "standalone") {
    // 自定义导航 —— 已安装的应用不应再显示 install 提示
    hideInstallButton();
    enableNativeBackButtonHandling();
}
```

### Service worker 注册

PWA install 与 service worker 独立 —— 可以只要一个。注册 service worker：

```ts
// src/main.ts
startBrowserApp({
    bootstrap,
    mount,
    onAfterStart() {
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js");
        }
    },
});
```

框架不内置 service worker 生成器。用 [Vite PWA](https://vite-pwa-org.netlify.app/) 或手写。

## 组合三者

一个组合三者的常见导航守卫：

```ts
import { next, rewrite, DEP_KEYS } from "@finesoft/front";

function mobilePwaGuard(ctx) {
    const platform = ctx.container.resolve(DEP_KEYS.PLATFORM);
    const flags = ctx.container.resolve(DEP_KEYS.FEATURE_FLAGS);

    if (flags.get("mobilePwaRedesign") && platform.isMobile && !ctx.isSsr) {
        if (getPWADisplayMode() === "standalone") {
            return rewrite(`/pwa${ctx.url.pathname}`);
        }
    }
    return next();
}
```

把已安装移动 PWA 用户路由到不同的页面树，不影响其他用户。

## 注意事项

- **服务端解析出的 flag 会进 HTML。** flag 里别存秘密。
- **服务端平台检测靠请求头。** 爬虫或 curl 可能没发有用的 User-Agent —— 优雅处理 `"other"`。
- **服务端 PWA 检测永远返回 `"browser"`。** 不要在 SSR 渲染路径里依赖；按 PWA 模式做条件 UI 应该仅客户端，或用 `<noscript>` 兜底。

## 下一步

- [工程实践 · 项目结构](./engineering/project-structure.md) —— flag config、平台感知代码放哪
