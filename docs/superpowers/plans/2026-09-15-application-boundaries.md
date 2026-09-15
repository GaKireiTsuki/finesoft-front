# Application Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现经确认的通用执行内核、Web 应用组合与多环境接入，同步迁移消费者并验证接入成本。

**Architecture:** 保留已有 Controller、导航树、SSR 注入和平台适配的有效行为，逐项迁移到有明确所有者的边界。core 提供通用执行，web 提供页面模型，browser/ssr 提供呈现，server 分隔标准 HTTP、主机和构建入口。标准接入和高级接入使用相同执行实现。

**Tech Stack:** TypeScript、Vite+、Hono、React/Vue/Svelte、Web Request/Response/Streams、Vitest、实际浏览器与 Worker 运行时。

**Spec:** [已确认设计](/Users/megumi/Desktop/projects/finesoft-front/docs/superpowers/specs/2026-09-15-application-boundaries-design.md)

## Global Constraints

- 共同目标：复杂业务应用、同页多实例与嵌入、多运行环境、独立数据接口。四项全部进入本次设计与验收。
- 已确认：允许调整公开 API，同步迁移仓库内模板和文档，不要求旧接入兼容。
- core 不依赖 BasePage、DOM、History、Hono、Node 内置模块、Vite 或某个 UI 框架。
- 消费者使用 `@finesoft/front` 及明确的场景子入口，私有 workspace 不从发布产物泄漏。
- 一种行为只有一个执行所有者；便利函数不能再建立另一套执行语义。
- 使用 `vp` 运行全部包管理、检查、测试和构建；从 `vite-plus` / `vite-plus/test` 导入工具 API。
- Node `^22.18.0 || >=24.11.0`，pnpm `11.20.0`；保留 Vite catalog 现有稳定版本。
- 保留 SSR/CSR/prerender、Tabs/Stack/Split、公开数据控制、网络保护及滚动恢复回归约束。
- 普通页面/接口无需手动创建 Scope、维护内部 ID 或重复装配；模块、持久化和复杂导航按需启用。
- 可逆的本地编辑、测试和 git 可直接执行；不 push、部署、外发消息、改共享凭据或发布。
- 不覆盖用户改动；每项任务只提交自己的明确文件。用户已单独授权给 `.github/codeql/codeql-config.yml` 增加 `packages/web` 扫描路径；其余 CI 工作流不在修改范围内。

## Baseline and Execution

- 基线：`e22de64`（运行源码与 `22f2d23` 相同；仅确认文档及 worktree ignore）。
- 实施目录：`/Users/megumi/Desktop/projects/finesoft-front/.worktrees/application-boundaries`，分支 `refactor/application-boundaries`。
- 原始 `vp test`：91 个文件，753 项通过。
- 新 worktree `vp test`：89 个仓库测试文件，747 项通过；与原目录的差额是未入库的 2 个现状诊断文件、6 项断言。
- 原始 `vp check`：格式通过；8 个 TS6059 跨包 rootDir 错误，另有 1 个无意义 void 警告。Task 1 修正类型检查配置，后续异步会话迁移消除该 void 的语义歧义。
- 先执行行为回归，观察预期失败，再修改运行代码。纯移动/导出用依赖边界检查、类型检查和已有回归证明；不为机械移动写镜像测试。
- 每项任务保存 red/green 命令与结果、改动和限制，运行其覆盖检查，并本地提交。后续任务补齐中间迁移入口，最终不保留两条执行链。
- 任务依次实施；每项完成后独立审查规格与质量，控制器同时准备后续验收和文档。

---

### Task 1: Isolate the portable core and Web model

**Files:**

- Create: `packages/web/{package.json,tsconfig.json,tsdown.config.ts,src/index.ts}`; move Web source/tests from core with git history.
- Modify: `packages/core/src/index.ts`, `packages/core/src/dependencies/make-dependencies.ts`, `packages/core/src/http/{client,secure-fetch}.ts`, `packages/core/src/i18n/locale.ts`, `packages/core/src/logger/{console,local-storage-filter}.ts` and their focused tests.
- Modify: source/test imports, workspace dependencies, `packages/*/tsconfig.json`, relevant tsdown maps, root test coverage list and lockfile. Add the separately authorized `packages/web` path to `.github/codeql/codeql-config.yml`; do not edit workflows.
- Test: `packages/core/test/boundaries.test.ts`.

**Interfaces:**

