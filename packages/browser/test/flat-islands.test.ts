/**
 * Phase 4 spike target spec — un-skipped in Task 3.
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

import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

// ---------------------------------------------------------------------------
// History mock — must be hoisted so the module mock can reference it
// ---------------------------------------------------------------------------

import type { Logger } from "@finesoft/core";

type PopListener<State> = (url: string, state?: State) => void | Promise<void>;

const { HistoryMock } = vi.hoisted(() => {
    class HistoryMock<State> {
        static instances: HistoryMock<unknown>[] = [];

        readonly beforeTransition = vi.fn();
        readonly replaceState = vi.fn();
        readonly pushState = vi.fn();
        readonly replaceUrl = vi.fn();
        readonly pushUrl = vi.fn();
        readonly onPopState = vi.fn((listener: PopListener<State>) => {
            this.popListener = listener;
        });

        popListener: PopListener<State> | undefined;

        constructor(
            public readonly log: Logger,
            public readonly options: {
                getScrollablePageElement: () => HTMLElement | null;
                persistInHistoryState?: boolean;
            },
        ) {
            HistoryMock.instances.push(this as HistoryMock<unknown>);
        }

        static latest<T>(): HistoryMock<T> {
            const instance = HistoryMock.instances.at(-1);
            if (!instance) throw new Error("No HistoryMock instance created");
            return instance as HistoryMock<T>;
        }

        static reset(): void {
            HistoryMock.instances = [];
        }
    }
    return { HistoryMock };
});

vi.mock("../src/utils/history", () => ({ History: HistoryMock }));
vi.mock("@finesoft/core", async () => import("../../core/src/index.ts"));

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------

import { BaseController, makeFlowAction, sessionEntryKey } from "@finesoft/core";
import { startBrowserApp } from "../src/start-app";
import {
    FakeCustomEvent,
    FakeElement,
    FakeEvent,
    makeFakeDocumentWithRoot,
    stubDomGlobals,
} from "./fake-dom";

// Register CustomEvent + Event + document globals (no jsdom)
stubDomGlobals();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KEY = (intent: string, params: Record<string, unknown> = {}): string =>
    sessionEntryKey(intent, params);

/** Attached (in outlet) island keys in DOM order. */
function attachedKeys(outlet: FakeElement): string[] {
    return outlet
        .querySelectorAll("[data-fs-entry]")
        .map((el) => el.getAttribute("data-fs-key") ?? "");
}

/** Build a simple controller for a given intentId + page title. */
function makeController(intentId: string) {
    return new (class extends BaseController<
        Record<string, never>,
        { id: string; pageType: string; title: string }
    > {
        readonly intentId = intentId;
        execute() {
            return { id: intentId, pageType: intentId, title: intentId.toUpperCase() };
        }
    })();
}

// ---------------------------------------------------------------------------
// Global test setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", {
        location: { pathname: "/a", search: "", origin: "https://example.com" },
        history: {
            state: null as { id?: string } | null,
            replaceState: vi.fn(),
            pushState: vi.fn(),
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
});

afterEach(() => {
    HistoryMock.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // Re-apply the fake-dom stubs that stubDomGlobals registered at module level
    // (unstubAllGlobals wipes them; re-apply so document.createElement still works).
    vi.stubGlobal("CustomEvent", FakeCustomEvent);
    vi.stubGlobal("Event", FakeEvent);
});

// ---------------------------------------------------------------------------
// Shared test setup factory
// ---------------------------------------------------------------------------

import type { FlowActionCallbacks } from "../src/action-handlers/register";

