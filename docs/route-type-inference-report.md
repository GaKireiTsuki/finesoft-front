# 路由定义驱动参数类型：实施与验证

状态：已在本地实现并验证，尚未提交或推送。

后续已增加独立 Controller 类的自动类型维护，并将 ProductDetail 恢复为类与路由分文件；见 [实施与验证报告](./controller-type-generation-report.md)。2026-09-21 按用户要求移除了新增的内联 execute/fallback 对象支持，保留 handler、perform 工厂和独立类。下文保留前一阶段的实现与验证记录，不代表当前 API。

## 使用结果

参数类型只需在 `definePage.routes` 的 `params/query` 中定义。内联 `handler` 和 `create: () => ({ execute, fallback })` 自动获得参数及 `ExecutionContext` 类型；不再需要重复参数接口、`InferParams` 或业务侧断言。React full 的 ProductDetail 已迁移，Vue/Svelte full 由共享模板源同步。

- `int()` 推导为 `number`；字符串路由参数为 `string`；可选参数、默认值、列表和异步 Standard Schema 输出保持对应类型。
- 多路径别名形成参数联合；控制器必须能接收全部别名。复用 `route()` 或页面引用 `.route()` 也保留 codec 类型。
- 页面字面量 id 与参数关联传递至 `leaf`、`app.perform`、浏览器实例、模态回调和 SSR 视图；错误参数、未知页面和嵌套 compound 错误均可在编译期发现。
- 保留旧 `BaseController` 子类和 `perform` 工厂。对象式控制器直接复用 `BaseController.perform`，保留错误规范化、fallback、取消绕过恢复和每次调用创建实例的语义。

## 独立复核与修复

独立复核发现并修复两处 P2 问题：辅助函数返回值把 codec 字段变为可选，导致参数推导失真；方法参数双向协变允许范围过窄的控制器接受联合别名。已增加能复现问题的类型反例，再修正辅助函数返回声明和工厂参数兼容约束。复现失败与修复通过分别记录在 `reports/route-type-inference/review-repro.log`、`check-types.log`；没有遗留的复核修复项。

## 验证结果

| 验证              | 结果                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `vp install`      | 成功                                                                                         |
| `vp check`        | 格式、lint、类型检查通过，含接收方与调用方正反例                                             |
| 定向运行验证      | 8/8：参数转换、别名、恢复、取消、缺省 fallback                                               |
| `vp test`         | 110 个文件、891 项测试通过                                                                   |
| `vp run -r build` | 21 个构建任务通过                                                                            |
| 本地 tarball 安装 | portable、React、Vue、Svelte、Node、tooling 六类隔离消费者通过声明与入口检查；打包清单已恢复 |
| 浏览器验证        | 六套模板 preview 通过；三套 minimal 的生成入口与独立挂载通过                                 |
| 真实运行宿主      | Node、无 nodejs_compat 的 workerd，以及可移植产物入口隔离检查通过                            |

复核修复之后重新执行了检查、全量测试、构建与 tarball 矩阵；这次修正属于类型约束，浏览器流程的运行逻辑未改变。证据保存在 `reports/route-type-inference/`。

## 成本与边界

相对本轮开始时的工作区，框架 `src` 物理行增加 227 行，主要是类型映射与公开泛型声明。这是增加类型能力，并非减少框架源代码量。单文件 TypeScript 转译对比显示，实际执行分支仅涉及对象式控制器的分派及缺省 fallback 错误传播；没有增加运行时类型注册表、控制器包装实例或第二轮 Schema 校验。该对比不是生产吞吐量基准。

- 自动推导采用内联对象或内联 handler；独立类方法不能从外部路由配置反向获得上下文类型，原类式写法保持兼容。
- `leaf` 与结构化 Action 使用 codec 输出形状，默认值字段仍为必填；URL 导航省略默认值时由 Router 填充。
- 显式宽类型会丢失信息。保留工厂推导，路由形状校验可用 `satisfies PageRoute`，组件可引用 `WebAppView<typeof definition>`。显式可选 codec 映射按可能缺失处理，不能假定已经配置。
- 多个别名可匹配相同参数时仍需 URL 消除歧义；本轮未扩展原有 Router 的反向序列化能力。
- 保留本轮前所有工作区改动，不做提交、推送、发布或额外架构调整。

使用方式见公开的中英文导航文档以及 `templates/react/src/lib/controllers/product-detail.ts`。