- Produces: private `@finesoft/web` for Framework, Page, Router, actions, middleware, bootstrap, navigation, prefetch and session. Framework remains a Web orchestrator whose dispatch will use the Task 2 runtime.
- Produces: core service contracts and keys independent of default environment implementations. Keep existing Container/Intent APIs available while later tasks migrate their consumers.
- Produces: portable HTTP guard with explicit DNS lookup capability; Node resolver is in a Node-only module, browser selection of hostname-only policy is explicit. Missing required DNS must fail, never silently pass.
- Keeps: existing public entries temporarily reexport moved APIs so this task remains buildable; Task 7 removes broad root reexports.

- [ ] Add import-graph assertion for core value imports, including dynamic import of Node and imports reaching Web. The assertion should fail on the current graph:

```ts
test("core has no platform or Web dependency", () => {
    expect(findForbiddenCoreDependencies()).toEqual([]);
});
```

- [ ] Run `vp test packages/core/test/boundaries.test.ts`; record forbidden current imports. The graph helper lives in test utilities, never production.
- [ ] Move Web-owned modules and tests, split mixed pure/environment helpers, update exact imports. Reuse the standard schema interface in a core schema module so operations can validate without importing the Web router.
- [ ] Set an explicit shared TypeScript rootDir consistent with cross-package source paths; verify declaration output continues to use package entries. Do not mask errors with skip/type suppressions.
- [ ] Run boundary tests, full `vp test`, `vp check`, `vp run -r build`. Address import/build regressions and commit this boundary change.

### Task 2: One typed runtime with scoped execution and resources

**Files:**

- Create: `packages/core/src/application/{types,operation,definition,runtime,index}.ts`, `packages/core/src/dependencies/{token,providers}.ts`.
- Modify: `packages/core/src/dependencies/container.ts`, `packages/core/src/intents/{types,dispatcher,base-controller}.ts`, core index and generic HTTP signal handling.
- Test: `packages/core/test/application/{runtime,definitions,resources}.test.ts`, existing Container/Controller/HttpClient tests.

**Interfaces:**

- `defineOperation<I, O>({ id, kind: "query" | "command", input?, output?, handler?, policies?, cache? }): Operation<I, O>`; input/output use the existing Standard Schema protocol. Shared operations omit handler; colocated server-only operations may supply it.
- `implementOperation(operation, handler)` creates a typed binding. `defineModule({ id, dependsOn?, operations?, implementations?, providers?, policies? })` and `defineApp({ id, modules?, operations?, implementations?, providers?, policies? })` support static composition; direct app fields are the simple path.
- `createRuntime({ app, implementations?, providers?, capabilities?, recorder? }): RuntimeHandle` normalizes definitions once, rejects duplicate/unbound/unknown/cyclic dependencies and checks capabilities. Overrides are explicit by operation/token reference.
- `RuntimeHandle.execute<I,O>(operation: Operation<I,O>, input: I, invocation?: Invocation): Promise<O>` creates and disposes one execution; `createExecution(invocation?): ExecutionHandle` is the adapter escape hatch; `dispose(): Promise<void>` closes active scopes then owned runtime resources.
- `ExecutionHandle` supplies `context`, typed `execute(operation,input)`, `dispose()`. `ExecutionContext` supplies application/runtime/execution/trace IDs, `signal`, `container`, `get(token)`, inherited `execute`, bound `fetch`, read-only invocation `bindings`, and `onDispose(cleanup)`.
- `Invocation` supplies optional `signal`, `traceId`, `bindings`, locale/identity cache partition. No ambient mutable current request or user.
- `createToken<T>(id)` and `provide({ token, lifetime: "runtime" | "scope" | "transient", dependencies?, create, dispose? })` share the existing Container implementation. `resolve` remains usable for synchronous legacy values; `get` handles asynchronous providers. Owned cleanup is explicit; externally supplied values remain external by default.
- Classified `ExecutionError` includes code (`validation`, `denied`, `not_found`, `cancelled`, `failure`, `capability`, `configuration`), appropriate HTTP status and safe public message; unexpected internal causes are not public responses. Reuse HttpError where compatible.
- Existing IntentController/BaseController accept an execution context and are adapted into this dispatcher, preserving fallback except cancellation is never converted to success.

- [ ] Write runtime tests with plain data and no Web imports:

```ts
const double = defineOperation({ id: "double", kind: "query", handler: (n: number) => n * 2 });
const runtime = createRuntime({ app: defineApp({ id: "test", operations: [double] }) });
expect(await runtime.execute(double, 21)).toBe(42);
await runtime.dispose();
```