async function buildApp(
    opts: { initialPath?: string; callbacks?: Partial<FlowActionCallbacks> } = {},
) {
    const path = opts.initialPath ?? "/a";
    vi.stubGlobal("window", {
        location: { pathname: path, search: "", origin: "https://example.com" },
        history: {
            state: null as { id?: string } | null,
            replaceState: vi.fn(),
            pushState: vi.fn(),
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });

    // Build a fake DOM tree: #app → <main data-fs-outlet>
    const root = new FakeElement("div");
    root.setAttribute("id", "app");
    const doc = makeFakeDocumentWithRoot("app", root);
    vi.stubGlobal("document", doc);

    const mountCalls: string[] = [];

    let capturedFramework: import("@finesoft/core").Framework | undefined;

    await startBrowserApp({
        bootstrap: (fw) => {
            fw.router.add("/a", "a");
            fw.router.add("/b", "b");
            fw.registerIntent(makeController("a"));
            fw.registerIntent(makeController("b"));
        },
        mount: (target, { framework }) => {
            capturedFramework = framework;
            // Put a stable outlet into the mount target
            const outlet = doc.createElement("main");
            outlet.setAttribute("data-fs-outlet", "");
            (target as unknown as FakeElement).appendChild(outlet as unknown as FakeElement);
            return () => undefined;
        },
        callbacks: { onNavigate() {}, onModal() {}, ...opts.callbacks },
        mountEntry: (entry, container) => {
            mountCalls.push(entry.entryKey);
            container.textContent = entry.page.title ?? "";
            return { unmount() {} };
        },
    });

    const outlet = root.querySelector("[data-fs-outlet]") as FakeElement;

    return { root, outlet, mountCalls, framework: capturedFramework! };
}

// ---------------------------------------------------------------------------
// Phase 4 target spec
// ---------------------------------------------------------------------------

describe("flat islands（顶层 mountEntry，无 navigation）", () => {
    test("首屏 island 挂载到 [data-fs-outlet]", async () => {
        const { outlet, mountCalls } = await buildApp();

        // Initial island for /a should be mounted exactly once
        expect(mountCalls).toEqual([KEY("a")]);
        // And attached in the outlet
        expect(attachedKeys(outlet)).toEqual([KEY("a")]);
    });

    test("正向导航（FlowAction /b）：B island 挂载，A island detach 保活", async () => {
        const { outlet, mountCalls, framework } = await buildApp();

        // Trigger forward navigation to /b
        await framework.perform(makeFlowAction("/b"));

        // A was mounted first, then B — A not re-mounted
        expect(mountCalls).toEqual([KEY("a"), KEY("b")]);
        // Only B is attached (A is detached/kept-alive)
        expect(attachedKeys(outlet)).toEqual([KEY("b")]);
        // A's container still exists in the orchestrator's map (it's kept alive)
        // We can verify by checking it's NOT in the outlet but the mount count is still 1 for A
    });

    test("back（popstate）：A island 复用活实例不重挂，重 attach 回 outlet", async () => {
        const { outlet, mountCalls, framework } = await buildApp();

        // Navigate forward to /b
        await framework.perform(makeFlowAction("/b"));
        expect(mountCalls).toEqual([KEY("a"), KEY("b")]);
        expect(attachedKeys(outlet)).toEqual([KEY("b")]);

        // Simulate back — trigger popstate on the bridge's History mock
        // The NavigationBridge's History receives popstate events; bridge calls controller.hydrate(tree).
        // On back to /a, the bridge will call codec.decode("/a", router) → stack([leaf("a", {})])
        // then controller.hydrate(stack([leaf("a", {})])), which syncs orchestrator → A reattaches.
        const bridgeHistory = HistoryMock.latest<{ tree: unknown }>();
        // Simulate popstate: url = "/a", no cached state → codec.decode path
        await bridgeHistory.popListener?.("/a", undefined);

        // mountEntry NOT called again for A (reuse)
        expect(mountCalls).toEqual([KEY("a"), KEY("b")]);
        // A is back in the outlet
        expect(attachedKeys(outlet)).toEqual([KEY("a")]);
    });

    test("forward 越界（back 后再次 FlowAction /b）：B island 重建（越界 = 离 present 集 → teardown）", async () => {
        // spec §5「flat 历史」决策：back 全活保活，但 forward 越界（超过 back 点）→ 重建。
        // 当 popstate 把树 hydrate 成 stack([leaf("a")]) 时，B 已离 presentKeys → teardown。
        // 再次 push /b 时 B 从零构建（mountEntry 再次调用）。
        const { outlet, mountCalls, framework } = await buildApp();

        // /a → /b
        await framework.perform(makeFlowAction("/b"));
        expect(mountCalls).toEqual([KEY("a"), KEY("b")]);

        // back to /a: hydrate(stack([leaf("a")])) → B 离 presentKeys → teardown
        const bridgeHistory = HistoryMock.latest<{ tree: unknown }>();
        await bridgeHistory.popListener?.("/a", undefined);
        expect(attachedKeys(outlet)).toEqual([KEY("a")]);

        // forward again to /b: B rebuilt (mount count grows to 3)
        await framework.perform(makeFlowAction("/b"));
        expect(mountCalls).toEqual([KEY("a"), KEY("b"), KEY("b")]);
        expect(attachedKeys(outlet)).toEqual([KEY("b")]);
    });

    test("modal FlowAction 仍由扁平 handler 处理（不经过 controller.push）", async () => {
        const onModalSpy = vi.fn();

        const { mountCalls, framework } = await buildApp({
            callbacks: { onModal: onModalSpy },
        });

        // After startup only /a is in the stack
        expect(mountCalls).toEqual([KEY("a")]);

        // Perform a modal FlowAction — presentationContext: "modal" causes the flat
        // FLOW handler to call callbacks.onModal (not onForward), so the island stack
        // must not change (controller.push is never called).
        await framework.perform(makeFlowAction("/b", "modal"));

        // (a) onModal callback fired
        expect(onModalSpy).toHaveBeenCalledOnce();
        // (b) island stack unchanged — /b was NOT pushed
        expect(mountCalls).toEqual([KEY("a")]);
    });
});
