# 独立 Controller 的路由类型自动维护

用户已选择由框架自动生成并维护源码中的类型引用。实现保留独立 `class`、集中路由注册以及 `execute` / `fallback` 执行方式，输入类型只在路由声明。

2026-09-21 后续调整：Controller 源码只保留自动维护的类型 import 和注解，统一使用 `BaseController<Input, Result>`，旧接口和旧声明区块迁移代码已移除。Query 与 params 的统一及本次验证见 [后续报告](./query-controller-types-report.md)。下面的证据记录的是首次实现。

## 使用结果

- `templates/react/src/app-definition.ts` 声明 `id: int()`；`lib/controllers/product-detail.ts` 恢复为独立 `ProductDetailController`。Vue/Svelte full 复用这份应用源码。
- 框架自动维护参数、上下文、基类泛型与文件末尾标记区块。`.finesoft/controller-types.d.ts` 是可再生声明，不提交；类中的类型引用提交到源码。
- `vp dev` 监听源码变化；模板的插件创建移到 `lazyPlugins` 外，`vp check` 读取配置时也执行生成。模板开启 Vite+ 原生类型检查，并声明 TypeScript 与 Node 类型开发依赖。
- 原生 TypeScript 语言服务能够补全参数、显示数字类型；改名或更换 codec 后会报告旧字段、错误方法访问。没有用 `any` 或过滤诊断制造类型提示。
- 多个路由注册同一类时合并输入联合；查询覆盖、可选字段和第三方 schema 复用 `RouteInputFor`。公开 schema 引用保留未导出类的名义类型身份。
- 既有手写类型保留。取消注册但仍保留的托管类保留最后一次输入契约，再次注册时更新；删除类后清除对应声明。
- 引用式 tsconfig 自动选择包含应用 `src` 的项目；多个候选时明确要求 `controllerTypes.tsconfig`，不会静默跳过。

## 边界与实现

生成器只属于 `/vite` 工具入口，按 TypeScript 符号定位 `definePage`、工厂返回类和 `BaseController`，不执行业务模块或构造函数。它复用框架现有输入推导、执行和恢复链，不添加运行时类型注册表、包装控制器或第二次 schema 校验。

生成声明先通过独立语义检查再写入；拒绝无法解析或退化为 `any` 的输入、无所有权标记的已有声明和根目录外的写入。源码写入前检查并发改动；格式化后的等价内容保留，重复生成不改文件。开发服务关闭时移除监听和计时器。

需要先运行 `vp dev`、`vp check` 或构建，才能在初次打开项目时生成声明。自定义工具链和直接 `tsc` 调用前可以调用同一个 `generateControllerTypes({ root, tsconfig })`；`controllerTypes: false` 可关闭自动维护。框架维护的类型引用会出现在源码中，业务不需要维护它们。

## 独立复核

一次独立只读复核发现三处实际问题：取消注册后的失效引用、未导出具名 schema 输出、solution tsconfig 遗漏。三个问题均添加失败复现，再完成修复；完整回归通过。没有延期的复核项。

选择保留取消注册类的最后输入契约，是为了允许已有类继续独立使用；它不再代表某条当前路由，重新注册会重新推导。

## 验证证据

证据目录：`reports/controller-type-generation/`。

- `vp install` 成功。
- `vp check`：468 个文件，格式、lint 与类型检查通过。
- `vp test`：111 个文件、904 项测试通过，包含 13 项生成器回归。
- `vp run -r build`：21 个任务通过。
- 实际 `vp check`：数字参数通过；codec 改为字符串后 `toFixed()` 报错；业务方法改正确后通过。
- 实际开发服务：本机保存路由后 1120 ms 自动更新声明，无重复写入循环。这是开发工具时延，不是生产性能指标。
- 本地 tarball：portable、React、Vue、Svelte、Node、tooling 六类隔离消费者的声明与入口检查通过；运行入口不包含生成器或 TypeScript 编译器。

- 六种脚手架：在仓库外安装本地 tarball，原生 `vp check` 类型检查、TypeScript / Vue / Svelte 对应检查及 client/SSR 构建全部通过。
- 浏览器：六模板 preview 的导航、返回和状态保留通过；三种 minimal 模板的生成入口与独立挂载通过。

以上均为本地验证，不代表发布、部署或生产性能压测。代码尚未提交或推送。
