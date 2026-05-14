# `@finesoft/front` 文档

> **语言：** **简体中文**（当前页） · [English](../README.md)

全栈 TypeScript 框架 —— 路由、DI、Action、SSR、服务器，一个包搞定。支持 **Vue**、**React**、**Svelte**。可部署到 Node.js、Vercel、Cloudflare Workers、Netlify 或静态托管。

## 三个入口

按需要选择起点。

### 新手 —— 按顺序读完

线性路径。每章都基于前一章。读完你能构建、渲染并部署一个真实应用。

1. [快速开始](./01-getting-started.md) —— 安装、Vite 配置、第一个页面
2. [路由与 Controller](./02-routing-and-controllers.md) —— 路由定义、Intent、Controller、渲染模式
3. [中间件](./03-middleware.md) —— `beforeLoad` / `afterLoad`、redirect / rewrite / deny
4. [渲染与 Hydration](./04-rendering-and-hydration.md) —— SSR / CSR / Prerender、`PrefetchedIntents`
5. [国际化](./05-i18n.md) —— `locale`、`Translator`、字典加载、RTL
6. [HTTP 客户端](./06-http-client.md) —— `HttpClient` 子类化、拦截器、`HttpError`
7. [DI 容器](./07-di-container.md) —— 注册、scope、`DEP_KEYS`、dispose
8. [可观测性](./08-observability.md) —— `Logger`、`EventRecorder`、Impression 追踪、`ReportCallback`
9. [服务器与部署](./09-server-and-deployment.md) —— `createServer`、proxy、adapter、Vite 插件
10. [Feature flags、平台、PWA](./10-features-platform-pwa.md) —— 特性开关、平台检测、PWA 模式

### 已经在维护项目的工程师 —— 直接看实践

横切关注点和约定。先理解基础后再读。

- [项目结构](./engineering/project-structure.md) —— 推荐布局、`bootstrap.ts` 拆分、单一来源
- [测试](./engineering/testing.md) —— Controller、中间件、scoped DI、mock 框架
- [CI 与发布流程](./engineering/ci-release-flow.md) —— changesets、内联发布 workflow、版本对账

### 碰到问题 —— 直接看陷阱

每一篇都是 **症状 → 根因 → 修法**，简短。

- [SSR Hydration 不匹配](./pitfalls/ssr-hydration-mismatch.md)
- [SSR 与 CSR 的全局变量](./pitfalls/ssr-vs-csr-globals.md)
- [Redirect 与 Rewrite](./pitfalls/redirect-vs-rewrite.md)
- [Proxy 二进制载荷](./pitfalls/proxy-binary-payloads.md)
- [Container scope 泄漏](./pitfalls/container-scope-leak.md)
- [i18n 包体积](./pitfalls/i18n-bundle-size.md)

### 扩展框架 —— 高阶配方

每个配方都是一个完整、可运行的扩展示例，附说明。

- [自定义 Action handler](./advanced/custom-action-handler.md) —— 超越 `FlowAction` / `ExternalUrlAction`
- [自定义 Event recorder](./advanced/custom-event-recorder.md) —— 接入 Sentry / Datadog / 自有管线
- [自定义 adapter](./advanced/custom-adapter.md) —— 适配新平台
- [内联 proxy 代码生成](./advanced/inline-proxy-codegen.md) —— 为 serverless / edge 生成自包含的 proxy 路由
- [多租户 scope](./advanced/multi-tenant-scopes.md) —— 按租户隔离 DI 容器

## 一图看懂

```
URL/Action → Router.resolve()
          → beforeLoad chain   (NavigationContext: redirect/rewrite/deny/next)
          → IntentDispatcher   (controller.execute() → Page；出错走 fallback())
          → afterLoad chain    (PostLoadContext)
          → render             (SSR: HTML + 序列化的 PrefetchedIntents；CSR: 空壳)
```

同一个 `bootstrap()` 同时在服务器和浏览器执行。SSR 把 prefetch 后的 intent 结果序列化进 HTML，浏览器再反序列化为 `PrefetchedIntents`，让首次客户端导航复用服务端结果而不重新发请求。

## 约定

- **代码块** 直接可跑，除非注释说明不能。
- **文件路径** 相对项目根目录（也就是 `vite.config.ts` 所在目录）。
- **`vp`** 是 [Vite+](https://github.com/voidzero-dev/setup-vp) 的 CLI。用它替代 `pnpm` / `npm` / `vitest` / `tsdown`。
- **`@finesoft/front`** 是应用代码唯一的导入面。内部包（`core`、`browser`、`ssr`、`server`）打包在内，不对外发布。
