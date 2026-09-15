# Template unification code review

**Review base:** `63be7599ab194cdc1b061a7b65922a57d19f89f3`  
**Review target:** current uncommitted template-unification work  
**Method:** read-only review of the plan, supplied patch, representative identical neutral TypeScript, all six native view implementations and the verification/consumer/static-output evidence. No checks were rerun.

## Strengths

- The implementation preserves the requested two tiers and gives each tier one portable application contract. The neutral files are byte-identical across React, Vue and Svelte except for the explicitly normalized renderer imports; the native components consistently expose the same routes, content, actions and state behavior.
- Minimal correctly creates a new `NameStore` and session provider for every `mountApplication` call, subscribes after mount and unsubscribes on component disposal. This keeps embedded roots isolated while retaining the profile and entry drafts through reloads. See `templates/*-minimal/src/instance.ts:12-43`, `templates/*-minimal/src/main.ts:9-31`, and the framework-native `App` components.
- Full keeps the renderer-native surface small and explicit: `App` passes the one page/action contract into layout and the discriminated page renderers; all normal anchors retain `href` and only intercept ordinary primary clicks. The shared `NAV_LINKS` contract avoids the previous per-framework navigation drift.
- The added contract tests check neutral-file content, native component inventory, standalone TypeScript configuration, public import boundaries and normalized Vite adapters. The browser evidence records six same-tier production parity runs, history/guard/error paths, locale loader behavior and three isolated mounts. The static starter and all six packed, generated consumers also built successfully.
- Documentation accurately distinguishes source work, generated standalone consumers, tiers, lifecycle ownership and verification commands in both languages.

## Spec verdict

**Pass.** The requested scope is complete: full and minimal remain distinct, while React, Vue and Svelte within each tier have matching pages, routes, data and interactions. Runtime packages and CI remain outside the change.

## Re-review update

The earlier minor finding is addressed. `captureView()` now compares same-tier text with a normalized element/class/meaningful-attribute tree, including `data-restore-root` as a presence flag (`scripts/verify-template-renderers.mjs:17-48, 216-219`). The refreshed browser evidence passes all six production and three development cases with that structural parity assertion.

That expanded coverage exposed a real minimal-template error recovery gap: a FlowAction from the 404 page created a flat Home stack, so the Feed/Notes chrome disappeared. The fix exports and reuses the existing full tabs-tree factory (`templates/*-minimal/src/app-definition.ts:11-32`) and hydrates it from each native 404 view (`templates/*-minimal/src/pages/NotFound.*:1-35`). For browser-history roots, the navigation bridge subscribes to this user-initiated hydrate and writes the encoded `/` state; for embedded memory roots it restores the correct tree without touching the first root. The fresh development case verifies an independently mounted root beginning at `/does-not-exist`, recovery, tab selection and first-root isolation (`scripts/verify-template-renderers.mjs:281-307`).

`mountApplication` now forwards the documented optional initial URL in each minimal template (`templates/*-minimal/src/main.ts:9-25`), and the README/English/Chinese structure documentation use the updated signature. The added changeset scopes the release note to `@finesoft/create-app` only.

## Quality verdict

**Pass.** The code is typed, has explicit framework adapter boundaries, and the current behavior is supported by the refreshed production/dev browser evidence. The supplied `check.log` reports no formatting, lint or type errors; `create-app-tests.log` reports 17/17 passing tests. No Critical, Important or remaining Minor findings were found in the scoped re-review.

## Issues

### Critical (must fix)

None.

### Important (should fix)

None.

### Minor (nice to have)

None. The prior DOM-shape/class drift gap is closed by the refreshed browser parity capture.

## Assessment

**Ready to merge: Yes.** The implementation meets the accepted two-tier specification, its standalone/public-entry boundary is tested, and supplied runtime evidence covers state, navigation, SSR/CSR, guard, error recovery, DOM shape and independent mounts. The scoped re-review found no remaining issue.
