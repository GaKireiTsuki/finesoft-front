# 共用执行声明原型验证（2026-09-20）

**当前原型不合入主工作区。** 它实际删除了页面的第二个 Operation 表示和两个按 params 身份查询的 WeakMap，但完整替代实现使运行源码增加 **35 行、220 个非注释词法单元**；还复现了组合页面声明的快照回归。852 项测试通过不能覆盖这两个否决依据。

这次验证已采用用户新增的范围：API、包边界、模块及数据模型都允许调整。没有继续要求旧 export 和类型声明逐字节一致；保留的是能力、类型保障、生命周期和用户行为。本结果只否决这一份实现，不代表其他高层抽象也不可行。

## 实际改了什么

原来页面配置被转换成另一个 Core Operation，entryId、retained 和预取通过 execution.bindings 里的两个 WeakMap 间接传递。候选让规范化页面本身满足 Core 的执行声明契约，app 注册同一个页面引用；loadPage 将 PageAttempt 显式传给唯一的 Core 执行管线，控制器直接传入事务预取 stage。

| 删除或共用                                                  | 替代成本                                        |
| ----------------------------------------------------------- | ----------------------------------------------- |
| 合成页面 Operation、WebPlan.operations                      | 规范化页面声明及同一引用的页面索引              |
| WEB_EXECUTION、WebExecutionState、consumePage、两个 WeakMap | PageAttempt 类型及显式传参                      |
| 临时替换 execution.bindings 中预取缓存                      | loadPage 的事务预取参数                         |
| 策略、schema、取消、记录、资源释放继续共用 Core 原管线      | 泛型 metadata、缓存限制和三个执行入口的类型透传 |
| 外部 runtime 直接使用 definition.app                        | 组合 app 的页面登记和重新装配处理               |

没有新增运行依赖、通用绑定框架或第二条策略管线。原有 runtime implementation override 保留；不能因为页面现在可直接引用就新增 sealed 禁令，将已存在的替换能力删掉。

## 补丁与净减量

- 稳定基线：`c7b9f7b226e1d9ac40135f1b93aa5e04e85ef9d4`。
- 隔离工作区：`.worktrees/model-reuse`，分支 `research/model-reuse`；主工作区已有修复未被覆盖。
- [固定补丁](../reports/model-reuse/shared-execution.patch)，SHA-256：`c0b15d90454b5b13a4558ca7ae3d726651f5ac76eb6f285d64d874992b03c79a`。
- 14 个变更文件，包括 10 个运行源码文件及 4 个测试文件。测试/文档未计入运行源码。

| 指标           |      基线 |      候选 | 差额 |
| -------------- | --------: | --------: | ---: |
| 六包运行源码   | 13,765 行 | 13,800 行 |  +35 |
| 非注释词法单元 |    76,577 |    76,797 | +220 |
| 源码字节       |   527,245 |   528,189 | +944 |
| 运行源码文件   |       148 |       148 |    0 |

Core 净增 39 行，Web 净减 4 行。原型确实减少了中间对象和隐式传递，但在当前实现中，通用声明的类型、元数据规则和组装边界抵消了删码量。[逐文件测量](../reports/model-reuse/measurements.json)包含哈希。原目标仍是从 13,870 行减至至多 6,934 行，本原型没有推进这一目标。

## 验证与反例

- `vp install` 完成；最终 `vp check --fix` 无 warning/lint/type error。
- 32 文件、383 项受影响测试通过；全量 107 文件、**852 项测试通过**。
- 基线和最终候选的 **17 项构建均通过**，使用实际公共构建入口运行后续探针。
- 新测试覆盖显式 metadata 的并发与嵌套调用、metadata 缓存拒绝、跨 app 页面策略、外部 runtime 实际页面加载/释放归属/实现覆盖，以及相同 params 的不同 entry 预取与保留结果。

日志：[check](../reports/model-reuse/check.log)、[受影响测试](../reports/model-reuse/focused-tests.log)、[全量测试](../reports/model-reuse/full-tests.log)、[最终构建](../reports/model-reuse/build.log)。

风险审查发现下面的实际缺口，随后用基线和候选的构建入口复现：

