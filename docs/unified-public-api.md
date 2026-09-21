# 统一公开 API

所有公开 API 从 `@finesoft/front` 导入，包括 Controller、路由、Action、浏览器、SSR、HTTP、Node、Worker、Vite 和原生 UI。旧的公开子路径已移除；内部构建入口继续隔离平台与 UI 依赖。

```ts
import { Outlet as selectOutlet, useSnapshot, type WebAppView } from "@finesoft/front";

const Outlet = selectOutlet("react");
// 在对应原生组件内调用：useSnapshot("react", app)
```

Vue 和 Svelte 分别使用 `"vue"`、`"svelte"`。选择参数使用字符串字面量。编译器将调用转换为选定实现的直接导入，保留原生组件身份、订阅和清理行为；业务层没有新的运行时组件注册表。React 的快照仍为 Hook，Vue 返回 ref，Svelte 返回 store。

## 自动维护类型

Vite 插件根据项目直接声明且已安装的依赖生成 `.finesoft/front.d.ts`，维护 tsconfig 中仅针对 `@finesoft/front` 的精确路径。React 项目不需要安装 Vue 或 Svelte，其他框架同理。JSONC 注释、已有选项、继承的路径和用户自定义入口均保留；内容未变化时不写文件。

依赖变化后重启开发进程。独立 TypeScript / Node 项目运行 `vp exec finesoft-types`，或从统一入口调用 `generateFrontTypes({ root })`。生成目录应被 Git 忽略。

类型入口不参与路由修改的热更新链路，Controller 类型继续使用原有增量监听与缓存。生成代码不会添加回 Controller 末尾的类型声明区块。

## 运行边界

- 浏览器和 Worker 使用可移植入口。Node 使用 Node 条件入口；编译工具和可选的 Node 监听器依赖按调用加载。
- 开启 Vite `resolve.tsconfigPaths` 时，编译器将生成的声明路径重新解析到对应运行时入口。依赖扫描也使用此处理；Worker SSR 不会被误判为 Node。
- 原生 UI 选择在各自的 SFC / JSX 编译前完成，使用所选框架的解析器识别 Vue / Svelte 脚本，并保留源映射。
- `BaseServerController` 的模块替换与私有依赖检查继续生效。SSR 直接执行，浏览器导航调用注册的服务端页面。登录策略仍由业务负责，Cookie 和响应头通过上下文工具显式传递。
- 六套脚手架统一使用上述 API，并声明开发与预览所需的 `@hono/node-server` 依赖。

## 验证记录

自动验证脚本和产物分别保存在下列位置；实现与迁移已分批提交至本地 Git，尚未推送或发布。

2026-09-21 最终结果：`vp check --fix` 对 491 个源文件完成检查，无警告或错误；`vp test` 的 115 个测试文件、968 项测试全部通过；`vp run -r build` 的 21 项任务全部通过。下列七组验收脚本均已通过。六套独立脚手架安装的包 SHA-256 为 `2b790bbd7cde8cec7b05c5f2639afa7acb120fc8cd51edb63e8a108dd60cd492`，与打包边界矩阵使用的产物一致。

- `scripts/verify-runtime-boundaries.mjs`：独立安装包、严格声明检查、可选依赖缺席、旧子路径拒绝、Node 网络策略。
- `scripts/verify-created-consumers.mjs`：六套真实脚手架在工作区外安装、原生类型检查、构建，以及开启 tsconfig 路径解析的冷启动和远程导航。
- `scripts/verify-template-renderers.mjs`：六套模板的预览、开发冷启动、SSR 水合、历史、会话和页面状态。
- `scripts/verify-native-renderers.mjs`：三套原生 UI 的 SSR、CSR、预渲染、布局、上下文、错误和提交时序。
- `scripts/verify-server-controllers.mjs`：服务端标记不进入客户端 JS / sourcemap / HTML，开发源码隔离、守卫、公开投影及显式 Cookie 工具。
- `scripts/verify-controller-types.mjs`：原生类型检查、params / query 改动和增量监听。
- `scripts/verify-portable-runtime.mjs`：Node 和不启用 Node 兼容的真实 workerd 执行。

导出清单比较记录在 `reports/unified-public-api/exports.json`：旧公开入口合计 412 个去重导出名，新根入口 416 个，缺失项为零。此检查覆盖名称保留；原生 UI 的参数化选择是本次明确的接口变更。

独立脚手架验收开启了 `resolve.tsconfigPaths`；另一次真实 Vite 解析验证覆盖客户端、Node SSR 和 Worker SSR，记录在 `reports/unified-public-api/resolution.json`。Worker 数据应用也在不启用 `nodejs_compat` 的 workerd 中运行通过。

本次实际开发测试发现并修正了原生选择转换晚于导入分析、声明路径进入运行时解析、Worker SSR 误选 Node 入口和独立模板缺少开发服务器依赖的问题。当前验收结果均包含对应修正。
