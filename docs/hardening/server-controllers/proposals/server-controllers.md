# Server execution owned by controller type

## Decision

The user selected a new server base, capability-appropriate contexts and application-controlled request/response tools. We are implementing the class boundary while preserving shared BaseController behavior.

## Executive Recommendation

I recommend deriving BaseServerController from the existing lifecycle and replacing complete implementation modules during client compilation. We should not copy controller execution, navigation guards, DI or serialization into a parallel subsystem. An immutable incoming-cookie view and explicit response-header tools give SSR and remote controllers the same transport primitives without managing login state.

## Evidence

The relevant owners are `packages/core/src/intents/base-controller.ts`, `packages/web/src/application/load-page.ts`, `packages/ssr/src/create-render.ts`, `packages/server/src/ssr-handler.ts` and `packages/server/src/internal-fetch.ts`. Existing shared page factories are reachable from both browser and SSR entries. Source inspection shows why public field projection alone cannot remove a module's methods or imports. The hashed source inventory is in [hardening.json](../hardening.json); [verification](../verification.md) distinguishes observed results from design reasoning.

## Current Design And Failure Mode

When the same class enters both build graphs, a runtime `isServer` branch does not establish a source boundary. Directory names alone also do not affect bundler reachability. Separately, SSR's incoming Cookie/Authorization and an internal API response's Set-Cookie belong to different Request/Response objects. The framework supplies access to each object; applications deliberately choose which headers or cookies to transfer. Source isolation and application authentication remain separate responsibilities.

## Desired Invariants

1. Client modules and maps never contain the replaced server implementation or its local private imports.
2. Remote callers can load registered server pages only, using freshly validated routes and trusted server request context.
3. Incoming cookies and outgoing headers are isolated per request. Credential forwarding and copying internal response headers require explicit application code.
4. Existing execution cancellation, fallback, guards, actions, public projection and DI scope remain owned by their existing implementations.

## Constraints And Non-Goals

We preserve execute({ params, query, context }) and generated Input/Failure references. This is a page-controller transport, not arbitrary method RPC or an authentication product. We do not infer whether a returned field is confidential. Dynamic filesystem access, independently copied source and public assets are outside the static import boundary.

## Before Architecture

[Before diagram](../diagrams/server-controllers-before.mmd). The important edge is the shared implementation reaching the browser compiler. The dashed identity edges show caller-owned forwarding, not an established automatic session boundary.

## Options

**Manual endpoints.** We can keep both execution contexts explicit in application code and expose HTTP contracts for sensitive operations. This preserves the existing compiler and is especially appropriate for login commands. It requires every page author to keep private imports separate, validate inputs, forward credentials and propagate response cookies. The resource cost is familiar, but reliability depends on repeating that integration correctly. We could roll this out endpoint by endpoint and revert individual adapters without changing shared controllers.

**Class boundary (selected).** We replace a server controller module with inert browser references, retain the original in SSR, and execute remote loads through the existing page pipeline. This gives us one place to enforce a source boundary and a small, closed request DTO. Static local runtime imports become private dependencies too; developers must separate shared contracts and client implementations rather than mixing value exports into a protected module. The attraction is consistent execution ownership; the cost is a compiler phase and one HTTP request for each uncached browser load. SSR pays no extra network round trip. We cache ASTs and update changed files, and we keep cookie/header memory bounded by the request lifetime. A failed remote load follows the existing navigation failure path, preserving the current page rather than partially committing it.

The selected option needs an available request host and paired client/server build identity. We can introduce it one controller at a time; moving back to shared execution is only safe after removing private dependencies and secrets, or replacing them with an explicit endpoint. Reverting just the browser proxy while leaving secrets in the shared graph is not a safe rollback.

## Comparison

| Dimension   | Manual endpoints                               | Class boundary                                                                                         |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Security    | Per-caller source and credential discipline    | Compiler boundary plus one guarded transport; application auth and forwarding remain application-owned |
| Performance | Explicit per-application HTTP decisions        | Local SSR, one browser request per load, cached syntax analysis                                        |
| Memory      | Application-owned adapters                     | Cached ASTs per development process, cookie/header state per request                                   |
| Reliability | Repeated wiring can diverge                    | Shared lifecycle, explicit build failures for unsupported mixed modules                                |
| Operability | Familiar endpoints                             | One reserved same-origin endpoint; deployment needs an SSR request host                                |
| Migration   | No base-class migration, more application code | Opt in by base, keep existing routes and generated types                                               |

These effects are source-derived except where the verification record reports a measurement. We should not infer production latency or RSS from the small local fixture.

## Recommendation

Use the class boundary for server page controllers and keep explicit HTTP operations for application commands. The manual option becomes preferable when using static-only hosting or when the desired API is unrelated to page loading.

## Evidence Coverage And Residual Risk

Tests cover route/guard rejection, forged context, cookie isolation and public projection. Real Vite/browser probes cover built JS/maps, development raw access, initial hydration and both navigation forms. We retain the need for application authorization and correct markPublic declarations. Local static dependencies are protected; arbitrary computed imports or filesystem reads require an explicit application design. Third-party package contents are not automatically classified as private source merely because a server controller imports the package.

## Migration And Rollout

Keep ordinary controllers unchanged. Move sensitive construction into a server-controller module, use BaseServerController, keep its exports limited to classes/types, and keep the route factory simple. Pair browser and server artifacts. Use a request host and leave production deployment to a separately authorized release.

## Validation Plan

Run targeted boundary tests, the complete repository suite, vp check, recursive builds and the repeatable real-browser script. Compare a minimal shared/server SSR workload after warm-up; report the measurements as local observations with no production guarantee.

## Implementation Work Packages

Follow the [selected implementation plan](../implementation/class-boundary.md). The sequence is context/lifecycle reuse, transport and compiler enforcement, explicit HTTP tools, then regression and browser validation.

## Open Questions

No required decision remains. Application-specific authentication and external API credential policies remain outside this change.
