# Selected class-boundary implementation

## Selected Design And Constraints

The user's current request selects implementation. We retain shared BaseController and add BaseServerController with the same method input and automatic route typing. We preserve previous uncommitted compatibility cleanup.

## Source Revision And Drift Check

See context.md and the hashed inventory in hardening.json. The branch is an existing dirty checkout, not an immutable scan snapshot. Review the actual feature diff and rerun checks after later changes.

## Affected Components

Core controller context preparation; Web page contexts/loading; SSR rendering; server request assembly and internal fetch; Vite module classification and type generation; public documentation and acceptance scripts.

## Ordered Work Packages

1. Extend the existing controller input context and reuse perform/fallback/cancellation.
2. Give page loads per-input metadata and server loads per-request response state.
3. Replace protected modules with browser references and reject private dependency exposure.
4. Route same-origin bounded POST loads through codecs, guards, policies and public serialization.
5. Provide request-header access, caller-selected fetch headers and explicit response-header/Cookie writes; leave all authentication state and forwarding policy to applications.
6. Validate source, types, lifecycle, complete tests, actual build artifacts and browser navigation.

## Compatibility And Migration

Shared controllers, Action navigation and compact generated imports remain. Server-controller modules export only controllers/types and require a request host. The private POST endpoint does not expose shared controllers or arbitrary methods.

## Tactical Protections During Migration

Do not put secrets into shared factory arguments or rendered/public data. The compiler rejects mixed value exports, raw implementation assets and browser imports of local private dependencies. The transport rejects cross-origin requests and ignores client identity/context claims.

## Tests And Security Validation

Use server-controllers.test.ts, server-controller-plugin.test.ts, internal-fetch.test.ts, controller-types.test.ts and existing lifecycle/navigation tests. Run scripts/verify-server-controllers.mjs against the built public package; test production preview and development separately.

## Performance And Resource Benchmarks

Warm shared/server SSR comparison and browser request counts belong in verification.md. ASTs are cached in development, remote request bodies are limited to 64 KiB, and per-request state is disposed with existing owners. Peak RSS and production throughput are not inferred from the local benchmark.

## Rollout And Rollback

This task changes the local workspace only. Deploy matching browser/server artifacts in a separately authorized release. Roll back as a feature unit; do not change a sensitive controller back to a shared base without first removing its secrets or introducing an explicit server endpoint.

## Acceptance Criteria

Complete checks/builds pass; original navigation/DI/projection behaviors remain covered; client JS/maps omit a synthetic secret; raw controller and dependency requests fail in development; SSR hydrates without duplicate execution; browser navigation executes remotely; application-selected HttpOnly cookies return to the browser; concurrent requests remain independent.

## Open Decisions

None required for local implementation. Business authentication and token policy are deliberately application-owned.
