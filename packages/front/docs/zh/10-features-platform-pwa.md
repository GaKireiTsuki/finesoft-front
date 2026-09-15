# 功能开关、平台与 PWA

可移植检测、功能开关契约属于根入口；PWA、DOM 行为使用浏览器入口。

## Imports / 入口

```ts
import { detectPlatform, type FeatureFlagsProvider } from "@finesoft/front";
import { getPWADisplayMode } from "@finesoft/front/browser";
// Configure frameworkConfig.featureFlags and frameworkConfig.platform in the Web declaration.
// Call getPWADisplayMode only in a browser-owned lifecycle.
```

功能开关是应用决策，不是身份授权；受保护操作仍需运行时策略。Service Worker 清单、缓存策略由应用决定，选择浏览器主机不会自动安装。
