# 重构后的旧接口兼容清理

检查范围：`packages/{core,web,browser,ssr,server,front}/src`，以及调用这些入口的模板、测试、验证脚本和公开文档。本轮删除已被当前契约替代的旧接口，不增加过渡别名或第二条执行链。

## 已清理

| 残留入口或分支                                                       | 当前用法                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Router.add(path, id, "csr")` 字符串重载                             | `Router.add(path, id, { renderMode: "csr" })`                                   |
| `Router.getRoutes()` 文本摘要                                        | `Router.getDefinitions()` 结构化元数据                                          |
| `startNodeHandler` 的函数式 handler 分支                             | 传入具有 `fetch` 的 `HttpHandler` 对象；部署生成器同步迁移                      |
| setup 模块的命名导出、任意函数猜测及无效默认导出的静默跳过           | 模块必须 `export default` setup 函数；开发、预览和部署生成器统一读取它          |
| `route()` / `PageReference.route()` 旧的三泛型重载                   | 从实际路由声明推导 params/query，保留有选项与无选项的当前调用形式               |
| `NavigationDispatchContext` 的 `{ container, navigation, url }` 包装 | `createContext` 直接返回 `NavigationContext`；Browser、SSR 和测试调用方同步迁移 |
| WebSession 对缺失 Web 定义的旧兜底                                   | 使用必需的应用定义和 `getErrorPage`；保留显式的会话错误页覆盖                   |
| `LoggerInterface` / `Page` 重复类型名称                              | 使用 `Logger` / `BasePage`                                                      |

旧导航包装的外层 container 和 url 已不参与执行。清理后，守卫的 DI 容器与取消信号仍由实际 execution 提供，cookie/header 继续由宿主上下文提供。预览加载无效 setup 模块时仍沿用原有的警告行为，但不会再尝试执行其它导出。

框架源码物理行数净减 **103 行**，包含类型和注释；没有把测试或文档计入该数字。

## 保留的当前能力

- 普通 URL 与结构化 Action、模态、单叶导航、Stack/Tab/Split、`markPublic`、DI 和请求隔离。
- 路由字符串数组、同一 Controller 的多路由、无 URL 的结构化目标、独立 Controller 与函数 handler。
- 未声明 schema 的 query 字符串、默认值/可选/多值 codec，以及缺省和空 query 的统一缓存身份。
- 应用显式配置的 session 切片迁移、协议版本不匹配时重新加载、安全网络地址检查。这些不是框架旧接口的兼容转发。
- 历史性能对照脚本中访问旧版本 API 的代码，用于运行历史基线，不进入发布包或生产执行图。

## 验证

- `vp install` 完成。
- `vp check --fix`：471 个文件 lint 和类型检查通过，未发现警告或错误。
- `vp test`：111 个测试文件、935 项测试通过；新用例先复现了命名 setup 被隐式执行、直接上下文被旧包装忽略的问题，再验证修复。
- `vp run -r build`：全部 21 个任务通过。
- 实际构建并启动生成的 Node 服务：默认 setup 注册 API、SSR cookie/header、query、403 拒绝、响应消费和关闭流程通过。
- 本地 tarball 的 portable、React、Vue、Svelte、Node、tooling 六类隔离消费者通过导入、依赖图和完整声明检查；类型断言确认旧 Router 字符串参数及 Node 函数 handler 被拒绝。

构建、真实 Node 服务和打包验证证据位于 `reports/compatibility-cleanup/`。以上为本地验证，清理与后续功能改动已分批提交至本地 Git，尚未推送或发布。
