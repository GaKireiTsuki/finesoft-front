/**
 * Phase 4 spike target spec — un-skip when implementing Tasks 2-4.
 *
 * SPIKE CONCLUSION (Task 1):
 *
 * `onAction` / `perform` semantics (dispatcher.ts:27-32):
 *   - `onAction(kind, handler)` keeps the FIRST registration and SKIPS subsequent ones
 *     (warns + returns). So after `registerFlowActionHandler` registers FLOW, any
 *     subsequent `onAction(ACTION_KINDS.FLOW, ...)` call is silently dropped.
 *   - `perform` dispatches to exactly ONE handler per kind (Map lookup, dispatcher.ts:54-61).
 *   - There is no multi-handler chain or append semantics.
 *
 * Chosen approach: **(B) Injection point** — add an `onForward` hook to
 * `registerFlowActionHandler` / `FlowActionDependencies`.
 *
 *   Why not (A) Override:
 *     `onAction` is "first-wins", so a second registration for FLOW is silently dropped
 *     (line 29: `if (this.handlers.has(kind)) { console.warn; return; }`).
 *     The only way to override is `removeAction(kind)` then re-register — workable but
 *     fragile: it runs BEFORE `registerFlowActionHandler` in `registerActionHandlers`,
 *     meaning you'd have to post-hoc remove/re-add after the fact. This inverts the
 *     natural registration order and is brittle if wiring order changes.
 *
 *   Why not (C) Pre-intercept perform:
 *     Wrapping `framework.perform` is possible (it delegates to `actionDispatcher.perform`),
 *     but the interception has to distinguish forward FLOW from modal FLOW — which duplicates
 *     the `presentationContext === "modal"` check already in `registerFlowActionHandler`.
 *     It also intercepts at a higher level and bypasses the existing race-protection /
 *     `navigationId` logic, requiring it to be re-implemented in the wrapper.
 *
 *   Why (B) is cleanest:
 *     `registerFlowActionHandler` already handles modal vs. forward split at line 194-196.
 *     Adding an optional `onForward?: (url: string) => Promise<void> | void` dep means the
 *     existing handler stays as is for the modal path, and flat-islands just provides the
 *     forward hook. No second handler registration, no post-hoc remove/re-add, no duplication
 *     of the modal check. The injection is a one-line change in `navigateTo`'s call site
 *     (or better: at the `ACTION_KINDS.FLOW` handler entry after the modal check).
 *
 * FEASIBILITY VERDICT: Cleanly achievable with approach B. No architectural blockers.
 *   - `NavigationRouterLike.getRoutes()` + optional `reverse()` is sufficient for
 *     `createFlatStackCodec` (same interface already used by `createActiveLeafCodec`).
 *   - The `manageHistory` flag already splits flat vs. structured history ownership;
 *     flat-islands just needs to extend the condition to also cover `config.mountEntry`.
 *   - The orchestrator, bridge, and controller are already battle-tested by Phase 1-2.
 *
 * COST ESTIMATE:
 *   Task 2 (flat-stack-codec): SMALL — ~50 lines, pattern matches createActiveLeafCodec.
 *     Risk: the synchronous `decode` returning a NavigationNode may need to use
 *     router.getRoutes() pattern matching (like reverseFromRoutes) since the codec
 *     interface doesn't receive `await router.resolve()`. Tolerable: same workaround
 *     used by createActiveLeafCodec (returns undefined and delegates to async path).
 *     For flat-islands decode we want a stack(leaf) synchronously — we need a sync
 *     route match. Needs a minimal sync path in the codec or a Router.matchSync helper.
 *   Task 3 (activateFlatIslands + FLOW routing + wiring): MEDIUM — ~120 lines.
 *     Risk concentrates in two points: (1) the `onForward` injection changes
 *     `registerFlowActionHandler` which is on the shared hot path — test coverage
 *     should expand; (2) initial URL routing for `stack(leaf)` construction needs
 *     the same async `routeUrl` already called in the flow handler, so the codec
 *     decode must accept undefined and let activateFlatIslands do the async initial.
 *   Task 4 (re-export + front integration): SMALL — ~10 lines.
 *
 * RECOMMENDATION: IMPLEMENT Phase 4.
 *   Flat apps are the common case today. The cost is manageable (total ~200 lines across
 *   3 files + 1 small change to registerFlowActionHandler). The alternative (forcing all
 *   flat apps to rewrite to structured single-stack) is a larger migration burden on users.
 *   The only non-trivial uncertainty is sync route matching in flat-stack-codec.decode —
 *   resolved by following the same undefined-fallback pattern as createActiveLeafCodec.
 */

import { describe, test } from "vite-plus/test";

import { stubDomGlobals } from "./fake-dom";

stubDomGlobals();

// ---------------------------------------------------------------------------
// Phase 4 target spec (all tests skipped until Tasks 2-4 are implemented)
// ---------------------------------------------------------------------------

describe.skip("flat islands（顶层 mountEntry，無 navigation）", () => {
    test("首屏 island 挂载到 [data-fs-outlet]", async () => {
        // ARRANGE: startBrowserApp with top-level mountEntry, no navigation
        // url = /a, routes: /a → "a", /b → "b"
        // ACT: await startBrowserApp(...)
        // ASSERT: mountEntry called once with entryKey for "a"
        //         outlet has exactly one [data-fs-entry] child with key = KEY("a", {})
    });

    test("正向导航（FlowAction /b）：B island 挂载，A island detach 保活", async () => {
        // ARRANGE: same as above, app started on /a
        // ACT: framework.perform(makeFlowAction("/b"))
        // ASSERT: mountEntry call log = [KEY("a",{}), KEY("b",{})]  (only 2 total, A not re-mounted)
        //         outlet attached = [KEY("b",{})]   (only B visible)
        //         KEY("a") island node still exists in DOM but detached (not in outlet)
    });

    test("back（popstate）：A island 复用活实例不重挂，重 attach 回 outlet", async () => {
        // ARRANGE: same as above, navigate forward to /b
        // ACT: dispatchEvent(new PopStateEvent("popstate", { state: historyStateForA }))
        // ASSERT: mountEntry call log still = [KEY("a",{}), KEY("b",{})]  (no new mount for A)
        //         outlet attached = [KEY("a",{})]   (A back in outlet)
    });

    test("forward 越界（back 后再次 FlowAction /b）：B island 从活缓存复用不重挂", async () => {
        // ARRANGE: start /a → navigate /b → back to /a → forward to /b again
        // ASSERT: mountEntry call log = [KEY("a",{}), KEY("b",{})]  (still only 2 total)
        //         outlet attached = [KEY("b",{})]
    });

    test("modal FlowAction 仍由扁平 handler 处理（不经过 controller.push）", async () => {
        // ARRANGE: startBrowserApp same config + callbacks.onModal spy
        // ACT: framework.perform(makeFlowAction("/b", "modal"))
        // ASSERT: callbacks.onModal called once with page for /b
        //         island stack unchanged (no push to controller)
    });
});
