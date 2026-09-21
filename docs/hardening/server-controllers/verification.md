# Server controller verification

This record describes local verification of the selected implementation. It is not production deployment or a claim that application authentication is configured. Earlier checkpoints are retained below; the unified-entry checkpoint records the latest validation.

## Reproducible checks

| Command                                              | Observed result                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `vp check --fix`                                     | Formatting, lint and type checking passed; 478 source files; no warnings/errors                     |
| `vp test`                                            | 113 files, 948 tests passed after the explicit-transfer correction                                  |
| `vp run -r build`                                    | All 21 build tasks passed                                                                           |
| `vp exec node scripts/verify-server-controllers.mjs` | Built public package, source-map inspection, Chrome development and production-preview flows passed |

The preceding feature verification also ran `vp exec node scripts/verify-runtime-boundaries.mjs`: six packed consumers passed isolated imports, dependency graphs and declaration checks, with manifests restored. That packaging check was not repeated for the explicit-transfer correction, which changes no public exports. All checks in the table above were rerun after the correction.

The browser fixture places the server Controller in `src/account.ts` and imports a local private service containing a synthetic sentinel and `node:crypto`. All 3 client JS/map/HTML files omit the sentinel and private dependency name; the server bundle contains the sentinel. Development source requests for the controller's raw asset and its private dependency fail without returning the sentinel. Compiler tests additionally cover inheritance aliases, re-exports, virtual modules, timestamp queries, mixed exports, changed dependencies and controllers added after indexing.

Both browser modes passed initial SSR, hydration without an extra request, URL navigation, structured push, server denial preserving the current page, redirect, public field filtering and application-directed HttpOnly cookie updates. The fixture application explicitly forwards its chosen cookie and copies the selected endpoint's Set-Cookie values to the outgoing response; the framework performs neither step implicitly. Four remote requests in each mode correspond to the two navigations plus denial and redirect. Browser version: 153.0.8010.47.

## Context and lifecycle coverage

Unit/integration cases cover route-derived shared/server context types, concurrent request isolation, direct server execution capability checks, existing BaseController fallback regression coverage, independent params/query, server-side route decoding and guards, rewritten destination metadata, CSR shells followed by remote execution, ignored forged context, cross-origin rejection and the 64 KiB request-body limit.

Request/response cases cover no implicit Cookie or Authorization forwarding to internal or external destinations, caller-supplied headers, no server-side cookie store for any credentials option, unchanged incoming cookies after response writes, independent concurrent requests, application-selected response cookies and explicit response headers retained through a later rendering failure without exposing renderer error details. An integration case proves that internal response cookies do not enter the page response unless application code selects them. Authentication, login state and token policy are application-owned.

## Local performance observation

The repeatable script warms each renderer for 200 loads, then alternates 1,000 shared and 1,000 server loads. Both execute a minimal page with no API call or native UI rendering. The last run was performed after the full suite and build completed.

| Renderer              | Median   | p95      |
| --------------------- | -------- | -------- |
| Shared BaseController | 45.42 μs | 66.71 μs |
| BaseServerController  | 45.29 μs | 64.79 μs |

These close measurements do not establish statistical equivalence or production latency. They measure the local SSR execution/projection path, not browser networking or real login APIs. Server SSR makes no additional HTTP round trip, and hydration made zero duplicate calls in the fixture. Browser navigation to a server controller necessarily adds a request. Peak RSS, production load and deployed Worker execution have not been benchmarked.

## Earlier feature verification interruptions

An early real build exposed virtual-module IDs being treated as filesystem paths; that was fixed and covered. Direct runtime Page execution initially regressed and was restored. Browser redirect propagation exposed error normalization in the runtime; it now preserves the navigation result and has a regression test. Final builds and browser checks passed after those fixes.

Running type checking concurrently with tests once let the linter discover a temporary generated-entry directory that the test removed. Running a browser build concurrently with the complete suite also produced one three-second native-file-watcher timeout. Neither check was skipped or weakened: the watcher passed in isolation, and the final format/type checks, full suite, build and browser verification were run sequentially and passed. These interruptions preceded the explicit-transfer correction; its checks all passed sequentially.

