# 共用执行声明纵向原型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 证明页面与业务操作共用一个执行声明及执行管线，能否删除页面中间表示而保留全部受影响能力，并实测净减量。

**Architecture:** 页面本身成为 Core 已注册的可执行声明，页面附加的路由、控制器工厂与类型助手归 Web 所有。Core 泛型元数据显式传递 PageAttempt；复用原执行流程，不新增 BoundWork 框架、运行包或第二条策略管线。WebSession、模板物化和宿主收敛是独立后续实验，不以本原型通过代表其完成。

**Tech Stack:** TypeScript strict、Vite+ 0.2.8、Node ^22.18.0 || >=24.11.0、pnpm 11.20.0（通过 vp）。

**Spec:** [职责与数据模型收敛设计](../specs/2026-09-20-model-consolidation-design.md)

## Global Constraints

- 隔离工作区 `.worktrees/model-reuse`，分支 `research/model-reuse`，基线 `c7b9f7b226e1d9ac40135f1b93aa5e04e85ef9d4`；保留主工作区所有未提交修复。
- 用户允许调整全部 API/包边界，同时要求保留全部能力、稳定性和性能；先实施，再测试，不重复请求确认。
- 所有工具通过 vp；先 vp install；vp check 与 vp test 串行执行。
- 原目标 13,870 行；稳定基线 13,765 行；超过一半要求最终至多 6,934 行。原型只报告实测，不把局部删除或模板减量冒充目标完成。
- 替代实现、类型、绑定、消费者迁移全部计入；不以移文件、压缩格式、删注释或引入外部实现换取虚假降幅。
- 不推送、发布或部署。安全扫描与完整浏览器能力矩阵只有执行后才可声明通过。

## Review Focus

1. 同 params、不同 entry 并发：独立 PageAttempt，不从共享 execution 读写一次性页面状态。
2. app/page policy 拒绝：保留与预取页都必须先过策略；未通过的导航不提交预取 stage。
3. 外部 runtime：使用最终 app 的真实页面引用；同 id 的伪造声明不能运行，Web 不释放注入的 runtime。
4. 业务查询：metadata 未纳入查询 key 时拒绝缓存调用；既有不带 metadata 的 cache、schema 和取消行为保持。
5. 复用页面引用：definePage 的原引用直接注册；同页声明可装配进多个 app，不能捕获某一 app 的策略或缓存。

## Task 1: 让唯一 Core 执行管线携带泛型元数据

**Files:** 修改 `packages/core/src/application/types.ts`、`runtime.ts`、`operation.ts`；测试 `packages/core/test/application/runtime.test.ts`。

**Interfaces:**

```ts
type OperationHandler<I, O, M = undefined> =
    (input: I, context: ExecutionContext, metadata?: M) => O | Promise<O>;
// Operation<I, O, M> / Implementation<I, O, M> 引用同一个 handler 类型。
// Runtime.execute 的 invocation 仍为第三参，metadata 为第四参。
// ExecutionHandle 和 ExecutionContext.execute 的 metadata 为第三参。
execute<I, O, M = undefined>(operation: Operation<I, O, M>, input: I, metadata?: M): Promise<O>;
```

- [x] **实现元数据透传。** 复用已有 execute → invoke、running 集合、输入/输出 schema、policy 与错误映射；startCached 不接受元数据。已有普通操作无需迁移调用点。

```ts
if (operation.cache && metadata !== undefined)
    configuration("Cached operations cannot accept execution metadata");
// 在既有 invoke 内：
let output = await implementation.handler(input, context, metadata);
```

- [x] **实现后补充行为用例。** 注册有元数据的操作，确认策略看到 input，handler 收到独立 metadata；并发两次输入相同，结果各自对应传入元数据。带 cache 的 metadata 调用拒绝；正常缓存测试保持。

```ts
const op = defineOperation<number, string, { entry: string }>({
    id: "metadata",
    kind: "query",
    handler: (input, _context, attempt) => `${input}:${attempt?.entry}`,
});
const runtime = createRuntime({ app: defineApp({ id: "test", operations: [op] }) });
const scope = runtime.createExecution();
expect(
    await Promise.all([scope.execute(op, 1, { entry: "a" }), scope.execute(op, 1, { entry: "b" })]),
).toEqual(["1:a", "1:b"]);
await runtime.dispose();
```

## Task 2: 页面直接注册并移除元数据旁路

**Files:** 修改 `packages/web/src/application/{definition,page,types,runtime,load-page}.ts`、`packages/web/src/navigation/controller.ts`；测试 `packages/web/test/application/{definition,runtime}.test.ts`、`packages/web/test/navigation/controller.test.ts`。

