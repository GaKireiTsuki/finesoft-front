# 重构回归修复与验收

日期：2026-09-20。修复基于主分支 `329f549`，以下结果对应该提交加本次工作区修改。此前四轮审计确认的 11 项回归已修复，并在完成实现后执行整体测试、构建和浏览器验收。本记录不代表提交、推送或部署。

## 修复范围

| 序号 | 已确认回归                                   | 本次修复                                                                                                                                                           | 回归覆盖                                                                                          |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 1    | 标准浏览器宿主缺少 Action 执行链             | `WebAppView.perform` 连接现有 `ActionDispatcher`，支持 Flow、entryId 复用、Compound、External 和 `onModal`。模态复用现有导航控制器、策略和页面守卫，并随宿主释放。 | `packages/browser/test/action-navigation.test.ts`：执行链、守卫拒绝、模态重定向、取消和资源释放。 |
| 2    | 普通 URL 导航重建无关分支                    | URL 跳转通过现有控制器更新目标栈，保留其他分支、entryId 和页面实例；显式编码的导航状态仍按 codec 恢复。                                                            | Action 导航测试；三套 minimal 模板的 Notes → Feed → 详情 → Notes 草稿保留。                       |
| 3    | 原生 Outlet 包装层阻断 DOM 捕获              | 按所属 app 查找嵌套 entry，覆盖输入、change、pagehide 和 visibilitychange；保留嵌套独立 app 隔离。                                                                 | `packages/browser/test/dom-restore.test.ts`；三套 minimal 模板输入后直接刷新。                    |
| 4    | 外部 RuntimeHandle 缺少 Web 默认服务         | 在已有 execution 容器中补齐缺失的默认 provider，保留应用自定义 provider 和 runtime 所有权。                                                                        | `packages/web/test/application/runtime.test.ts`；公开产物外部 runtime 探针。                      |
| 5    | SSR 丢弃 resolveLocale 显式 dir              | SSR 结果保留 `resolveLocale` 返回的完整 locale，供响应装配使用。                                                                                                   | `packages/ssr/test/create-render.test.ts`；公开产物返回 `en-US/rtl`。                             |
| 6    | rewrite 未更新最终 renderMode                | SSR 结果使用最终 destination 的 renderMode。                                                                                                                       | `packages/ssr/test/render.test.ts`；公开产物 rewrite → CSR。                                      |
| 7    | 站内守卫重定向丢失 hash                      | 重定向目的 URL 保留 pathname、search 和 hash，并保留无关分支。                                                                                                     | Action 导航测试的重定向 fragment 与页面身份断言。                                                 |
| 8    | SSR 默认 Storage 跨请求共享                  | SSR owner 的默认 Storage 使用 execution 生命周期；同一请求内共享，不同请求隔离。浏览器默认共享行为不变。                                                           | SSR split 页面在单请求内读写；连续请求探针读值均为空。                                            |
| 9    | 缺失可选路径参数覆盖 query 值                | 未捕获的可选 path 参数不写入 `undefined` 属性。                                                                                                                    | core path / Web router 测试；`/users/:id?` 对 `/users?id=42` 得到 `id: "42"`。                    |
| 10   | FeatureFlags 命中后继续访问低优先级 provider | string / number getter 遇到首个已定义值立即返回。                                                                                                                  | Web runtime 测试；低优先级 provider 抛错探针确认未调用。                                          |
| 11   | execution locale 与 Translator 不一致        | Translator 根据本次 execution locale 延迟解析，由已有 scope 缓存。                                                                                                 | Web runtime 测试与公开产物探针：`fr-FR` 返回 `Bonjour`。                                          |

宿主适配沿用现有 Dispatcher、导航控制器、页面加载与 DI 实现，没有恢复旧 Framework 或第二套导航系统。默认 provider 共用一处定义，Translator 不创建无界的 locale 缓存。另补充浏览器 URL 协议校验：普通导航和守卫重定向限 HTTP(S)，External Action 额外支持 mailto/tel，拒绝可执行地址。

## 验收结果

- `vp install`：依赖已同步。
- `vp check`：格式、lint、类型检查通过。
- `vp test`：107 个测试文件、844 项测试通过。
- `vp run -r build`：17/17 个构建任务通过。
- 生产 preview + 真实 Chrome：React、Vue、Svelte minimal 的直接刷新及跨分支导航共 6 个场景，草稿全部保留，无 pageerror。
- `vp exec node scripts/verify-native-renderers.mjs`：14 组结果通过，包含三个框架 × SSR/CSR/prerender、Worker、Svelte 组合树和三个框架的 404/守卫拒绝/重定向就绪；同时验证多实例隔离、上下文、会话、浏览器后退与释放。
- 重建后的公开 front 产物探针：外部 runtime、FeatureFlags、Translator、SSR Storage、locale dir、rewrite renderMode、可选路由 query 均符合预期。

原生浏览器脚本同步修正了输入框定位：当前页与保留页分别断言，并新增保留草稿和后退后活动 entry 的检查。此前脚本假设 URL 导航卸载全部旧页面，不能继续用该假设验收本次修复。

本地运行证据位于 `reports/removal-fixes/browser/results.json`、`reports/removal-fixes/probes/fixed-probes.json` 和 `reports/native-renderers/results.json`。`reports/` 不随仓库提交；持久回归覆盖保存在上述测试文件与原生浏览器脚本。原 `reports/removal-audit/` 的失败记录和截图保留为修复前证据。

## 体积与耗时

对同机、相同依赖和生产构建下修复前后的六套模板，统计浏览器 JS 产物 gzip 总字节数：

| 模板           | 修复前 | 修复后 |  增量 |
| -------------- | -----: | -----: | ----: |
| React          | 87,566 | 88,580 | 1,014 |
| React minimal  | 88,239 | 89,248 | 1,009 |
| Vue            | 54,554 | 55,598 | 1,044 |
| Vue minimal    | 54,974 | 56,008 | 1,034 |
| Svelte         | 43,075 | 44,086 | 1,011 |
| Svelte minimal | 43,890 | 44,893 | 1,003 |

恢复上述能力后，每套模板增加约 1 KB gzip。简单 SSR Request → Response 消费探针预热 100 次后测量 5 轮、每轮 200 次：修复前各轮中位数 0.033–0.054 ms，修复后 0.034–0.057 ms；p95 分别为 0.043–0.116 ms 和 0.046–0.106 ms。该本地微基准未显示明显退化，但存在预热和调度噪声，不能替代真实业务并发压测。数据与脚本保存在 `reports/removal-fixes/{before.json,after.json,measure.mjs}`。

本次只处理已确认的 11 项回归。默认会话存储策略、旧生产启动便利功能的迁移说明，以及后缀路由语义属于此前另列的迁移差异，不在本次修复范围。
