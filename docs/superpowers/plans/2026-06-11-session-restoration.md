# Session Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. TDD throughout: failing test → run (fail) → implement → run (pass) → commit.

**Goal:** Add a UI-agnostic session restoration capability — serialize "what the user was doing" (navigation position + app-global slices + navigation-scoped per-screen state) to a pluggable `Storage` and rehydrate it on a fresh load, for both flat single-page and structured navigation.

**Architecture:** Platform-agnostic `core/session/` owns the snapshot model, serialization, a navigation-scoped state map (SwiftUI `@State` push/pop lifecycle via tree-presence pruning), and a `SessionStore` orchestrator decoupled from navigation behind a small `SessionNavigationAdapter`. `browser/` adds a Web Storage adapter + a `SessionBridge` that wires auto-capture (nav-change debounce + `pagehide`/`visibilitychange`) and boot restore, plus optional `startBrowserApp({ session })`. Additive only; absent config → unchanged behavior.

**Tech Stack:** TypeScript strict, Vite+ (`vp`) toolchain, Vitest (`vite-plus/test`). Depends on the navigation feature (`feat/navigation-containers`): `SerializedNavigation`, `serializeNavigation`/`deserializeNavigation`, `NavigationController`, `RouteParams`, `stableStringify`.

**Spec:** `docs/superpowers/specs/2026-06-11-session-restoration-design.md`

**Branch:** `feat/session-restoration` (stacked on `feat/navigation-containers`).

**Toolchain notes:** import from `vite-plus/test`; run a single test file with `vp test <path>`; scoped check with `vp check <dirs>` (bare `vp check` halts on the unrelated `packages/front/CHANGELOG.md` fmt — see memory). Match existing style: Chinese doc comments, `interface` for contracts, `type` for unions, `is*` guards, `create*` factories, `SCREAMING_SNAKE_CASE` consts, `readonly` fields.

---

## File Structure

**core (`packages/core/src/session/`):**
- `types.ts` — `SessionSnapshot`, `SessionUrlLocation`, `SessionStateProvider`, `SessionNavigationAdapter`, `SessionStoreOptions`, `SessionErrorContext`, `NavigationScopedState`, `SessionStore`, `SessionError`, `SESSION_DEFAULT_KEY`, `SESSION_DEFAULT_VERSION`, `isUrlLocation`.
- `snapshot.ts` — `encodeSnapshot`, `decodeSnapshot` (validation, version/shape checks).
- `scoped-state.ts` — `createNavigationScopedState`, `sessionEntryKey`, `collectLeafKeys`.
- `session-store.ts` — `createSessionStore`.
- `navigation-adapter.ts` — `createNavigationSessionAdapter`, `createUrlSessionAdapter`.
- `index.ts` — barrel.
- Tests colocated under `packages/core/test/session/*.test.ts`.
- Modify `packages/core/src/index.ts` — add `// ===== Session =====` export block.

**browser (`packages/browser/src/`):**
- `web-storage.ts` — `createWebStorage("session" | "local")`.
- `session-bridge.ts` — `createSessionBridge`.
- Modify `start-app.ts` — optional `session` config + wiring.
- Modify `index.ts` — export new symbols.
- Tests under `packages/browser/test/*.test.ts`.

**front:** modify `packages/front/src/index.ts` + `packages/front/src/browser.ts` (explicit named blocks).

**docs/changeset:** `packages/front/docs/12-session-restoration.md` + `zh/`, sidebars, `.changeset/session-restoration.md`.

---

## Task 1: core session types + snapshot codec

**Files:**
- Create: `packages/core/src/session/types.ts`
- Create: `packages/core/src/session/snapshot.ts`
- Test: `packages/core/test/session/snapshot.test.ts`

**Interfaces (types.ts):**

