# 测试

先直接测操作契约，再验证主机响应和原生 UI 生命周期。仅测源码导出不能证明打包消费者隔离。

## Direct operation / 直接操作

```ts
import { expect, test } from "vite-plus/test";
import { runtime, double } from "./data-app";
test("double", async () => {
    expect(await runtime.execute(double, 3)).toBe(6);
});
```

运行 `vp check`、`vp test --coverage`、`vp run -r build`。仓库产物验证覆盖 Node/workerd、真实浏览器 Worker、React/Vue/Svelte、wire 协议、本地 tarball 安装。测试需释放自己拥有的运行时、监听器、浏览器实例。`scripts/verify-runtime-boundaries.mjs` 在无 workspace 别名的环境验证公开打包入口。
