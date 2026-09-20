# Native composition implementation plan

> Implement in the existing `refactor/application-boundaries` worktree. The user authorized correcting the proposal and proceeding, and explicitly requested testing after implementation. The final validation phase owns test additions, migrations and execution.

**Goal:** Simplify the framework around one execution/provider path and one Web session, while native UI frameworks own their component tree.

**Architecture:** Core owns operation handlers, scopes, capabilities and data caches. Web owns page declarations, guarded navigation and immutable presentation snapshots. Browser and SSR prepare the same session; React, Vue and Svelte bindings only subscribe, render keyed entries and acknowledge native commits.

**Tech Stack:** TypeScript, Vite+, React, Vue, Svelte, Hono, standard Request/Response.

**Spec:** [Framework simplification and native composition](../specs/2026-09-16-native-composition-design.md).

## Global constraints

- Worktree: `.worktrees/application-boundaries`; preserve the pre-existing proposal revision, copied to `reports/native-composition-implementation/`.
- Node `^22.18.0 || >=24.11.0`, pnpm `11.20.0`; use `vp` exclusively for project tooling.
- Breaking API changes are allowed; migrate six templates, scaffolder, fixtures, public exports and Chinese/English docs together.
- Preserve SSR/CSR/prerender, guards, typed routes, draft/session restore, multiple app instances, Node/Worker, portable HTTP and network protections.
- No push, publication, deployment or CI change is authorized.
- Run tests only after implementation is complete, as explicitly requested on 2026-09-19.

## Review focus

1. Invalidation while a query is pending: old callers may settle, new callers must compute fresh data and old results cannot refill caches.
2. Native commit and restore: hydration must finish and providers must register without commit/restore deadlock; stale revisions cannot restore scroll.
3. Multiple apps: root and history ownership, persistence identity, listeners and disposal stay isolated.
4. Parameter paths: exactly-once decoding, method dispatch, ambiguous patterns and async schema rejection share one matcher.
5. Abort and streams: resources remain alive through response consumption and release on EOF/error/cancel, with classified public errors.

## Task 1: Portable execution and providers

Files: `packages/core/src/application/*`, `dependencies/*`, `intents/*`, `metrics/*`, `logger/*`, `utils/lru-map.ts`, `http/client.ts`, root exports.

- [x] Call the selected normalized handler directly; retain host overrides, input/output checks, policies and cancellation.
- [x] Change BaseController to `execute(input, context)` with optional `fallback`; cancellation bypasses fallback.
- [x] Remove string registration and request-scoped-key; keep token/provider lifetime and disposal ownership.
- [x] Use reliable cache input encoding, bounded completed caches, per-execution query reuse and invalidation generations.
- [x] Expose `RuntimeHandle.onInvalidate(listener)` and `record(type, fields)` for Web; keep recorder failures observational.
- [x] Add safe `unauthenticated`, `conflict`, `rate_limited` execution errors and explicit HttpError conversion.
- [x] Remove redundant Net and legacy Metrics; migrate their real consumers rather than retain aliases.

Interfaces: `OperationHandler<I,O> = (input:I, context:ExecutionContext) => O | Promise<O>`; `BaseController.perform(input, context)` calls execute/fallback. `RuntimeHandle.onInvalidate(listener:(tags:readonly string[])=>void):()=>void`. Token providers remain asynchronous.

## Task 2: Shared paths and HTTP

Files: new `packages/core/src/routing/path.ts`, `packages/web/src/router/router.ts`, `packages/server/src/http.ts` and required exports.

- [x] Extract compilation/matching/parameter decoding into Core, preserve declaration-order schema fallthrough.
- [x] Expose structured route descriptors and reverse routing; remove debug-string parsing.
- [x] Compile HTTP endpoint paths once, dispatch methods deterministically and retain request/stream lifecycle.

Interfaces: matcher returns decoded null-prototype parameters; endpoint decode receives the matched params in addition to Request and ExecutionContext. Public business errors are explicit ExecutionError values.

## Task 3: One Web session

Files: `packages/web/src/application/*`, `navigation/*`, `session/*`, `protocol.ts`; remove `framework.ts`, old dependency assembly, URL-only session and UI-specific models.

