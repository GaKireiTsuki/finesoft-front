# Project Guidelines

## Architecture

This is `@finesoft/front`, a full-stack TypeScript framework monorepo (pnpm workspaces). Five packages form a layered dependency graph:

```
core ← browser       (client runtime)
core ← ssr ← server  (server runtime, Hono-based)
front                 (published aggregation bundle of all above)
```

| Package     | Purpose                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------- |
| **core**    | Router, DI container, action/intent dispatchers, middleware pipeline, data mappers, logging         |
| **browser** | Browser bootstrap (`startBrowserApp`), action handlers, history management, SSR data hydration      |
| **ssr**     | Server-side rendering, HTML injection, `PrefetchedIntents` serialization                            |
| **server**  | Hono integration, multi-platform adapters (Node, Vercel, Netlify, Cloudflare), Vite plugin          |
| **front**   | Published package — bundles all internal packages with two entry points (full-stack + browser-only) |

### Key Abstractions

- **Framework** — central orchestrator; owns Container, Router, ActionDispatcher, IntentDispatcher; provides `getLocale()`, `getPlatform()`, `didEnterPage()`
- **BaseController\<TParams, TResult\>** — abstract intent handler with try/catch → `fallback()` pattern
- **Middleware pipeline** — two-phase: `beforeLoad` (navigation guards) → `afterLoad` (post-data guards); first non-`next` result short-circuits
- **ActionDispatcher** — handles `FlowAction` (SPA nav), `ExternalUrlAction`, `CompoundAction` (recursive)
- **Container** — DI container with `DEP_KEYS` constant for named registrations; supports `createScope()` for request-level isolation
- **PrefetchedIntents** — SSR → CSR hydration cache with stable stringify
- **EventRecorder** — structured event recording pipeline (ConsoleEventRecorder, CompositeEventRecorder, WithFieldsRecorder)
- **HttpClient** — abstract HTTP client with request/response interceptors
- **Translator** — i18n interface; `SimpleTranslator` provides ICU interpolation + plural rules
- **ReportingLoggerFactory** — forwards warn/error logs to external monitoring via `ReportCallback`

### DEP_KEYS

| Key              | Type               | Description                     |
| ---------------- | ------------------ | ------------------------------- |
| `LOGGER`         | `Logger`           | Framework-scoped logger         |
| `LOGGER_FACTORY` | `LoggerFactory`    | Creates named loggers           |
| `NET`            | `Net`              | Network request layer           |
| `STORAGE`        | `Storage`          | Key-value storage               |
| `FEATURE_FLAGS`  | `FeatureFlags`     | Feature flag lookups            |
| `METRICS`        | `MetricsRecorder`  | Legacy metrics recorder         |
| `FETCH`          | `fetch`            | Raw fetch function              |
| `EVENT_RECORDER` | `EventRecorder`    | Structured event recording      |
| `LOCALE`         | `LocaleAttributes` | `{ lang, dir }` (if configured) |
| `PLATFORM`       | `PlatformInfo`     | OS, browser, engine detection   |

### Request Lifecycle

1. `Router.resolve(url)` → `RouteMatch` (intent, action, renderMode, guards)
2. `beforeLoad` guards run (NavigationContext)
3. `IntentDispatcher.dispatch(intent)` → controller → `Page`
4. `afterLoad` guards run (PostLoadContext with Page)
5. SSR: inject prefetched data into HTML; CSR: update UI + push history

## Build and Test

```bash
vp install          # Install dependencies (always run first)
vp check            # Format + lint + type-check (run before committing)
vp test             # Run Vitest tests
vp run -r build     # Build all packages in dependency order
vp ready            # Alias: fmt + lint + build (full validation)
```

Release: `changeset` for versioning → `vp run -r build && changeset publish --access public`.

## Code Style

### TypeScript

- **Strict mode** everywhere; target ESNext, module ESNext
- **Interfaces** for public contracts; **type aliases** for discriminated unions
- **Type guards** follow `is*` naming: `isFlowAction()`, `isCompoundAction()`
- **Generics** for reusable components: `BaseController<TParams, TResult>`, `Mapper<TInput, TOutput>`
- **Readonly** properties in context interfaces

### Naming

| Kind                 | Convention             | Examples                            |
| -------------------- | ---------------------- | ----------------------------------- |
| Factory functions    | `create*`, `make*`     | `createServer`, `makeFlowAction`    |
| Type predicates      | `is*`                  | `isFlowAction`, `isCompoundAction`  |
| Constants            | `SCREAMING_SNAKE_CASE` | `ACTION_KINDS`, `DEP_KEYS`          |
| Classes / interfaces | `PascalCase`           | `Framework`, `Logger`, `RouteMatch` |

### Exports

- All packages emit dual ESM + CJS with TypeScript declarations (except `server` — no DTS)
- Barrel `index.ts` re-exports all public API from each package
- `@finesoft/front` bundles all internal packages (`noExternal: [@finesoft/*]`)

## Conventions

- **Import from `vite-plus`**, not `vite` or `vitest`:
    ```ts
    import { defineConfig } from "vite-plus";
    import { expect, test, vi } from "vite-plus/test";
    ```
- **Use `vp` for all tooling** — never invoke pnpm/npm/vitest/oxlint directly
- **Standalone `.oxlintrc.json` and `.oxfmtrc.json`** are required for pre-commit hooks (they cannot load `vite.config.ts`)
- Each package has its own `tsdown.config.ts` — respect external/noExternal boundaries
- `front` package has pre-/post-publish scripts that modify `package.json` — do not alter this workflow
- Error handling: use `HttpError` class; controllers recover via `fallback()` method

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
