# 运行环境边界

根入口导入可移植操作；浏览器 DOM、Node 能力、Vite 工具使用显式入口。

## Boundaries / 边界

```ts
import { defineOperation } from "@finesoft/front";
// Browser entry: @finesoft/front/browser
// Node host entry: @finesoft/front/node
// Worker host entry: @finesoft/front/worker
// Build config only: @finesoft/front/vite
```

共享声明模块加载时勿读取 window/document/storage。UI 绑定只选择需要的框架。Node DNS、文件系统不能进入浏览器/Worker 图。使用实际安装产物验证对应运行环境，源码别名可能掩盖缺失产物。