```ts
import type { RouteParams } from "../router/types";
import type { SerializedNavigation } from "../navigation";

export const SESSION_DEFAULT_KEY = "__finesoft_session__";
export const SESSION_DEFAULT_VERSION = 1;

export interface SessionUrlLocation { readonly url: string; }
export function isUrlLocation(nav: SessionSnapshot["navigation"]): nav is SessionUrlLocation;

export interface SessionSnapshot {
    readonly version: number;
    readonly navigation?: SerializedNavigation | SessionUrlLocation;
    readonly slices: Readonly<Record<string, unknown>>;
    readonly scoped: Readonly<Record<string, unknown>>;
    readonly capturedAt: number;
}

export class SessionError extends Error { constructor(message: string); } // name = "SessionError"
```

`isUrlLocation`: `nav != null && typeof nav === "object" && "url" in nav && typeof (nav as SessionUrlLocation).url === "string"` — note `SerializedNavigation` has `kind`, never a `url` field, so the discriminant is unambiguous.

**snapshot.ts:**
```ts
encodeSnapshot(snapshot: SessionSnapshot): string  // stableStringify(snapshot)
decodeSnapshot(raw: string | undefined, expectedVersion: number): SessionSnapshot | undefined
// decode: undefined/parse-error/shape-invalid/version-mismatch → undefined (never throws)
// shape: version:number, slices:object, scoped:object, capturedAt:number; navigation optional
```

- [ ] **Step 1: Write failing tests** (`snapshot.test.ts`):
```ts
import { describe, expect, test } from "vite-plus/test";
import { encodeSnapshot, decodeSnapshot } from "../../src/session/snapshot";
import { SESSION_DEFAULT_VERSION } from "../../src/session/types";
import type { SessionSnapshot } from "../../src/session/types";

const snap = (over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
    version: 1, slices: {}, scoped: {}, capturedAt: 1000, ...over,
});

describe("encode/decode snapshot", () => {
    test("round-trips a full snapshot", () => {
        const s = snap({
            navigation: { kind: "stack", entries: [{ kind: "leaf", intent: "home", params: {} }] },
            slices: { theme: "dark" },
            scoped: { "home {}": { scroll: 40 } },
        });
        expect(decodeSnapshot(encodeSnapshot(s), 1)).toEqual(s);
    });
    test("round-trips a flat url location", () => {
        const s = snap({ navigation: { url: "/posts/7" }, slices: { q: "x" } });
        expect(decodeSnapshot(encodeSnapshot(s), 1)).toEqual(s);
    });
    test("undefined raw → undefined", () => { expect(decodeSnapshot(undefined, 1)).toBeUndefined(); });
    test("malformed JSON → undefined (no throw)", () => { expect(decodeSnapshot("{not json", 1)).toBeUndefined(); });
    test("version mismatch → undefined", () => {
        expect(decodeSnapshot(encodeSnapshot(snap({ version: 1 })), 2)).toBeUndefined();
    });
    test("missing required field → undefined", () => {
        expect(decodeSnapshot(JSON.stringify({ version: 1, slices: {} }), 1)).toBeUndefined();
    });
});
```
- [ ] **Step 2: Run, expect FAIL** — `vp test packages/core/test/session/snapshot.test.ts` (modules missing).
- [ ] **Step 3: Implement** `types.ts` + `snapshot.ts` per interfaces above. `decodeSnapshot` wraps `JSON.parse` in try/catch, validates `typeof` of each field, checks `version === expectedVersion`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): session snapshot model + codec`.

---

## Task 2: navigation-scoped state (the SwiftUI push/pop core)

**Files:**
- Create: `packages/core/src/session/scoped-state.ts`
- Test: `packages/core/test/session/scoped-state.test.ts`

**API:**
```ts
import { stableStringify } from "../prefetched-intents/stable-stringify";
import { collectVisibleDestinations } from "../navigation"; // NOT this — see collectLeafKeys
import type { NavigationNode } from "../navigation";
import type { RouteParams } from "../router/types";
import type { NavigationScopedState } from "./types";

