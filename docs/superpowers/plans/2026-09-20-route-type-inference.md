# 路由定义驱动参数类型 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation and one final independent review. Preserve all existing workspace changes.

**Goal:** 用户只在页面路由声明 path、params 和 query，由框架推导接收方参数及调用方参数，不重复写参数接口、InferParams 或断言。

**Architecture:** 复用原有运行时 Router 校验和 Action 执行链。补全路由输入的类型推导，保留页面字面量 id 与参数映射，通过应用定义传给浏览器、会话和 SSR 视图；不创建运行时类型注册表或生成业务代码。

**Tech Stack:** 当前 TypeScript、Standard Schema、Vite+，不增加依赖。

**Spec:** 本文件的契约与执行步骤。

## Global Constraints

- 保留当前未提交的生命周期、Action 和职责收敛改动；本轮不提交、不推送。
- 使用 vp；先实施再测试，运行必要的类型正反例及真实运行链验证。
- 运行时参数校验只由现有 Router 完成，不重复执行 Schema、不改变缓存/守卫/取消/资源释放。
- 字符串路由仍支持多路径，默认路径参数为 string，带 ? 的参数可选。
- 对象路由的 params/query 输出类型覆盖默认字符串类型；多个别名合并为输入联合，不把不兼容参数伪装为一种类型。
- 保留外部类式 Controller；独立类方法不能由调用点反向推断。零注解写法使用现有 create 工厂返回 execute/fallback（或 perform）对象，或内联 handler。

## Review Focus

- 可选 path、optional/default/list query、异步 Standard Schema 输出与实际参数一致。
- 多路由共享页面时参数联合与 route codec 键拼写检查准确。
- create 返回对象的参数/context 与 handler 同样获得上下文类型，无隐式 any。
- typed app.perform 的 intent、必需 params、compound 子动作、selectColumn 清空行为正确；宽类型旧入口仍兼容。
- 公开打包声明保留推导，跨 browser/ssr/UI 子入口可赋值，不依赖私有类型品牌。

## Task 1: 从路由声明推导页面接收参数

**Files:** web/src/bootstrap/define-routes.ts、web/src/application/{page,types,route-input}.ts、web/src/index.ts。

- [x] 以 PageRoute 表示不含 intentId 的页面路由声明；RouteDefinition 复用该声明并加 intentId，删除失效的 Omit controller。
- [x] 通过纯类型映射推导字符串 path、codec 输出及 query 输出；query 覆盖同名 path 的规则跟随 Router。
- [x] definePage 的带 routes 重载为 handler/create 提供推导参数及 ExecutionContext；无 routes 的旧写法保留。
- [x] PageReference 保留页面 id 字面量及 leaf 参数类型。
- [x] 增加类型断言：id:number 可调用 toFixed；string 路由的 id 为 string；异步 schema、别名联合、optional/default/list 和非法 codec 键均覆盖。

## Task 2: 把页面参数关联传到 Action 与宿主

**Files:** web/src/actions/types.ts、web/src/application/{types,definition,view,runtime,session}.ts、browser/src/start-app.ts、ssr/src/create-render.ts。

- [x] Action、TreeAction、CompoundAction 接收默认宽类型的参数映射；有已知页面映射时，intent 为页面 id 联合，params 是否必填由页面输入决定。
- [x] defineWebApp 保留 pages 泛型；WebAppView、ViewProps、WebSession、BrowserAppHandle、SSRRenderConfig 透传同一应用定义。
- [x] 原有对象直接满足新的接口，不增加导航包装或运行时注册层。
- [x] 验证已知 intent、错误参数、缺少参数、递归 compound、selectColumn 清空、不同应用隔离，以及可赋值到通用 UI Outlet。

## Task 3: 示例、验收与复核

**Files:** web/browser/ssr 类型断言与运行测试、公开中英文导航文档、打包消费者脚本。

- [x] 添加运行用例：共享两条路由的 Controller 收到数值 id 和 query 输出，字符串参数及无效参数拒绝行为保留。
- [x] 更新使用示例为仅定义路由参数；说明独立旧类和显式宽类型擦除推导的边界。
- [x] 执行 vp check、vp test、完整构建，验证真实打包消费者的正反例；静态检查与创建临时源文件的测试串行运行。
- [x] 独立复核本轮增量、记录代码量和未改变的运行时路径。发现问题修正后完成对应验证。

## 执行记录

- 初始工作区快照：reports/route-type-inference/before.patch。
- 已确认旧版 handler 参数是 RouteParams，原始 Action 接受错误的字符串 id；InferParams + 手写参数引用可以工作。以上由 TypeScript 编译探针确认。
- 执行方式：本任务已有明确实施授权，依照用户 AGENTS.md 连续执行，不因技能流程重复请求确认；保留主工作区当前改动，避免丢失未提交上下文。
- Ruling: 自动推导的 Controller 对象同时支持 execute/fallback，直接复用 BaseController.perform 的取消和错误恢复逻辑，不再实现一份包装器；否则迁移示例会丢失既有 fallback 能力。用户已同意将临时 ids 类型试验随示例迁移。

- 完成：独立复核的两处 P2 已修复；最终 vp check、891 项测试、21 项构建任务和六类打包消费者通过。浏览器与真实 Node/workerd 验证通过，实施报告见 docs/route-type-inference-report.md。