- [ ] Add tests that concurrent scopes see different request values, nested execution inherits policy/context/signal, runtime providers cannot capture scoped dependencies, async initialization deduplicates and retries after failure, cleanup is reverse dependency order and awaits pending initialization, closed runtime rejects calls.
- [ ] Add cancellation tests with actual AbortController: pre-aborted calls do not invoke handlers; delayed old results cannot enter cache. Query cache is opt-in, partitioned, invalidated explicitly; commands neither cache nor implicitly retry, and cancellation never claims rollback.
- [ ] Run focused tests to record failures, implement through the existing Container/Intent machinery, and add type assertions for operation inputs/results/tokens.
- [ ] Record operation lifecycle through existing EventRecorder with IDs, phase, duration and error code; observer failures cannot change business results, sensitive inputs are absent by default.
- [ ] Run focused tests, `vp check`, and commit. Document exact final signatures for Tasks 3/4.

### Task 3: Portable HTTP and Worker execution, shared SSR response assembly

**Files:**

- Create: `packages/server/src/{http,worker,node,ssr-handler}.ts` and focused tests.
- Modify: `packages/server/src/{app,create-server,start,index,internal-fetch}.ts`, `packages/server/src/adapters/{shared,node,cloudflare,vercel,netlify}.ts`; `packages/ssr/src/render.ts` only for response contract fields if needed.
- Create: platform fixture under `adversarial/runtime-app/` without adding a published package.
- Test: `packages/server/test/{http,worker,ssr-handler}.test.ts`, adapter shared tests, executable generated-entry test.

**Interfaces:**

- `defineEndpoint({ method, path, operation, decode, encode })` binds an explicit operation reference. Decode validates external input; encode explicitly exposes output and may return a Response. No implicit RPC exposure of registered operations.
- `createHttpHandler({ runtime, endpoints, context? }): (request: Request, bindings?: Record<string, unknown>) => Promise<Response>` resolves one execution per request. Scope lives through response consumption/cancellation when response has a stream; unmatched route, method mismatch, validation/denial/fault have deterministic HTTP results.
- `createWorkerHandler` wraps the same handler with host bindings and optional managed `waitUntil`. A DOM-free Worker can call Runtime directly; no Web initialization.
- `createSSRHandler({ template, render, serializeServerData, renderModes?, defaultLocale?, fetch? })` supplies standard Request/Response HTML assembly independent of Node/Vite. Node app and generated deployments import it instead of copying injection/cache/redirect logic.
- Node entry provides listener, Node DNS capability and resource teardown; tooling entry owns filesystem/Vite/generation. Hono remains an optional outer route integration.

- [ ] Write direct Request/Response tests for status, duplicate cookies/headers, redirects, public JSON projection, bad input, denied nested operation, cancellation and response stream cleanup after Response creation.
- [ ] Write generated-entry test that parses and imports the actual generated module and issues a request; current template newline defect must fail this test. Replace inlined SSR code with imports of the shared handler, retaining locale/renderModes/slots/internal-fetch behavior.
- [ ] Run failures then implement portable entrypoints and thin platform wrappers. SSR failures return safe messages; cache only explicitly eligible public responses, never personalize or replay Set-Cookie through shared cache.
- [ ] Add a real Worker runtime fixture using a local workerd harness; install only necessary development dependencies via `vp`. Run the same business operation and HTTP response contract under Node and workerd. Consult official runtime documentation for current harness APIs.
- [ ] Run server/SSR tests, check/build and generated artifact requests, then commit and record exact response lifetime contract.

### Task 4: Web definition, shared loading and independent page identities

**Files:**

- Create: `packages/web/src/application/{definition,load-page,types,index}.ts`.
- Modify: `packages/web/src/framework.ts`, navigation files (`types,nodes,keys,operations,serialization,controller,islands,codec`), route/bootstrap/middleware as needed.
- Modify: browser action handlers/navigation bridges and SSR render/navigation/create-render to use shared loading.
- Test: Web loading/identity/controller tests and existing browser history/flow-action tests.

**Interfaces:**