export function sessionEntryKey(intent: string, params: RouteParams): string;
// `${intent} ${stableStringify(params)}` — mirrors controller destinationKey

export function collectLeafKeys(tree: NavigationNode): string[];
// walk the WHOLE tree (every leaf anywhere: stack entries, ALL tab branches, all split columns)
// → sessionEntryKey for each. NOTE: "all present", not "visible".

export function createNavigationScopedState(initial?: Record<string, unknown>): NavigationScopedState;
// get/set/delete/keys + prune(presentKeys): drop every key not in the present set.
```

`collectLeafKeys` recursion: leaf → [key]; stack → flatMap(entries); tabs → flatMap(Object.values(branches)); split → flatMap(columns where content) . Distinct from `collectVisibleDestinations` (which only follows active/visible) — scoped retention needs ALL present entries.

- [ ] **Step 1: Write failing tests** (`scoped-state.test.ts`):
```ts
import { describe, expect, test } from "vite-plus/test";
import { createNavigationScopedState, sessionEntryKey, collectLeafKeys } from "../../src/session/scoped-state";
import { leaf, stack, tabs, split } from "../../src/navigation/nodes";

describe("sessionEntryKey", () => {
    test("stable for same intent+params regardless of key order", () => {
        expect(sessionEntryKey("p", { a: 1, b: 2 })).toBe(sessionEntryKey("p", { b: 2, a: 1 }));
    });
});

describe("collectLeafKeys (all present, not just visible)", () => {
    test("stack collects every entry (A under B)", () => {
        const tree = stack([leaf("A"), leaf("B")]);
        expect(collectLeafKeys(tree)).toEqual([sessionEntryKey("A", {}), sessionEntryKey("B", {})]);
    });
    test("tabs collects ALL branches (inactive retained)", () => {
        const tree = tabs({ active: "x", branches: { x: leaf("X"), y: leaf("Y") } });
        expect(collectLeafKeys(tree).sort()).toEqual([sessionEntryKey("X", {}), sessionEntryKey("Y", {})].sort());
    });
});

