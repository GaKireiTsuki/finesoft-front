# Project Guidelines

## Architecture

This is `@finesoft/front`, a full-stack TypeScript framework monorepo managed as pnpm workspaces through Vite+ (`vp`). Five runtime packages form a layered dependency graph:

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

Supporting workspaces:

| Workspace                  | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| **create-app**             | Published `create-finesoft-app` scaffolding CLI                   |
| **site**                   | Private VitePress documentation site                              |
| **templates/**             | Private React, Vue, and Svelte full/minimal application fixtures |
| **adversarial/target-app** | Private security and integration build fixture                    |

Consumer and template application code should import framework APIs from `@finesoft/front` (or its `@finesoft/front/browser` entry point), not the private runtime packages.

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
5. SSR injects prefetched data into HTML; CSR updates the UI and pushes/replaces history
6. A browser `popstate` navigation waits for dispatch and guards before restoring that entry's scroll position

### Browser History and Scroll Restoration

- `History.onPopState()` accepts a synchronous or asynchronous listener. Listener settlement is the restoration boundary: never start `tryScroll()` while the old page or a loading state is still active.
- The flow-action popstate listener must not resolve until the target `Page` and its `afterLoad` guards have completed and `updateApp()` has received the guarded page promise.
- Save the departing entry's scroll position using the previous `currentStateId` before switching to the target entry.
- Keep both the popstate sequence and target state-id checks. They prevent a slow earlier navigation from restoring scroll over a newer back/forward navigation.
- `pushState()`, `replaceState()`, `pushUrl()`, and `replaceUrl()` cancel pending restoration and initialize the new entry at scroll position `0`.
- Preserve the regression coverage in `packages/browser/test/utils/history.test.ts` and `packages/browser/test/action-handlers/flow-action.test.ts` when changing navigation timing.

### Rendering Modes

| Mode        | Behavior                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `ssr`       | Default; renders the route for each request and hydrates it in the browser                         |
| `csr`       | Returns an HTML shell from the server and renders in the browser                                   |
| `prerender` | Produces build-time static HTML and uses runtime/edge ISR caching where the adapter supports it     |

`finesoftFrontViteConfig({ renderModes })` overrides route-level `renderMode` values for matching paths.

## Build and Test

Runtime requirements are Node `^22.18.0 || >=24.11.0` and pnpm `11.20.0`; access pnpm through `vp` rather than invoking it directly.

```bash
vp install                    # Install dependencies (always run first)
vp check                      # Format + lint + type-check (run before committing)
vp test                       # Run Vitest tests
vp test path/to/file.test.ts # Run one test file
vp test -t "name"             # Filter tests by name
vp test --coverage            # Write coverage to reports/coverage/
vp run -r build               # Build all packages in dependency order
vp ready                      # Alias: fmt + lint + build (full validation)
```

Release locally with `vp run changeset` followed by `vp run release`. The automated release workflow versions and publishes both `@finesoft/front` and `@finesoft/create-app`; `core`, `browser`, `ssr`, `server`, `site`, templates, and the adversarial app remain private.

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

- `core`, `browser`, and `ssr` request dual ESM/CJS output with declarations; `server` omits declarations
- `front` is ESM-only and publishes full-stack `.` plus browser-only `./browser` entry points
- Barrel `index.ts` files define each package's public API
- `@finesoft/front` bundles all internal runtime packages via `noExternal`

## Conventions

- **Import from `vite-plus`**, not `vite` or `vitest`:
    ```ts
    import { defineConfig } from "vite-plus";
    import { expect, test, vi } from "vite-plus/test";
    ```
- **Use `vp` for all tooling** — never invoke pnpm/npm/vitest/oxlint directly
- Vite+ reads `fmt`, `lint`, `staged`, and test settings from `vite.config.ts`; standalone `.oxlintrc.json` and `.oxfmtrc.json` mirror relevant settings for IDE/LSP use, so keep them synchronized
- The catalog's `vite` alias is intentionally pinned to the stable `npm:@voidzero-dev/vite-plus-core@0.2.8`; do not replace it with a `dev`/nightly build. Keep `vitest` and `@vitest/coverage-v8` exact and version-aligned
- The section between `<!--VITE PLUS START-->` and `<!--VITE PLUS END-->` is generated by `vp config`; make durable project-specific edits above it
- Each package has its own `tsdown.config.ts` — respect external/noExternal boundaries
- `front` uses symmetric `prepack`/`postpack` scripts (`prepare-front-publish.mjs` and `restore-front-publish.mjs`) to rewrite and restore `package.json`; preserve both sides together
- Error handling: use `HttpError` class; controllers recover via `fallback()` method

## CI Scope

- `Quality` runs `vp check` and `vp test --coverage`; coverage includes `packages/{core,browser,ssr,server,front}/src/**` and excludes tests, generated output, templates, scripts, docs, `create-app`, and `site`.
- `CodeQL` runs for pushes, pull requests, manual dispatch, and its weekly schedule over the five runtime package source trees.

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