- `defineWebApp({ id, app?, controllers?, routes, navigation?, getErrorPage, frameworkConfig?, beforeLoad?, afterLoad? })` is an immutable reusable definition, without runtime instances. It derives controller operation registrations and route/view references once.
- Framework owns a Task 2 Runtime; page controllers execute through that runtime with the current scope. No independent unguarded controller execution path survives migration.
- `loadPage` owns URL/intent resolution, global + route + navigation before guards, controller execution, after guards, and redirect/rewrite/deny classification, shared by SSR, URL and tree navigation. Every visible destination receives applicable guards.
- Leaf/serialized leaf adds stable `entryId`; snapshot destinations/entries include `entryId` and separate resource key. `leaf(...)` allocates an identity, push/replace creates a fresh entry by default; explicit reuse targets an existing entry ID.
- Resource keys include execution partition when cache enabled. Page state/session/DOM are keyed by EntryId; SSR serializes those IDs and hydration preserves them.
- Navigation transactions propagate AbortSignal, serialize tree edits, invalidate stale URL transitions, and commit state once guards/data succeed. View-ready is awaited before history scroll restoration.

- [ ] Add shared loading regression expecting `global-before → route-before → navigation-before → controller → global-after → route-after → navigation-after` on the equivalent SSR/browser/structured paths; define missing route guards by resolving the route from the leaf destination.
- [ ] Add two equal-target entries with different drafts and one optional shared query result; serialization roundtrip preserves IDs and duplicate entry IDs are rejected.
- [ ] Add cancellation/guard failure tests showing no stale snapshot/cache/history commit and no afterLoad bypass for secondary Split targets.
- [ ] Run expected failures, integrate Runtime and shared loader, migrate all callers to the same execution contract. Remove defineNavigation's mirrored browser/SSR conversion helpers after consumers migrate in Task 6.
- [ ] Run navigation, SSR and existing scroll regression suites, `vp check`, commit and document identity/loader signatures.

### Task 5: Async session storage and explicit wire/state protocols

**Files:**

- Modify: `packages/web/src/session/{types,session-store,snapshot,navigation-adapter,scoped-state}.ts`, browser `session-bridge.ts`, `web-storage.ts`, `server-data.ts`, SSR `server-data.ts`/navigation transport.
- Create: `packages/web/src/protocol.ts` and focused protocol/state tests.
- Test: session, SSR allowlist, hydration and browser persistence tests.

**Interfaces:**

- `AsyncStorage` has awaited `get/set/delete`; missing reads are distinct from rejection. `capture()` stays synchronous; `persist/load/save/clear/restore` return Promises with truthful success/failure.
- State providers declare schema version, decoder and optional migration. Incompatible/failed slices are discarded independently with diagnostics; valid siblings survive.
- Framework wire envelope includes protocolVersion/buildId and explicit public payload; session schemas version independently. Browser rejects mismatched envelopes with an explicit fallback to fresh load.
- Default Page serialization projects base fields plus marked/public fields; arbitrary internal object fields are not emitted. Endpoint codecs remain independent of framework wire format.

- [ ] Add asynchronous storage failure/ordering tests, duplicate provider-key rejection, malformed navigation input, per-slice migration, wire mismatch and nested public projection tests.
- [ ] Run failures then implement a single async persistence path; debounce/queued saves serialize the latest capture and dispose waits registered work. Browser no-op storage reports unavailable rather than saved.
- [ ] Keep hydration before persisted restore; use stable per-instance persistenceKey. Remove assumptions that async unload saves necessarily finish.
- [ ] Run affected tests and check, commit. Update existing async callers so the repository remains type-correct before UI migration.

### Task 6: Standard browser/SSR renderers and all template migrations

**Files:**

- Rewrite: `packages/browser/src/start-app.ts`; update handle, navigation-islands, DOM restore, history/bridge and server-data ownership.
- Create: renderer modules within `packages/front/src/renderers/{react,vue,svelte}/` with browser/server subentries; no new workspace unless build isolation requires it.
- Modify: SSR standard startup wrapper using the same Web definition.
- Migrate: six `templates/*/src/{bootstrap,main,ssr,App}` and their view maps, package configs as needed; `adversarial/target-app` startup; create-app template tests.
- Test: browser startup/renderer conformance, actual browser fixture with two targets and a Web Worker.

**Interfaces:**