describe("NavigationScopedState.prune — SwiftUI push/pop lifecycle", () => {
    test("pop B drops B, keeps A", () => {
        const s = createNavigationScopedState();
        s.set(sessionEntryKey("A", {}), { scroll: 10 });
        s.set(sessionEntryKey("B", {}), { draft: "hi" });
        // pop B → present = {A}
        s.prune(collectLeafKeys(stack([leaf("A")])));
        expect(s.get(sessionEntryKey("A", {}))).toEqual({ scroll: 10 });
        expect(s.get(sessionEntryKey("B", {}))).toBeUndefined();
    });
    test("get/set/delete/keys", () => {
        const s = createNavigationScopedState({ k: 1 });
        expect(s.get("k")).toBe(1);
        s.set("k2", 2); expect(s.keys().sort()).toEqual(["k", "k2"]);
        s.delete("k"); expect(s.get("k")).toBeUndefined();
    });
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `scoped-state.ts`. `createNavigationScopedState` holds a `Map`; `prune` builds a `Set(presentKeys)` and deletes absent keys.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): navigation-scoped session state + entry keys`.

---

## Task 3: SessionStore orchestrator

**Files:**
- Create: `packages/core/src/session/session-store.ts`
- Modify: `packages/core/src/session/types.ts` (add `SessionStateProvider`, `SessionNavigationAdapter`, `SessionStoreOptions`, `SessionErrorContext`, `NavigationScopedState`, `SessionStore`)
- Test: `packages/core/test/session/session-store.test.ts`

**Interfaces (append to types.ts):**
```ts
export interface SessionStateProvider<T = unknown> { readonly key: string; capture(): T; restore(data: T): void; }
export interface SessionNavigationAdapter {
    capture(): SessionSnapshot["navigation"] | undefined;
    apply(navigation: SessionSnapshot["navigation"]): void | Promise<void>;
    presentKeys(): Iterable<string>;
}
export interface NavigationScopedState {
    get(entryKey: string): unknown | undefined;
    set(entryKey: string, data: unknown): void;
    delete(entryKey: string): void;
    prune(presentKeys: Iterable<string>): void;
    keys(): readonly string[];
}
export interface SessionErrorContext { readonly phase: "capture" | "restore" | "persist" | "load"; readonly key?: string; }
export interface SessionStoreOptions {
    readonly storage: Storage; // from ../dependencies/make-dependencies
    readonly key?: string;
    readonly version?: number;
    readonly maxAgeMs?: number;
    readonly navigation?: SessionNavigationAdapter;
    readonly now?: () => number;
    readonly onError?: (error: unknown, ctx: SessionErrorContext) => void;
}
export interface SessionStore {
    register(provider: SessionStateProvider): () => void;
    readonly scope: NavigationScopedState;
    capture(): SessionSnapshot;
    persist(snapshot?: SessionSnapshot): void;
    load(): SessionSnapshot | undefined;
    restore(snapshot?: SessionSnapshot): void | Promise<void>;
    clear(): void;
    save(): void;
}
```

**session-store.ts behavior:**
- `register` adds to a `Map<key, provider>`; returns disposer.
- `capture()`: build `{ version, navigation: navigation?.capture(), slices, scoped: {...scopeMap}, capturedAt: now() }`. `slices` = each provider's `capture()` wrapped in try/catch → onError(phase:"capture",key) + skip on throw.
- `persist(s = capture())`: `storage.set(key, encodeSnapshot(s))` in try/catch → onError(phase:"persist").
- `load()`: `decodeSnapshot(storage.get(key), version)`; then if `maxAgeMs` set and `now() - capturedAt > maxAgeMs` → undefined.
- `restore(s = load())`: if no snapshot, return. `await navigation?.apply(s.navigation)`; backfill scope (`scope` rebuilt from `s.scoped`); for each provider with `s.slices[key] !== undefined`, `provider.restore(...)` in try/catch → onError(phase:"restore",key)+skip. Returns the Promise when apply is async.
- `clear()`: `storage.delete(key)`.
- `save()`: `persist()`.
- `scope`: a `createNavigationScopedState()` instance held by the store; `restore` replaces its contents from snapshot.

- [ ] **Step 1: Write failing tests** (`session-store.test.ts`) with fakes:
```ts
import { describe, expect, test, vi } from "vite-plus/test";
import { createSessionStore } from "../../src/session/session-store";
import type { Storage } from "../../src/dependencies/make-dependencies";
import type { SessionNavigationAdapter, SessionStateProvider } from "../../src/session/types";

function fakeStorage(): Storage {
    const m = new Map<string, string>();
    return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), delete: (k) => void m.delete(k) };
}
function fakeNav(initial: unknown): SessionNavigationAdapter {
    let nav = initial; const present = new Set<string>();
    return {
        capture: () => nav as never,
        apply: (n) => { nav = n; },
        presentKeys: () => present,
    };
}

