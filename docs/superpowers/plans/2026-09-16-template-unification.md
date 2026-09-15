# Six-template unification

**Goal:** Keep full/minimal as two tiers. React, Vue and Svelte in the same tier expose the same pages, routes, data, interactions and application organization.

**Architecture:** Each generated application remains standalone. Same-tier framework-neutral TypeScript and styles are identical checked-in files; UI components use native syntax with the same props and behavior. An equality/structure test prevents drift. No template generator language or shared runtime package is introduced.

**Tech stack:** Existing Vite+, TypeScript, React, Vue, Svelte, native Finesoft renderers and Playwright browser verification.

**Spec:** The user's accepted scope is “保留两档，同档位的页面、路由、数据和交互统一”. The contracts below are the concrete implementation of that scope.

## Global constraints

- Work in the existing `refactor/application-boundaries` worktree. Preserve the completed architecture work and its reports. No runtime package, CI, publishing, push or deployment changes.
- Consumer imports use the appropriate public entry: portable APIs from `@finesoft/front`, Web contracts from `/web`, browser startup/handles from `/browser`, selected native renderers from `/renderers/*`.
- All six use `src/{config,app-definition,main,ssr,views}.ts`, `src/App.<native>`, `src/pages/`, `src/lib/` and `src/styles.css`. React UI remains TSX; startup/SSR contain no JSX and become TS.
- `config.ts` contains only the per-template app id. Same-tier non-UI code, CSS, locale data and HTML match byte for byte; renderer imports and native file extensions are the explicit adapter differences. Generated apps cannot import sibling templates or use workspace aliases.
- Keep full's root renderer and minimal's entries renderer. Do not add another navigation/renderer abstraction.

## Task 1: Shared contracts and minimal applications

- Full: normalize existing controllers, models, mapper, API client, guards, actions and app declaration. Preserve the four routes `/`, `/products/:id`, `/search`, `/about` (CSR), guarded `/admin`, product mocks and public projections. Use a common navigation link table exported by `actions.ts`.
- Minimal: three routes `/`, `/item/:id`, `/notes`; typed home/detail/notes/error models and error fallback. Preserve the Feed's three items. Detail text input is retained while its entry exists, removed on pop; Notes has the promised textarea retained across tabs and reload. A per-instance profile provider restores the global name. Native chrome consumes the renderer's snapshot and subscribes only to its name store after mount, with cleanup.
- Preserve the locale JSON demonstration by providing it in all three minimal templates. Default locale remains `zh-Hans`; Feed/Notes navigation labels and item data stay consistent English examples. Home includes translated locale label, hydration badge and a correct instruction to change `frameworkConfig.locale`. No new runtime language-switch API.
- Main creates a per-mount instance, calls `startBrowserApp`, injects `nameStore`, and disposes for HMR. SSR uses the same registry; all minimal registries bind home/detail/notes and an error view.
- Error recovery reuses the exported `createNavigation` factory to restore the complete tabs tree in both browser-history and embedded memory-history applications.

## Task 2: Full native views (independent implementation)

- Scope: only full templates' `App`, native components/pages, `src/styles.css`, and deletion of the obsolete Svelte `lib/framework-svelte.ts`. Main/app definition/business TypeScript are owned by Task 1.
- Match the existing React full page content across frameworks. `App` uses `page`, optional `loading`, optional `onAction`; `Layout`, `Navigation`, `PageRenderer`, pages and ProductCard pass the same `onAction` callback. Remove Vue's old `state` fallback and Svelte's context route.
- Use explicit discriminated page branches in PageRenderer, no `any` dynamic component registry. Use the shared navigation link table `NAV_LINKS` from `src/actions.ts` with `{label, action, path}` fields, and `NAV_ACTIONS.home` for return links.
- Same classes/HTML hierarchy/common CSS across frameworks: navigation, loading, cards, headings, About and error return link. Retain usable anchor hrefs; intercept only an ordinary primary click when `onAction` exists, preserving modified/native navigation. Keep `/search?q=...` data behavior; no new search UI is required.
- Verify each full template build; root will run shared browser acceptance. No independent commits while the root is integrating other files.

## Task 3: Drift prevention, generated consumers and docs

- Extend existing create-app tests to assert same-tier neutral-file equality, normalized native adapter files/configs, page/component inventory and correct public import boundaries.
- Browser parity also compares stable native DOM structure, classes and meaningful attributes; presence-only DOM-restore markers are normalized across native serializers.
- Use the same browser cases for all three templates in a tier: full SSR product, SPA/history, search data, CSR About, error and guard behavior; minimal deep link, item push/pop, tab and reload retention of both drafts and profile, error, locale SSR/hydration/dev loader, isolated application instances.
- Update generated consumer verification to use the corrected packed framework artifact explicitly and build/install all six generated applications outside the workspace. Preserve manifest restore and standalone tsconfig checks.
- Update the existing static-starter verification for renamed startup and i18n config. Store new results under `reports/template-unification/` without replacing the architecture delivery evidence.
- Document the two-tier contract, file ownership and update/check commands. Run `vp check`, focused create-app tests, six template builds, production/dev browser checks, static starter and generated consumer installs/builds. Review the final diff and report local results, limitations and commit separately from push/publication.