- `startBrowserApp({ app: WebAppDefinition, renderer, target, history?, persistenceKey?, session? }): Promise<BrowserAppHandle>` is the recommended entry. It automatically binds runtime/configuration, creates root or entry navigation, hydrates and restores optional session.
- Browser renderer: `mount({ target, page, context, hydrate }): { update(page): void | Promise<void>; dispose(): void | Promise<void> }`; same entry/view updates preserve component state. Root rendering consumes one snapshot; entry rendering consumes the same snapshot per entry.
- UI adapters provide the actual React/Vue/Svelte mount/hydrate/update/unmount and SSR render implementation from one view registry. Business templates own views/chrome, not renderer infrastructure.
- BrowserAppHandle has actual `navigate`, optional structured navigation/session handles, `framework/runtime`, and awaited `dispose`; no mandatory methods implemented by undefined casts.
- Browser history is owned once per window; memory history is per instance. Explicit target scopes DOM queries/prefetch/locale effects. Dispose releases handlers, subscriptions, timers, view roots and runtime; startup failure releases partially initialized owned resources.

- [ ] Add two-target tests for isolated stores/DOM/locale, rejected competing browser-history owner, memory history, unload/remount without duplicate listeners, startup-failure cleanup.
- [ ] Add renderer update tests preserving input draft on Page data refresh, root/entries hydration and session restoration. Use real UI renderer behavior, not only mock mount counters.
- [ ] Implement the standard startup and renderer adapters, remove parallel plain/flat-islands/structured loading engines while preserving their supported behavior through options.
- [ ] Migrate full/minimal templates to the same recommended startup shape and one view registry, retain their demonstrations and i18n/business behavior. Delete obsolete startup conversion APIs and copied renderer glue.
- [ ] Run browser/SSR tests, all six builds and real browser workflows including a DOM-free browser Worker operation. Commit with measured before/after integration files and glue.

### Task 7: Publish-safe entries, documentation and final acceptance

**Files:**

- Modify: `packages/front/src/{index,browser,web,http,node,worker,ssr,vite}.ts`, UI entry files, package.json, tsdown config, `scripts/{prepare-front-publish,restore-front-publish}.mjs`, front entry tests.
- Modify: `packages/create-app` consumers, README, `docs/architecture.md`, Chinese/English site docs and examples, `AGENTS.md` architecture section.
- Create: `scripts/verify-runtime-boundaries.mjs`, executable packed-consumer fixture/tests and final evidence under ignored reports.

**Interfaces:**

- Root exports portable operations/runtime/contracts/utilities; `/web` exports page/navigation definitions; `/browser`, `/ssr`, `/http`, `/node`, `/worker`, `/vite` isolate their environments.
- UI browser/server entries export standard renderer adapters without loading other frameworks. Optional peers are installed only for consumers choosing those adapters.
- Public dist is ESM and bundles private runtime packages; packed declarations do not leak private workspace imports. prepack/postpack transformations stay symmetric for every export/dependency update.

- [ ] Add actual packed-entry import tests, not only mocked barrel exports; browser/Worker consumers fail if Node/Vite or unused UI runtimes appear in their import graph.
- [ ] Implement explicit entry exports/build graph and migrate all documentation imports/API examples, remove stale startup instructions. Keep historical design documents clearly marked as historical rather than rewriting evidence.
- [ ] Run `vp check`, `vp test --coverage`, `vp run -r build`, package preparation/restore tests and packed installs. Exercise Node/workerd/browser Worker/data endpoints and three UI templates from built artifacts.
- [ ] Compare same-function baseline and new bundle size, cold-start and request timings; report methods and samples instead of claiming unmeasured improvement. Verify multi-instance disposal and simple onboarding tasks.
- [ ] Write final acceptance table for every design §12 scenario with exact evidence, fixes and any unverified boundary. Do not mark overall redesign complete unless all required scenarios pass. Commit final migration and obtain whole-branch spec/quality review.

## Plan Self-Review

| Spec requirement                                                           | Task    |
| -------------------------------------------------------------------------- | ------- |
| Portable core / environment boundaries                                     | 1, 3, 7 |
| Definitions, static modules, types, execution policies, provider ownership | 2       |
| Data HTTP, Node/Edge/Worker, cancellation, streams, background host tasks  | 2, 3, 7 |
| Shared page loading, tree/URL transactions, cache/entry identity           | 2, 4    |
| Async state, versions, public projection                                   | 5       |
| Multi-instance, same-entry update, renderers, ordinary startup             | 6       |
| Thin generators, packed consumers, docs/templates and dependency tests     | 3, 6, 7 |
| Complexity and comparable runtime costs                                    | 6, 7    |

Exact signatures may be refined by type/runtime evidence within the approved design. Record a refinement and its consumer impact in the execution ledger before dependent tasks begin; never silently add a second execution engine to avoid a migration.