describe("SessionStore", () => {
    test("capture collects nav + slices + scoped", () => {
        const store = createSessionStore({ storage: fakeStorage(), now: () => 5, navigation: fakeNav({ url: "/a" }) });
        store.register({ key: "theme", capture: () => "dark", restore: () => {} });
        store.scope.set("home {}", { scroll: 9 });
        const s = store.capture();
        expect(s).toMatchObject({ version: 1, navigation: { url: "/a" }, slices: { theme: "dark" }, scoped: { "home {}": { scroll: 9 } }, capturedAt: 5 });
    });

    test("persist → load round-trip", () => {
        const storage = fakeStorage();
        const store = createSessionStore({ storage, now: () => 1 });
        store.register({ key: "q", capture: () => "x", restore: () => {} });
        store.save();
        expect(store.load()?.slices).toEqual({ q: "x" });
    });

    test("restore applies nav + scoped + slices", async () => {
        const storage = fakeStorage();
        const restored: string[] = [];
        const nav = fakeNav(undefined);
        const store = createSessionStore({ storage, navigation: nav, now: () => 1 });
        store.register({ key: "draft", capture: () => "", restore: (d) => restored.push(d as string) });
        storage.set("__finesoft_session__", JSON.stringify({ version: 1, navigation: { url: "/x" }, slices: { draft: "hello" }, scoped: { "k {}": 1 }, capturedAt: 1 }));
        await store.restore();
        expect(restored).toEqual(["hello"]);
        expect(store.scope.get("k {}")).toBe(1);
    });

    test("maxAgeMs expiry → load undefined", () => {
        const storage = fakeStorage();
        const a = createSessionStore({ storage, now: () => 0 }); a.save();
        const b = createSessionStore({ storage, now: () => 10_000, maxAgeMs: 5000 });
        expect(b.load()).toBeUndefined();
    });

    test("version mismatch → load undefined", () => {
        const storage = fakeStorage();
        createSessionStore({ storage, version: 1, now: () => 1 }).save();
        expect(createSessionStore({ storage, version: 2 }).load()).toBeUndefined();
    });

    test("provider capture throw isolated (onError, other slices survive)", () => {
        const onError = vi.fn();
        const store = createSessionStore({ storage: fakeStorage(), onError, now: () => 1 });
        store.register({ key: "boom", capture: () => { throw new Error("x"); }, restore: () => {} });
        store.register({ key: "ok", capture: () => 1, restore: () => {} });
        expect(store.capture().slices).toEqual({ ok: 1 });
        expect(onError).toHaveBeenCalledOnce();
    });

    test("clear removes persisted snapshot", () => {
        const storage = fakeStorage();
        const store = createSessionStore({ storage, now: () => 1 }); store.save();
        store.clear(); expect(store.load()).toBeUndefined();
    });
});
```
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `session-store.ts` + append interfaces to `types.ts`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): session store orchestrator`.

---

## Task 4: navigation adapters (structured + flat)

**Files:**
- Create: `packages/core/src/session/navigation-adapter.ts`
- Test: `packages/core/test/session/navigation-adapter.test.ts`

**API:**
```ts
import { serializeNavigation, deserializeNavigation } from "../navigation";
import type { NavigationController } from "../navigation";
import { collectLeafKeys, sessionEntryKey } from "./scoped-state";
import { isUrlLocation } from "./types";
import type { SessionNavigationAdapter, SessionSnapshot } from "./types";

export function createNavigationSessionAdapter(controller: NavigationController): SessionNavigationAdapter;
// capture: serializeNavigation(controller.getTree())
// apply: if isUrlLocation(nav) → controller.hydrate(leaf-from-url is app concern; here: ignore/September)
//        else controller.hydrate(deserializeNavigation(nav))
// presentKeys: collectLeafKeys(controller.getTree())

export interface UrlAdapterOptions {
    readonly currentUrl: () => string;
    readonly navigate: (url: string) => void | Promise<void>;
    readonly currentIntent?: () => { intent: string; params: RouteParams };
}
export function createUrlSessionAdapter(opts: UrlAdapterOptions): SessionNavigationAdapter;
// capture: { url: opts.currentUrl() }
// apply: if isUrlLocation(nav) → opts.navigate(nav.url)
// presentKeys: single key — sessionEntryKey from currentIntent() if provided, else [currentUrl()]
```

For the structured adapter `apply` when given a `SessionUrlLocation` (mixed snapshot): deserialize is N/A; treat as no-op (structured app always captures a tree). Keep simple: structured.apply only handles `SerializedNavigation`; url-location → no-op + nothing thrown.