## Scaffold integration

All six scaffold templates now use BaseServerController for their detail pages. Full templates explicitly read/write a browsing-preference cookie and response caching headers; minimal templates read the request method and write a response header. Their other pages retain ordinary controllers. The two canonical sources are synchronized into the three native frameworks, and each README describes the server execution requirement and application-owned request/response policy.

Cold development scans initially bypassed Vite load hooks and traversed the original server module. A failing real-scanner regression reproduced the error. Scan resolution now reuses the existing controller classifier and treats recognized server modules as opaque, while normal loading retains proxy generation and private-source rejection. This required no second parser or dependency graph.

After the scaffold and scan changes, `vp check --fix` passed, all 949 tests in 113 files passed, and all 21 build tasks passed. `verify-template-renderers.mjs` passed all six production previews and six forced cold development runs, including SSR hydration, remote navigation, explicit response tools and the existing native UI/session flows. Client artifacts omit the server implementation markers. `verify-created-consumers.mjs` installed the locally packed public framework in all six standalone generated projects outside the workspace; their TypeScript/native component checks and client/SSR builds passed. Local pack hooks restored the original public package manifest. Evidence is in `reports/template-unification/browser/results.json` and `reports/template-unification/created-consumers/result.json`.

## Unified public entry checkpoint (2026-09-21)

All public APIs now come from `@finesoft/front`. The compiler recognizes server controllers through this root while retaining the same proxy, private-source and public-projection boundaries. Native bindings are selected before UI compilation, and the generated project type facade retains optional dependencies without becoming a runtime module. The facade resolver preserves browser, Node SSR and Worker SSR conditions.

Final verification passed: `vp check --fix` checked 491 source files with no warnings/errors; `vp test` passed 968 tests in 115 files; all 21 build tasks passed. The six isolated packed profiles passed strict declarations without skipLibCheck and without unselected native peers. All six independently installed scaffolds passed TypeScript/native checking, client/SSR builds, forced cold development scans, hydration and server navigation with `resolve.tsconfigPaths` enabled. Their tarball SHA-256 is `2b790bbd7cde8cec7b05c5f2639afa7acb120fc8cd51edb63e8a108dd60cd492`.

The template browser suite passed all six production previews and six development runs. The native renderer suite passed React/Vue/Svelte SSR, CSR and prerender flows, retained state, native context and rejected-navigation cases. The server-controller sentinel, raw-source protection, guards, projection and application-directed HttpOnly cookie tests passed again in development and preview, with zero duplicate hydration calls. Real Node and workerd data handlers passed the response/lifetime matrix; workerd did not enable Node compatibility.

The live Controller type watcher also passed. Its six local save-to-declaration samples had a 1.752 ms median and a 0.559–145.166 ms range with 1 ms polling, including startup work; this is not a guaranteed latency or a microsecond-resolution measurement. The project type facade is generated during setup, not for each route edit.

The latest server-controller execution probe observed medians of 42.958 μs for shared controllers and 43.000 μs for server controllers, with 1,000 samples each. The earlier performance limitations still apply. Details and repeatable commands are recorded in `docs/unified-public-api.md` and the generated reports it lists.

`sourceEvidence.snapshotDigest` hashes the compact JSON serialization of its document array, retaining the listed order and each object's `path`, then `sha256` key order. These source hashes identify the local implementation and are separate from the packed artifact hash.

## Delivery state and limits

The implementation, compatibility cleanup and consumer migration are committed locally in separate batches; no push or deployment was performed. Server controllers require the framework compiler and an SSR request host; pure static hosting has no remote executor. This transport loads registered server pages, not arbitrary controller methods. Public data projection and application authentication still need correct application definitions.

Machine-readable browser results are generated at `reports/server-controllers/acceptance.json`; the fixture is disposable. Source provenance and design tradeoffs are in hardening.json and the linked proposal/implementation plan.
