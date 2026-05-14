# `@finesoft/front` documentation

> **Language:** English (this page) · **[简体中文](./zh/README.md)**

Full-stack TypeScript framework — router, DI, actions, SSR, and server — in one package. Works with **Vue**, **React**, or **Svelte**. Deploys to Node.js, Vercel, Cloudflare Workers, Netlify, or static hosting.

## Three entry points

Pick where to start based on what you need.

### New to the framework — read top to bottom

A linear path. Each chapter assumes the previous one. By the end you can build, render, and deploy a real app.

1. [Getting started](./01-getting-started.md) — install, Vite config, first page
2. [Routing & controllers](./02-routing-and-controllers.md) — route definitions, intents, controllers, render modes
3. [Middleware](./03-middleware.md) — `beforeLoad` / `afterLoad`, redirect / rewrite / deny
4. [Rendering & hydration](./04-rendering-and-hydration.md) — SSR / CSR / Prerender, `PrefetchedIntents`
5. [Internationalization](./05-i18n.md) — `locale`, `Translator`, dictionary loading, RTL
6. [HTTP client](./06-http-client.md) — `HttpClient` subclassing, interceptors, `HttpError`
7. [DI container](./07-di-container.md) — registration, scopes, `DEP_KEYS`, dispose
8. [Observability](./08-observability.md) — `Logger`, `EventRecorder`, impression tracking, `ReportCallback`
9. [Server & deployment](./09-server-and-deployment.md) — `createServer`, proxy, adapters, Vite plugin
10. [Features, platform, PWA](./10-features-platform-pwa.md) — feature flags, platform detection, PWA mode

### Engineer working on an existing app — jump to practice

Cross-cutting concerns and conventions. Read after you understand the basics.

- [Project structure](./engineering/project-structure.md) — recommended layout, `bootstrap.ts` splitting, single source of truth
- [Testing](./engineering/testing.md) — controllers, middleware, scoped DI, mocking the framework
- [CI & release flow](./engineering/ci-release-flow.md) — changesets, the bundled release workflow, version reconciliation

### Hit a problem — go to pitfalls

Each entry is **symptom → root cause → fix**, kept short.

- [SSR hydration mismatch](./pitfalls/ssr-hydration-mismatch.md)
- [SSR vs CSR globals](./pitfalls/ssr-vs-csr-globals.md)
- [Redirect vs rewrite](./pitfalls/redirect-vs-rewrite.md)
- [Proxy binary payloads](./pitfalls/proxy-binary-payloads.md)
- [Container scope leak](./pitfalls/container-scope-leak.md)
- [i18n bundle size](./pitfalls/i18n-bundle-size.md)

### Extending the framework — advanced recipes

Each recipe is a complete, runnable extension example with explanation.

- [Custom action handler](./advanced/custom-action-handler.md) — beyond `FlowAction` / `ExternalUrlAction`
- [Custom event recorder](./advanced/custom-event-recorder.md) — wire Sentry / Datadog / your own pipeline
- [Custom adapter](./advanced/custom-adapter.md) — target a new platform
- [Inline proxy codegen](./advanced/inline-proxy-codegen.md) — generate self-contained proxy routes for serverless / edge
- [Multi-tenant scopes](./advanced/multi-tenant-scopes.md) — per-tenant DI containers

## At-a-glance

```
URL/Action → Router.resolve()
          → beforeLoad chain   (NavigationContext: redirect/rewrite/deny/next)
          → IntentDispatcher   (controller.execute() → Page; fallback() on error)
          → afterLoad chain    (PostLoadContext)
          → render             (SSR: HTML + serialized PrefetchedIntents; CSR: shell)
```

The same `bootstrap()` runs on the server and in the browser. SSR serializes prefetched intent results into HTML; the browser deserializes them into `PrefetchedIntents` so the first client navigation reuses server results without a refetch.

## Conventions used in these docs

- **Code blocks** are runnable as written unless a comment says otherwise.
- **File paths** are relative to the project root (the directory containing `vite.config.ts`).
- **`vp`** is the [Vite+](https://github.com/voidzero-dev/setup-vp) CLI. Use it instead of calling `pnpm` / `npm` / `vitest` / `tsdown` directly.
- **`@finesoft/front`** is the only import surface for application code. Internal packages (`core`, `browser`, `ssr`, `server`) are bundled in and not published.
