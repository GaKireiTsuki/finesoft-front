# 框架进一步精简验收

2026-09-20，实施位置为 `.worktrees/application-boundaries`，分支 `refactor/application-boundaries`。这是[原生组合实现](native-composition-acceptance.md)完成后的进一步精简。保留所有原有未提交修改；主检出仍干净。本次未提交、推送或部署。

## 实现与边界

- **代理处理**：删除生成器中复制的路径校验、认证、请求和响应处理代码。开发、预览及生成的部署入口统一调用 `registerProxyRoutes`。方法注册复用同一个 handler，保留二进制内容、两次大小检查、默认不跟随重定向及路径限制。SSR 公共声明使用最小路由注册接口，不引入 Hono 类型依赖；没有 `process` 的宿主延续生成入口原来的认证行为。
- **初始拒绝页**：Browser 与 SSR 交给 `createAppView` 做同一份错误展示转换，拒绝候选的页面和结构不进入展示快照。导航控制器继续保留未提交状态；SSR 不序列化候选业务数据。
- **公开缓存资格**：静态预渲染与运行时 HTML 缓存共用 `isPublicSSRResult`，统一拒绝含响应头、重定向、rewrite、非 200 或未声明公开的结果。运行时仍另外检查当前请求认证信息和渲染模式，并先执行请求守卫。

生命周期、请求作用域、取消代次和原生提交确认保持各自职责，没有合并语义不同的所有权。SSR 中每个请求只解析一次 Cookie 的局部上下文构造也予以保留，避免为调用一个包装函数而重复解析。

标准适配器自动提供代理注册绑定。自行消费 `generateProxyCode()` 的扩展需要在生成入口导入 `registerProxyRoutes`，具体见[代理代码生成](../packages/front/docs/zh/advanced/inline-proxy-codegen.md)。中英文说明已同步。

## 验证

- `vp check`：格式、lint、类型检查通过，零警告、零错误。
- `vp test`：**104 个文件、782 项通过**。新增真实拒绝转换、静态/运行时缓存资格一致性、构建后代理入口运行检查。
- `vp run -r build`：**17 项构建通过**。
- `verify-native-renderers.mjs`：React/Vue/Svelte × SSR/CSR/prerender 的 9 个组合通过；三框架初始 404、拒绝导航与重定向，以及 Svelte tabs/split/嵌套 stack 通过。
- `verify-runtime-boundaries.mjs`：本地 tarball 在六类独立消费者中导入及严格声明检查通过；纯运行时消费者明确未安装 Hono、各 UI 框架、Vite 和 Node 类型。
- 独立代码复核及验证脚本修正复核均无剩余重要问题。

浏览器验证发现了基线也有的验证环境问题：生成的静态 fixture 触发了尚未初始化的 Vue 热更新处理器，Vite 错误遮罩拦截点击。实际截图和点击目标已核实。测试服务器现在仅忽略 `reports/**` 产物的热更新，并使用正常可操作点击；页面源码仍被监听，没有关闭错误遮罩或弱化断言。完整浏览器验证随后通过。失败及诊断日志仍保存在证据目录。

## 本轮性能对照

比较对象为**本轮精简前的完整工作区快照**，保存在 `.worktrees/framework-dedup-baseline`，不是原生组合改造前的旧提交。两侧基础提交均为 `6f8d7c7`，各自包含完整未提交源码；`baseline-manifest.json` 记录逐文件哈希，测量前确认快照源码未变。Node 为 `v24.21.0`，锁文件哈希相同。先完成构建和验证，再顺序运行 SSR 与生产浏览器测量。

运行源码 **13,582 → 13,521 行**，净减少 **61 行**；排除注释的词法计数 **75,447 → 75,001**。文件数 **145 → 146**，新增文件承担共用缓存资格判断。六模板源码未变。计数是实现量，不代表性能收益。

每个客户端 JS 文件独立 gzip 后求和，单位字节：

| 模板           | 修改前 | 修改后 | 差值 |
| -------------- | -----: | -----: | ---: |
| react          | 86,863 | 86,871 |   +8 |
| react-minimal  | 87,550 | 87,553 |   +3 |
| vue            | 53,837 | 53,842 |   +5 |
| vue-minimal    | 54,270 | 54,269 |   -1 |
| svelte         | 42,367 | 42,367 |   +0 |
| svelte-minimal | 43,186 | 43,185 |   -1 |

最大增量为 8 字节，小于 0.01%；所有模板首屏静态 JS 仍为一个请求。这一轮不宣称客户端包体下降。

React minimal 生产 SSR，每侧三轮、每轮 20 次预热及 100 次测量：

| 指标                                 |   修改前 |   修改后 |
| ------------------------------------ | -------: | -------: |
| Request → Response.text 中位数（ms） | 0.130292 | 0.127167 |
| 响应 p95（ms）                       | 0.282625 | 0.213792 |
| 序列化中位数（ms）                   | 0.003458 | 0.003292 |
| heapUsed 采样中位数（MiB）           |   13.242 |   13.198 |
| RSS 采样中位数（MiB）                |   71.047 |   71.000 |

响应 HTML 仍为 2,222 字节，水合载荷仍为 791 字节。冷导入 5 个独立进程的中位数：根入口 1.707 → 1.709 ms、Browser 3.073 → 2.962 ms、完整服务端 11.994 → 12.139 ms。完整服务端有约 0.145 ms 的小幅增加；这组样本不足以声称启动耗时不变或有稳定提速。

生产浏览器每框架每侧 15 个新上下文、150 次导航，单位 ms：

| 模板           | 首次可操作中位数 | 导航中位数 |  导航 p95 |
| -------------- | ---------------: | ---------: | --------: |
| react-minimal  |      50.1 → 50.5 |  1.0 → 1.0 | 1.2 → 1.2 |
| vue-minimal    |      48.4 → 48.8 |  1.0 → 0.9 | 1.2 → 1.1 |
| svelte-minimal |      49.3 → 49.3 |  0.9 → 0.9 | 1.1 → 1.1 |

首次可操作按帧重试，包含点击 Notes 至显示页面，不是标准 TTI；导航为页内 MutationObserver 观察到可见 DOM 更新，不等于绘制完成。耗时与内存变化较小，本轮测量未见明显回退，也不足以宣称稳定提速或降低峰值内存。收益主要是一份代理执行代码、一份初始拒绝展示和一份缓存资格规则，减少后续行为分叉。

## 复现与证据

证据位于 `reports/framework-dedup/`，包括 `before.patch`、`baseline-manifest.json`、`check.log`、`tests.log`、`build.log`、`native.log`、`boundaries.log`、`measurements.json` 与 `browser-measurements.json`。浏览器及独立消费者详细结果沿用 `reports/native-renderers/` 与 `reports/application-boundaries/packed/`。

```bash
FINESOFT_NATIVE_BASELINE_ROOT="$PWD/../framework-dedup-baseline" \
FINESOFT_NATIVE_BASELINE_COMMIT=6f8d7c768c60b8ca131f49866ef15729eba7ca84 \
FINESOFT_NATIVE_BASELINE_WORKTREE=1 \
FINESOFT_NATIVE_OUTPUT=reports/framework-dedup/measurements.json \
vp exec node scripts/measure-native-composition.mjs

FINESOFT_NATIVE_BASELINE_ROOT="$PWD/../framework-dedup-baseline" \
FINESOFT_NATIVE_BROWSER_OUTPUT=reports/framework-dedup/browser-measurements.json \
NODE_ENV=production vp exec node scripts/measure-native-browser.mjs
```

上述为本地实现、构建产物和本地运行结果，不代表线上部署或客户设备验收。