- [ ] **Step 1: Write failing tests** — structured: capture serializes tree, apply hydrates, presentKeys = all leaves; flat: capture returns `{url}`, apply calls navigate, presentKeys single. Use a fake controller (`getTree`/`hydrate` spy) and a fake navigate spy.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): session navigation adapters`.

---

## Task 5: core barrel + index exports

**Files:**
- Create: `packages/core/src/session/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: none new (covered by an export smoke check in Task 12).

- [ ] **Step 1:** `session/index.ts` re-exports all public symbols/types from types/snapshot/scoped-state/session-store/navigation-adapter (explicit named, alphabetized, values + types split — match `navigation/index.ts` style).
- [ ] **Step 2:** Add `// ===== Session =====` block to `packages/core/src/index.ts` (values: `createSessionStore`, `createNavigationScopedState`, `createNavigationSessionAdapter`, `createUrlSessionAdapter`, `encodeSnapshot`, `decodeSnapshot`, `sessionEntryKey`, `collectLeafKeys`, `isUrlLocation`, `SessionError`, `SESSION_DEFAULT_KEY`, `SESSION_DEFAULT_VERSION`; types: `SessionSnapshot`, `SessionUrlLocation`, `SessionStateProvider`, `SessionNavigationAdapter`, `SessionStore`, `SessionStoreOptions`, `SessionErrorContext`, `NavigationScopedState`, `UrlAdapterOptions`).
- [ ] **Step 3: Verify** — `vp check packages/core/src packages/core/test` (fmt+lint+types) PASS; `vp test packages/core` PASS.
- [ ] **Step 4: Commit** — `feat(core): export session API`.

---

## Task 6: browser Web Storage adapter

**Files:**
- Create: `packages/browser/src/web-storage.ts`
- Test: `packages/browser/test/web-storage.test.ts`

```ts
import type { Storage } from "@finesoft/core";
export function createWebStorage(kind: "session" | "local"): Storage;
// pick window.sessionStorage|localStorage; get→getItem ?? undefined; set→setItem (try/catch swallow quota);
// delete→removeItem; if the chosen storage is unavailable (throws on access / undefined) → no-op Storage.
```

- [ ] **Step 1: Write failing tests** — set/get/delete against a jsdom `sessionStorage`; quota error on `setItem` swallowed; unavailable storage → no-op (get returns undefined). Use existing browser test DOM setup pattern (see `web-storage` neighbours / `start-app.test.ts`).
- [ ] **Step 2: Run, expect FAIL** — `vp test packages/browser/test/web-storage.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(browser): web storage adapter`.

---

## Task 7: SessionBridge (auto-capture + restore + scoped prune)

**Files:**
- Create: `packages/browser/src/session-bridge.ts`
- Test: `packages/browser/test/session-bridge.test.ts`

```ts
import type { SessionSnapshot, SessionStore, SessionNavigationAdapter } from "@finesoft/core";

export const SESSION_DEFAULT_DEBOUNCE_MS = 500;

export interface SessionBridgeOptions {
    readonly store: SessionStore;
    readonly adapter: SessionNavigationAdapter; // for presentKeys() on nav change
    readonly subscribeNavigation?: (onChange: () => void) => () => void;
    readonly debounceMs?: number;
    readonly shouldRestore?: (snapshot: SessionSnapshot, currentUrl: string) => boolean;
}
export interface SessionHandle {
    restore(currentUrl: string): void | Promise<void>;
    save(): void;
    clear(): void;
    dispose(): void;
}
export function createSessionBridge(options: SessionBridgeOptions): SessionHandle;
export function defaultShouldRestore(snapshot: SessionSnapshot, currentUrl: string): boolean;
```