审查使用 [Codex Security assess-patch-risk](/Users/megumi/.codex/plugins/cache/openai-curated-remote/codex-security/0.1.24/skills/assess-patch-risk/SKILL.md)，固定补丁覆盖 14/14 文件。建议为 `revise`；[风险报告](../reports/model-reuse/patch-risk.md)与[已通过 schema 校验的 JSON](../reports/model-reuse/patch-risk.json)保留补丁身份、证据和覆盖限制。这是补丁风险评估，没有冒充全仓安全扫描。

```ts
const supplied = { ...definePage({ id: "home", routes: ["/"], handler }), policies };
const definition = defineWebApp({ id: "app", pages: [supplied], getErrorPage });
policies.length = 0;
supplied.handler = replacement;
const web = createWebRuntime({ definition });
```

候选的 createPageDefinition 见到 `kind` 就直接返回 supplied，未保存装配时的快照。原始策略是拒绝访问时，基线仍返回 **403**；候选却执行 replacement 并成功返回页面。即使组件只是复用公共声明后调整配置，这个共享可变对象也会改变已装配应用的行为。

[可复现探针](../reports/model-reuse/verify-declaration-snapshot.mjs)及[结果](../reports/model-reuse/declaration-snapshot.json)。这是调用方配置变更导致的快照回归，没有证据表明存在远程攻击入口。新增元数据缓存限制、引用校验及现有策略执行顺序仍然有效，不能把局部问题夸大成所有授权失效。

由于候选已经同时未通过减量和稳定性门槛，保留原样作为被否决的实验，没有用更多包装修补它后宣称减量成功；未将这一回归带入主工作区。

## 局部性能对照

Node v24.21.0，每个场景每侧预热 300 次，计时 3,000 次，7 轮交替先后顺序。每侧共 **92,400 次页面加载**，逐次核对页面结果，并逐轮断言 app/page policy、实际 handler、嵌套业务调用、cleanup 次数及一次性预取消费。准备声明和填充预取发生在计时之前。

| 场景                   | 基线中位 μs | 候选中位 μs | 候选 / 基线 |
| ---------------------- | ----------: | ----------: | ----------: |
| URL 加载并嵌套业务操作 |      14.131 |      14.295 |       1.012 |
| 保留页面               |      10.618 |      10.539 |       0.993 |
| 一次性预取             |      12.656 |      12.596 |       0.995 |
| 注入外部 runtime       |      15.094 |      14.295 |       0.947 |

[脚本](../reports/model-reuse/measure-execution.mjs)和[全部样本及计数](../reports/model-reuse/performance.json)。样本范围重叠，不能据此宣称性能提升；这些是本地页面加载微基准，包含相同的断言开销，不是端到端浏览器或生产请求性能。

未对候选重跑 native 浏览器完整矩阵、HTTP 流断连、长期泄漏、部署平台或客户场景，也未测装配耗时。原型已在更早的减量及稳定性门槛失败，现有证据不构成“全部能力、稳定性和性能已证明保留”。

## 对后续共用方案的约束

共用仍应按同一语义、同一所有者设计，不能按相似代码外形合并生命周期。后续 WebSession 的价值必须来自真正删除 controller/view 的状态同步与重复索引；仅改名包装旧对象不够。观察者通知、Promise 结算和守卫短路属于小范围共用，不能预支成减半收益。

六模板原先另有 **1,422 行字节相同的重复副本**：full 每份 13 文件/463 行，minimal 每份 11 文件/248 行。后续已实施中立源码物化，连同中立 locale 类型和重复点击处理清理，模板维护源净减 1,493 行；扣除工具、配置与测试后合计净减 1,159 行。该收益不属于六包 runtime 减量，WebSession 仍未实施，详见[可行复用实施报告](feasible-reuse-report.md)。

## 复现

候选工作区依赖和构建完成后，在仓库根执行：

```bash
vp exec node --expose-gc reports/model-reuse/measure-execution.mjs \
  .worktrees/reduce-runtime .worktrees/model-reuse reports/model-reuse/performance.json
vp exec node reports/model-reuse/verify-declaration-snapshot.mjs \
  .worktrees/reduce-runtime .worktrees/model-reuse reports/model-reuse/declaration-snapshot.json
```

第二个探针返回 0 表示预期反例成功复现，不表示候选通过。本原型验证结束时，主工作区运行源码保持 13,765 行，未提交或合并该候选、未推送、未发布。后续可行复用改进的范围及新计数单独记录在实施报告中。