**Interfaces:**

```ts
interface PageAttempt {
    readonly entryId: string;
    readonly retained?: BasePage;
    readonly prefetched: PrefetchedIntents;
}
// 页面执行声明与页面规范化结果是同一个对象。
// LoadPageOptions 增加可选 prefetched；导航事务传 stage.cache。
// defineWebApp 的返回值 .app 包含实际页引用，支持外部 createRuntime。
```

- [x] **在页面声明边界组装 handler。** 先消费本次 retained/prefetch，否则调用原 handler 或新建 controller.perform。definePage 引用复用时不重新生成执行声明；无类型助手的原始配置只规范化一次。保留必须恰有一个 handler/create 的配置检查。

```ts
const handler = (params: RouteParams, context: ExecutionContext, attempt?: PageAttempt) =>
    attempt?.retained ??
    attempt?.prefetched.get<BasePage>({ id: input.id, params }, attempt.entryId) ??
    (input.handler ? input.handler(params, context) : input.create!().perform(params, context));
```

- [x] **删除第二个 Operation 和共享 bindings。** 删除 WebExecutionState、WEB_EXECUTION、consumePage 和 WebPlan.operations。页面 id 索引保存同一个规范化声明；loadPage 将 params 与 PageAttempt 显式传入 execution.execute。控制器显式传预取 stage，提交阶段继续 stage.commit。

```ts
page = await execution.execute(declaration, params, {
    entryId: destination.entryId,
    retained,
    prefetched: options.prefetched ?? web.prefetchedIntents,
});
```

- [x] **实现后补充纵向用例。** 验证 root/page policy 顺序、拒绝不消费预取、同 params 两个 entry 不串、保留结果也过策略、外部 runtime 真实加载 URL 并且不被 Web dispose、声明跨 app 不共享策略；既有 beforeCommit 拒绝与预取 stage 回滚用例保持。

```ts
const runtime = createRuntime({ app: definition.app! });
const web = createWebRuntime({ definition, runtime });
expect(await loadPage({ web, target: "/" })).toMatchObject({ kind: "page" });
await web.dispose();
const probe = runtime.createExecution();
await probe.dispose();
await runtime.dispose();
```

## Task 3: 测量、审查与作出保留决定

**Files:** 报告 `docs/shared-execution-proof.md`；基准与原始测量放 `reports/model-reuse/`，不作为运行源码。

- [x] **格式和类型检查后运行受影响回归。**

```bash
vp check --fix
vp test packages/core/test/application packages/web/test/application packages/web/test/navigation packages/browser/test/action-navigation.test.ts packages/ssr/test
```

- [x] **度量格式化后的完整差额。** 运行现有 `scripts/measure-native-composition.mjs --source-only`，基线用主工作区当前 runtime；同时记录文件、字节与非注释词法单元。若增加代码，停止把此候选作为减量成果。

- [ ] **实际构建并做能力及性能对照。** 使用 vp run -r build；基线和候选运行相同 URL、双 entry、retained/prefetch 与外部 runtime 场景；预热后交替顺序计时，区分页面加载耗时和 app 装配耗时。执行次数、策略次数、输出与资源关闭必须相同。变化小于样本波动时不宣称性能提升。

- [x] **最终独立审查。** 核对实际 diff 的归属校验、元数据缓存限制、预取事务以及页面声明跨 app 使用；修正具体发现后仅重跑相关验证。通过局部门槛后再跑全量 vp test；不要用旧 baseline 结果冒充当前候选结果。

- [x] **报告决定。** 写明哪些机制实际消失、总量变化、测试和基准结果，以及 WebSession/模板/宿主尚未实施的范围。原型未经全部受影响能力验证前不应用到主工作区；不把“API 名称允许变化”误解成可丢能力。

## 执行结论

实现、审查与本地验证已执行；采用门槛未通过，剩余扩展验证已停止。格式、类型、383 项受影响测试、852 项全量测试和最终 17 项构建通过。运行源码净增 35 行，已违背减量目的；独立风险审查后又用构建入口确认组合声明快照回归。候选保留为被否决的证据，不修补后强行计为减量成果。

性能步骤只执行了四种页面加载场景，每侧 92,400 次调用，未测装配耗时或 native 浏览器完整矩阵；早期失败后未扩展这些验证。原型未提交或应用到 main，主工作区原有修复保留。最终证据见 [共用执行声明原型验证](../../shared-execution-proof.md)。