Behavior:
- On `subscribeNavigation` change: `store.scope.prune(adapter.presentKeys())`, then debounced `store.save()`.
- `pagehide` + `visibilitychange` (when `document.visibilityState === "hidden"`): flush immediately (`store.save()`), cancel pending debounce.
- `restore(currentUrl)`: `const s = store.load(); if (s && (shouldRestore ?? defaultShouldRestore)(s, currentUrl)) return store.restore(s);`
- `dispose`: remove all listeners, clear timers.
- `defaultShouldRestore`: per spec §3.6 — flat (`isUrlLocation`): `currentUrl === nav.url || path(currentUrl) === "/"`; structured (`SerializedNavigation`): `path(currentUrl) === "/"`; no navigation: `true`. `path()` strips query/hash.

- [ ] **Step 1: Write failing tests** — use `vi.useFakeTimers()`:
  - nav change → debounced save persists after `debounceMs`.
  - nav change prunes scope (pop B drops B before save).
  - `pagehide` flushes immediately + cancels debounce.
  - `restore`: persisted snapshot at root `/` → applied; deep-link mismatch (flat, different url) → NOT applied; structured at `/x` → NOT applied; structured at `/` → applied; slices-only → applied.
  - `dispose` removes listeners (subsequent events no-op).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** — `vp test packages/browser/test/session-bridge.test.ts`.
- [ ] **Step 5: Commit** — `feat(browser): session bridge (auto-capture + restore + scoped prune)`.

---

## Task 8: startBrowserApp integration + browser exports

**Files:**
- Modify: `packages/browser/src/start-app.ts`
- Modify: `packages/browser/src/index.ts`
- Test: `packages/browser/test/start-app.test.ts` (extend)

