# 运行环境边界

全部 API 从 `@finesoft/front` 导入，各自的运行环境要求仍然保留。包条件与编译器选择内部实现，不加载未使用的 UI 或平台依赖。

## Boundaries / 边界

```ts
import { defineOperation } from "@finesoft/front";
// createBrowserApp: browser
// startNodeHandler: Node
// createHttpHandler: Request/Response host (Node or Worker)
// finesoftFrontViteConfig: build configuration
```

共享声明模块加载时勿读取 window/document/storage。UI 绑定只选择需要的框架。Node DNS、文件系统不能进入浏览器/Worker 图。使用实际安装产物验证对应运行环境，源码别名可能掩盖缺失产物。
