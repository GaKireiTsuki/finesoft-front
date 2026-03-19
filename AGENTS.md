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
vp run build -r     # Build all packages in dependency order
vp ready            # Alias: fmt + lint + build (full validation)
```

Release: `changeset` for versioning → `vp run build -r && changeset publish --access public`.

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

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ commands take precedence over `package.json` scripts. If there is a `test` script defined in `scripts` that conflicts with the built-in `vp test` command, run it using `vp run test`.
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
  <!--VITE PLUS END-->