`BrowserAppConfig` gains optional:
```ts
session?: {
    readonly providers?: readonly SessionStateProvider[];
    readonly storage?: Storage;            // default createWebStorage("session")
    readonly version?: number;
    readonly maxAgeMs?: number;
    readonly debounceMs?: number;
    readonly shouldRestore?: (snapshot: SessionSnapshot, currentUrl: string) => boolean;
};
onSessionReady?: (handle: SessionHandle) => void | Promise<void>;
```
When `config.session` present: build `SessionStore` (adapter: structured if `config.navigation` present → `createNavigationSessionAdapter(controller)`, else flat → `createUrlSessionAdapter({ currentUrl: () => location.pathname + location.search, navigate: (u) => framework.perform(makeFlowAction(u)) })`), register providers, build `SessionBridge` (subscribeNavigation from the nav bridge if present, else the flow handler's onNavigate), call `bridge.restore(initialUrl)` after the first navigation, hand `handle` to `onSessionReady`. **Absent → the existing path is byte-for-byte unchanged.**

- [ ] **Step 1: Write failing tests** — (a) no `session` config → existing tests unchanged (regression); (b) with `session` + flat → boot restore of a pre-seeded sessionStorage snapshot fires provider.restore; (c) `onSessionReady` receives a handle. Mock DOM/storage per existing `start-app.test.ts`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** wiring + `index.ts` exports (`createSessionBridge`, `createWebStorage`, `SESSION_DEFAULT_DEBOUNCE_MS`, `defaultShouldRestore` + types `SessionBridgeOptions`, `SessionHandle`, `BrowserSessionConfig`).
- [ ] **Step 4: Run, expect PASS** — `vp test packages/browser`.
- [ ] **Step 5: Commit** — `feat(browser): startBrowserApp session opt-in`.

---

## Task 9: front re-exports

**Files:**
- Modify: `packages/front/src/index.ts` (core auto-surfaces via `export *`; add browser block symbols)
- Modify: `packages/front/src/browser.ts` (add the same browser symbols)

- [ ] **Step 1:** Add `createSessionBridge`, `createWebStorage`, `defaultShouldRestore`, `SESSION_DEFAULT_DEBOUNCE_MS` + types `SessionBridgeOptions`, `SessionHandle`, `BrowserSessionConfig` to the explicit `@finesoft/browser` blocks in BOTH `index.ts` and `browser.ts`. (Core session symbols flow automatically via `export * from "@finesoft/core"`.)
- [ ] **Step 2: Verify** — `vp run -r build` succeeds; grep `packages/front/dist/index.d.mts` for `createSessionStore` and `createSessionBridge`.
- [ ] **Step 3: Commit** — `feat(front): re-export session restoration API`.

---

## Task 10: docs (bilingual guide + sidebar)

**Files:**
- Create: `packages/front/docs/12-session-restoration.md`
- Create: `packages/front/docs/zh/12-session-restoration.md`
- Modify: `packages/site/docs/.vitepress/sidebars/en.ts`, `.../zh.ts`

- [ ] **Step 1:** Write the guide (match the existing chapter style of `11-navigation.md`): the two scopes (global slices vs navigation-scoped), the SwiftUI push/pop example (A→B→pop, B lost, A kept), `defineNavigation`-less flat usage + structured usage, `startBrowserApp({ session })`, providers, sessionStorage default + swapping Storage, `shouldRestore` deep-link policy, the flat-vs-structured retention note (retention = stack). Verify every referenced symbol is a real export.
- [ ] **Step 2:** Add sidebar entries (EN "Session restoration" `/12-session-restoration`; ZH "会话恢复" `/zh/12-session-restoration`).
- [ ] **Step 3: Commit** — `docs: session restoration guide`.

---

## Task 11: changeset

**Files:**
- Create: `.changeset/session-restoration.md`

- [ ] **Step 1:** Format per `.changeset/navigation-state.md` — `"@finesoft/front": minor`, one-paragraph summary + `###` subsections (snapshot model + two scopes; navigation-scoped SwiftUI lifecycle; pluggable Storage + auto/manual capture; browser bridge + startBrowserApp opt-in).
- [ ] **Step 2: Commit** — `chore: changeset for session restoration`.

---

## Task 12: full verification

- [ ] **Step 1:** `vp check packages/core/src packages/core/test packages/browser/src packages/browser/test packages/front/src` — fmt+lint+types clean (scoped to avoid the CHANGELOG fmt halt).
- [ ] **Step 2:** `vp test` — entire suite green; assert no pre-existing test regressed.
- [ ] **Step 3:** `vp run -r build` — all build tasks succeed; new symbols in `@finesoft/front` DTS.
- [ ] **Step 4:** grep new source for `TODO`/`FIXME`/`as any`/`not implemented` — none.
- [ ] **Step 5: Commit** any fmt fixups — `chore: session restoration verification`.

---

## Self-Review (coverage vs spec)

- §3.1 snapshot model → Task 1 ✓ (incl. `scoped`).
- §3.2 providers → Task 3 ✓; §3.2.1 navigation-scoped + entryKey + collectLeafKeys + prune lifecycle → Task 2 ✓ (+ flat-vs-structured note → docs Task 10).
- §3.3 SessionStore (capture/persist/load/restore/clear/save/scope, version/maxAge/clock/onError) → Task 3 ✓.
- §3.4 adapters (capture/apply/presentKeys, structured+flat helpers) → Task 4 ✓.
- §3.5 codec (encode/decode, graceful undefined) → Task 1 ✓.
- §3.6 browser (createWebStorage, SessionBridge, pagehide/visibilitychange, debounce, prune-on-nav, defaultShouldRestore) → Tasks 6–7 ✓.
- §3.7 startBrowserApp opt-in + front → Tasks 8–9 ✓.
- §5 robustness (discard stale/malformed, provider isolation, quota swallow) → Tasks 1/3/6 ✓.
- §6 tests → every task has TDD tests; scoped lifecycle emphasized in Task 2 + Task 7.
- §7 file list → Tasks 1–11 cover every file.

Type consistency: `sessionEntryKey`/`collectLeafKeys` (Task 2) used identically in Tasks 4/7; `SessionHandle`/`createSessionBridge` (Task 7) re-exported unchanged in Tasks 8/9; `Storage` is the existing core interface throughout.