- [x] Page declarations carry routes; `defineWebApp({ pages })` derives operation/route registries.
- [x] Replace Framework's second container and dispatch chain with a Web runtime using the core runtime.
- [x] Guarded loading calls selected page operations in the active execution scope.
- [x] Subscribe to data invalidation, retire stale page results without losing entry identity, and isolate observers from commit results.
- [x] Produce stable snapshots with revision, retained entry views, visibility and navigation summary.
- [x] Coalesce adjacent pending implicit saves while respecting explicit snapshots and clear/restore ordering.
- [x] Replace the hydration sentinel with explicit versioned navigation and page data; define old-protocol rejection.

Interfaces for native bindings:

```ts
interface WebAppView {
    getSnapshot(): AppSnapshot;
    subscribe(listener: () => void): () => void;
    commit(revision: number): void;
    navigation: NavigationCommands;
    session?: SessionHandle;
}
interface AppSnapshot {
    revision: number;
    entries: readonly ViewEntry[];
    navigation: NavigationSummary;
}
interface ViewEntry {
    entryId: string;
    page: BasePage;
    visible: boolean;
}
```

Native view props are `{ page, app, entry }`. Entry wrappers keep stable EntryId, reset children on pageType change, and expose `data-fs-entry` / `data-fs-key` for scoped DOM restore.

## Task 4: Browser, SSR and native consumers

Files: `packages/browser/src/start-app.ts`, browser bridges; `packages/ssr/src/*`; new `packages/front/src/{react,vue,svelte}*`; six templates and native fixtures.

- [x] `createBrowserApp({ definition, target, ... })` prepares a session and returns before native mount; always provides navigation.
- [x] Root-scoped real-link interception preserves modifiers, downloads, external targets and multi-root ownership.
- [x] Match scroll/DOM restoration to the actual revision commit and keep initial hydration before restore.
- [x] `createSSRRender({ definition, render: app => nativeRender(app) })` uses one session/snapshot and one native render.
- [x] Migrate React full/minimal first, then Vue/Svelte; native providers must reach pages and hidden entries retain components.
- [x] Delete renderer modes, islands, chrome roots, parallel SSR dispatch, action-prop drilling and NameStore.

## Task 5: Integration and documentation

Files: public entries/config, scaffolder, adversarial fixture, server startup/network callers, docs, site and AGENTS.

- [x] Migrate every consumer, generated entry and export; remove replaced implementation paths.
- [x] Update bilingual instructions and one minimal example for each data/page/composed-navigation path.
- [x] Record removed responsibilities and comparable implementation/token/file counts.

## Task 6: Validation after implementation

- [x] Add/migrate regression coverage for the five Review Focus conditions and spec acceptance matrix.
- [x] Run `vp check`, the complete `vp test` suite, package builds and six template builds/type checks.
- [x] Exercise native contexts, history/scroll, draft restore, links and multi-instance disposal in a real browser.
- [x] Run published-package and Node/real Worker checks; inspect generated exports and dependency graphs.
- [x] Rebuild the baseline separately for comparable production measurements; record counts, sizes, timing distributions and limitations.
- [x] Review final diff and fix test/review findings; report local implementation and validation separately from any release.

## Progress

- 2026-09-19: Installed dependencies. Reviewed proposal and existing evidence without executing tests. Preserved pre-existing proposal changes. Added generation/decoding/lifetime/commit ordering constraints. Implementation is underway.

- 2026-09-19 implementation checkpoint: Core execution/provider/cache/errors, shared path matching and HTTP, Web runtime/page declarations/navigation invalidation/observer boundaries, revision snapshots, explicit hydration, browser native commit/restore/link handling, unified SSR, native bindings/six template source, session batching, DOM restore, legacy host removal and public docs are implemented. No tests/builds/typechecks were run during implementation. Next: migrate old test fixtures to new APIs, run validation, fix observed failures, and measure real artifacts.
- Source owners: core/server/docs via implement_core; shared paths/HTTP/session/DOM via implement_paths_http; native front bindings/templates/packaging via native_consumers; Web/browser/SSR integration via root. Agents share this worktree and did not commit.

- 2026-09-20 completion: all implementation and validation tasks completed locally; 772 tests, clean vp check, 17 builds, native UI and six external consumers passed. Fixed independent-review cancellation starvation and real Svelte browser/type failures. Measurements and per-metric limits are recorded in [acceptance](../../native-composition-acceptance.md); Svelte minimal gzip +58 bytes and cold portable import are explicitly not reported as improvements. No commit, push, publication or deployment was performed.
