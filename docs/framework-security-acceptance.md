# 框架安全检查与修复验收

日期：2026-09-20。工作区：`refactor/application-boundaries`。本次在原有原生组合与去重实现之上修复，没有覆盖此前工作。状态：本地实施与验证完成；未提交、推送或部署。

使用 Codex Security 的 `security-scan` 和 `fix-finding`，完成一次标准审计、修复前独立边界调查、一次修复后独立复核。扫描 ID：`daa88759-fa1e-4848-8831-d697c757f184`。扫描封存的是修复前状态，六项发现均已在本工作区修复；没有改写封存结果或关闭工作台发现。

## 范围与结论

逐文件检查了扫描时全部 148 个运行时 TypeScript、声明及 Svelte 文件，覆盖 core、web、browser、ssr、server、front，并检查模板、站点、脚手架及构建边界。整个仓库的覆盖状态仍为 partial：开发验证脚本和测试仅抽查，不是依赖 CVE 普查，也不代表所有部署环境均已验收。

确认 5 项中风险、1 项低风险，六项 outcome 均为 `fixed`。另外修复一项导航分支键的稳定性问题，没有将其夸大为已证实的原型污染漏洞。

| 发现 / ruleId                          | 原路径与必须保持的边界                                                        | 修复及实际复现结果                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unguarded-fetch-redirect`（中）       | 用户 URL → secureFetch / HttpClient → 自动重定向；每一跳均须通过目标地址校验  | 共用 `fetchWithRedirects`。修复前私网服务收到 1 次请求并泄露测试内容；修复后 0 次，返回 HostGuardError。十进制 IP、IPv4 映射 IPv6、协议相对地址及反斜线变体均有回归覆盖。             |
| `dns-check-connect-race`（中）         | DNS 预检后 native fetch 再解析；实际 socket 必须使用同一批已检查地址          | Node `nodeSafeFetchOptions` 在连接 lookup 中检查全部地址并直接交给 socket。真实 Node fetch 的公开预检 + 私有连接 DNS 组合被拒绝，本地内部服务 0 次命中；显式可信 opt-out 对照仍成功。 |
| `proxy-cross-origin-redirect`（中）    | 开启 followRedirects 的代理 → 上游重定向；后续请求仍须留在配置 origin         | 代理复用同一逐跳执行器并检查 origin。修复前返回内部测试内容（200）；修复后 502，未访问内部目标。同源重定向及默认 manual 行为保留。                                                    |
| `unbounded-proxy-buffer`（中）         | 代理先读完整 arrayBuffer 再判断 10 MiB；必须在读取过程中限制体积              | 一处 `readProxyBody` 逐块计数并取消上游。32 个 1 MiB 数据块的对照由全部读取变成读到第 11 块即取消；缺失或谎报 Content-Length 均覆盖。正常二进制响应按字节保留。                       |
| `ssr-locale-attribute-injection`（中） | 请求派生 locale → SSR / CSR html 属性；数据不得变成标记或脚本                 | 在共同的属性插入点转义。真实 Chrome 对 lang / dir × SSR / CSR 四个场景：修复前执行脚本，修复后均不执行，且属性读回仍等于原始字符串。                                                  |
| `fixture-query-path-traversal`（低）   | 本地 adversarial fixture 的 q → 拼接路径 → readFileSync；只能读取合法查询标识 | 仅允许 1–128 字符的字母、数字、下划线及连字符。真实构建后的 SSR `/search?q=../../package` 不再暴露 package.json；默认 `/search` 正常。此项属于测试应用，不是已证实的生产漏洞。        |

导航 tabs 的反序列化使用无原型字典与自有属性判断；`__proto__`、`constructor`、`toString` 可以作为显式分支名往返保存，继承属性不能冒充分支。

## 实现边界与去重

- `core/src/http/redirect-fetch.ts` 是受保护请求和代理的共同重定向实现。HttpClient 复用 secureFetch，删除重复目标校验配置和调用。
- `server/src/node/fetch-policy.ts` 只负责 Node 连接阶段；保留注入的 fetch、请求取消、连接复用和 TLS 主机名。开发、预览、预渲染及 Node/Vercel/Netlify 生成主机引用同一策略。
- `server/src/proxy.ts` 只有一处响应体限额实现；生成主机仍调用共享运行时。
- `ssr/src/inject.ts` 的同一属性插入点服务 SSR 与 CSR，不增加新的 HTML 渲染层。
- 中英文 HTTP、代理生成及二进制处理文档同步更新。模板业务代码未因本次修复增加包装层。

相对修复前快照，运行时源码净增加 2 个文件、165 行、1,093 个非注释词法单元。这些是缺失的逐跳和连接阶段控制，不以减少行数代替安全正确性；未新增缓存、状态、事件或执行框架。

独立复核发现初稿将 Node 传输实现仅声明为可选 peer，会令干净消费者首次请求失败。已改为随公开包提供按需加载的传输 chunk。六种独立安装均通过，Node 消费者明确没有安装 undici 仍可加载传输并阻止私有 DNS 地址。

## 按验证关卡记录

1. **最终差异、类型和构建。** `vp install` 完成；`vp check --fix` 及最终 `vp check` 通过；`vp run -r build` 的 17 个工作区通过；`git diff --check` 通过。仅格式化和报告更新发生在最终构建之后，没有变更运行时代码。
2. **原攻击与另一类输入。** `vp test packages/core/test/http packages/server/test/proxy.test.ts packages/server/test/node packages/ssr/test/inject.test.ts packages/web/test/navigation/codec.test.ts packages/web/test/navigation/serialization.test.ts`：12 文件、176 测试通过。`vp exec node scripts/verify-security-boundaries.mjs`：修复前/后的真实 HTTP、Chrome、构建产物 SSR 对照通过。Node 连接策略额外 7 测试通过，覆盖混合 IPv4/IPv6 DNS 结果、实际连接以及覆盖不安全 dispatcher。
3. **正常行为与所属包检查。** `vp test`：106 文件、820 测试通过。`vp exec node scripts/verify-runtime-boundaries.mjs`：portable / React / Vue / Svelte / Node / tooling 六种干净消费者通过，严格声明检查未使用 skipLibCheck；portable、browser、Worker 依赖图没有 Node 或未选择 UI 依赖。`vp exec node scripts/verify-native-renderers.mjs`：三种 UI × SSR/CSR/prerender 九种组合、初始 404 / 拒绝导航 / 重定向、Svelte tabs/split/嵌套 stack 和 Worker 模块共 14 项结果通过。

第一次同时运行打包检查和开发浏览器检查时出现 Vite 遮罩，点击失败；首次失败没有保存遮罩原文，不能据此认定运行时缺陷。将浏览器检查独立运行后全通过，脚本增加了失败时读取遮罩的诊断。没有强制点击、禁用遮罩或跳过断言。独立打包验证曾因 Node assert 对嵌套 Error 的完整比较而失败；实际错误已是 HostGuardError，改为检查 cause.name 后通过。

## 性能与资源

基线是同一提交 `6f8d7c768c60b8ca131f49866ef15729eba7ca84` 加修复前完整工作区快照（`../framework-security-baseline`），不是历史开发服务器数据。两侧均完成生产构建，Node v24.21.0。测量时不并行运行构建或测试。

| 本地指标                                            |        修复前 |        修复后 |
| --------------------------------------------------- | ------------: | ------------: |
| React minimal SSR 中位耗时（各 300 请求，三轮交替） |   0.127042 ms |   0.129125 ms |
| SSR p95                                             |   0.240459 ms |   0.240125 ms |
| 序列化中位耗时                                      |   0.003416 ms |   0.002958 ms |
| HTML / hydration 数据                               | 2,222 / 791 B | 2,222 / 791 B |
| 完整服务端入口冷导入中位数（各 5 次）               |     12.542 ms |     12.609 ms |
| SSR 采样 heap 中位数                                |  13,872,560 B |  14,055,696 B |
| SSR 采样 RSS 中位数                                 |  74,596,352 B |  74,481,664 B |
| Node 首次受保护调用中位数（各 5 个新进程，无网络）  |      0.933 ms |      9.825 ms |
| Node 后续受保护调用中位数（各 2,500 次，无网络）    |   0.007583 ms |   0.009042 ms |

Node 首次调用增加约 8.9 ms，用于加载连接策略所需传输实现；后续调用增加约 1.46 µs。此隔离测量使用固定公开 IP 和返回 Response 的注入传输，不包含网络或 DNS 时间。Node 专用延迟加载 chunk 为 944,591 B，单独 gzip 214,688 B；它不进入浏览器或 Worker 图。

| 模板客户端 JS gzip（逐文件压缩后求和） |   修复前 |   修复后 |  增量 |
| -------------------------------------- | -------: | -------: | ----: |
| React                                  | 86,871 B | 87,566 B | 695 B |
| React minimal                          | 87,556 B | 88,239 B | 683 B |
| Vue                                    | 53,844 B | 54,555 B | 711 B |
| Vue minimal                            | 54,268 B | 54,973 B | 705 B |
| Svelte                                 | 42,368 B | 43,073 B | 705 B |
| Svelte minimal                         | 43,188 B | 43,887 B | 699 B |

真实 Chrome 生产浏览器对照：每侧每种 UI 15 次新上下文、150 次导航。React/Vue/Svelte 首次可交互中位数分别为 49.4→50.3、49.3→48.8、49.7→48.4 ms；导航中位数分别保持 1.0、1.0、0.9 ms。未观察到明显持续性能退化；这些本地短时样本不代表线上延迟、长期泄漏或高并发压力验收。

超大代理响应现在在越过 10 MiB 时取消，上游已经交付的单块无法撤销，最终字节拼接也有额外分配，因此不声称进程内存严格小于 10 MiB。并发量和总时长限制仍由部署/应用策略控制。

性能命令使用现有 `measure-native-composition.mjs`、`measure-native-browser.mjs`，分别设置 `FINESOFT_NATIVE_BASELINE_ROOT` 为修复前快照、`FINESOFT_NATIVE_BASELINE_COMMIT` 为上述提交、`FINESOFT_NATIVE_BASELINE_WORKTREE=1`，输出到本次证据目录。Node 首次/后续调用的隔离测量与全部原始样本保存在 `fetch-measurements.json`。

## 兼容性与未覆盖边界

- 受保护 fetch 最多跟随 20 次重定向。跨源请求移除认证/Cookie 请求头，代理开启 followRedirects 后只允许同源跳转。
- 浏览器不可见的 opaque redirect 无法逐跳验证，现明确拒绝。需重发 body 的跳转不会缓冲或重放 Request.body / ReadableStream；可使用可重放的 RequestInit.body 或最终 URL。该收紧已写入公开文档。
- `allowInternalHosts: true` 仍是完全退出保护的显式配置。自定义 Node fetch 必须遵守 dispatcher 选项；单独的 DNS 预检不能约束任意自定义传输。
- Cloudflare hostname 策略没有 Node socket 接口，其 DNS/网络隔离仍由平台执行。此次没有 Cloudflare 线上连接证据，不将其表述为已完成的 socket 绑定验证。
- 没有生产部署、外部服务或客户环境验收；扫描也不证明未来新路径不存在漏洞。

## 证据

- [攻击修复前后对照](../reports/framework-security/boundary-reproduction.json)
- [全量测试](../reports/framework-security/tests.log)、[检查](../reports/framework-security/check-final.log)、[构建](../reports/framework-security/build.log)
- [独立消费者结果](../reports/application-boundaries/packed/result.json)、[原生交互结果](../reports/native-renderers/results.json)
- [产物与 SSR 测量](../reports/framework-security/measurements.json)、[浏览器测量](../reports/framework-security/browser-measurements.json)、[首次请求成本](../reports/framework-security/fetch-measurements.json)
- 本次精确安全补丁、文件摘要和封存扫描链接见扫描目录下 `artifacts/fix_report.md`；补丁以修复前快照为基线，排除了此前架构工作。

扫描工具返回的累计计量：输入 12,259,881 tokens（其中缓存输入 11,420,288），输出 75,403，合计 12,335,284，reasoning 输出 16,193，覆盖 8 个线程，计量来源 codex_rollout。该数值是工具累计统计，不能解释为本次新增修复单独消耗或费用。
