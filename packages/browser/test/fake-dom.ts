/**
 * Minimal headless DOM stubs for browser package tests.
 *
 * The project has no jsdom / happy-dom. These classes replicate just enough of
 * the HTMLElement / CustomEvent / Event / document surface that
 * `navigation-islands.ts`, `dom-restore.ts`, and `start-app.ts` (islands path)
 * need.
 *
 * Usage:
 *   import { FakeElement, FakeCustomEvent, makeFakeDocument, stubDomGlobals } from "./fake-dom";
 *   // in test file top-level (before imports that need the globals):
 *   stubDomGlobals(); // registers vi.stubGlobal for CustomEvent + Event + document
 */

import { vi } from "vite-plus/test";

// ---------------------------------------------------------------------------
// Event stubs (base Event + CustomEvent)
// ---------------------------------------------------------------------------

export class FakeEvent {
    readonly type: string;
    readonly bubbles: boolean;
    target: FakeElement | null = null;
    constructor(type: string, init?: { bubbles?: boolean }) {
        this.type = type;
        this.bubbles = init?.bubbles ?? false;
    }
}

export class FakeCustomEvent extends FakeEvent {
    constructor(type: string, init?: { bubbles?: boolean }) {
        super(type, init);
    }
}

// ---------------------------------------------------------------------------
// FakeElement
// ---------------------------------------------------------------------------

export class FakeElement {
    readonly tagName: string;
    private _attrs: Map<string, string> = new Map();
    private _children: FakeElement[] = [];
    _parent: FakeElement | null = null;
    private _handlers: Map<string, ((e: FakeEvent) => void)[]> = new Map();
    textContent = "";
    scrollTop = 0;
    scrollLeft = 0;

    /** Form / input properties */
    value = "";
    checked = false;
    open = false; // <details>

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
    }

    /** `type` attribute (input[type=...]); defaults to "text". */
    get type(): string {
        return this._attrs.get("type") ?? "text";
    }

    /** `id` attribute. */
    get id(): string {
        return this._attrs.get("id") ?? "";
    }

    /** `name` attribute. */
    get name(): string {
        return this._attrs.get("name") ?? "";
    }

    setAttribute(name: string, value: string): void {
        this._attrs.set(name, value);
        // Keep `value`/`checked`/`open` props in sync with attribute setting (initial set).
        // Real DOM: setting value/checked props does NOT write back to attr, but setAttribute
        // DOES set the *default* value. We mirror that for initial construction.
        if (name === "value") this.value = value;
        if (name === "checked") this.checked = true; // presence = checked
        if (name === "open") this.open = true; // presence = open
    }

    getAttribute(name: string): string | null {
        return this._attrs.has(name) ? (this._attrs.get(name) ?? null) : null;
    }

    hasAttribute(name: string): boolean {
        return this._attrs.has(name);
    }

    appendChild(child: FakeElement): void {
        if (child._parent === this) {
            // already child → move to end (re-order)
            this._children = this._children.filter((c) => c !== child);
        } else {
            child._parent?.removeChild(child);
        }
        this._children.push(child);
        child._parent = this;
    }

    removeChild(child: FakeElement): void {
        this._children = this._children.filter((c) => c !== child);
        child._parent = null;
    }

    remove(): void {
        this._parent?.removeChild(this);
    }

    /** Returns the first element matching the selector in BFS document order, or null. */
    querySelector(selector: string): FakeElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    /**
     * BFS traversal in document order.
     * Supported selector syntax:
     *   - bare tag:               "input", "details"
     *   - attribute presence:     "[data-foo]"
     *   - attribute value:        "[data-foo="bar"]"
     *   - tag + attribute:        "input[name="x"]", "details[data-restore-key="k"]"
     *   - comma-OR list:          "input, textarea, select"
     *   - combined attr selectors: `[data-restore-key="x"], [name="x"]`
     */
    querySelectorAll(selector: string): FakeElement[] {
        const results: FakeElement[] = [];
        // BFS queue — shift() keeps document order
        const queue: FakeElement[] = [...this._children];
        while (queue.length > 0) {
            const el = queue.shift()!;
            if (matchesSelector(el, selector)) results.push(el);
            queue.push(...el._children);
        }
        return results;
    }

    addEventListener(type: string, handler: (e: FakeEvent) => void): void {
        const list = this._handlers.get(type) ?? [];
        list.push(handler);
        this._handlers.set(type, list);
    }

    removeEventListener(type: string, handler: (e: FakeEvent) => void): void {
        const list = this._handlers.get(type);
        if (!list) return;
        this._handlers.set(
            type,
            list.filter((h) => h !== handler),
        );
    }

    /**
     * Dispatch an event on this element and bubble up the _parent chain.
     * Faithfully models { bubbles: true } — event.target is set to the
     * originating element (the container the orchestrator dispatches on).
     */
    dispatchEvent(event: FakeEvent): void {
        event.target = this;
        // Walk from dispatch target up through ancestors, invoking handlers.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let current: FakeElement | null = this;
        while (current !== null) {
            const handlers = current._handlers.get(event.type);
            if (handlers) {
                for (const h of handlers) h(event);
            }
            current = event.bubbles ? current._parent : null;
        }
    }

    /**
     * Walk self → ancestors returning the first element that matches `selector`.
     * Returns null if no ancestor matches.
     */
    closest(selector: string): FakeElement | null {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let el: FakeElement | null = this;
        while (el !== null) {
            if (matchesSelector(el, selector)) return el;
            el = el._parent;
        }
        return null;
    }

    get children(): FakeElement[] {
        return [...this._children];
    }

    get parentElement(): FakeElement | null {
        return this._parent;
    }
}

// ---------------------------------------------------------------------------
// Selector matching helpers
// ---------------------------------------------------------------------------

/**
 * Match a selector string (possibly comma-separated) against a FakeElement.
 * Returns true if ANY comma-part matches.
 */
function matchesSelector(el: FakeElement, selector: string): boolean {
    for (const part of selector.split(",").map((s) => s.trim())) {
        if (matchesSingleSelector(el, part)) return true;
    }
    return false;
}

/**
 * Match a single (no comma) CSS selector token:
 *   - tag only:        "input"   → el.tagName === "INPUT"
 *   - attr only:       "[data-foo]" / `[data-foo="bar"]`
 *   - tag + attr(s):   "input[type="checkbox"]"
 *
 * A tag prefix is the leading identifier before the first `[`.
 * All `[attr]` / `[attr="val"]` tokens must match (AND logic).
 */
function matchesSingleSelector(el: FakeElement, selector: string): boolean {
    // Extract optional tag prefix (everything before the first "[" or end of string)
    const tagMatch = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(selector);
    const tag = tagMatch?.[1];

    // If a tag is specified it must match (case-insensitive)
    if (tag && el.tagName !== tag.toUpperCase()) return false;

    // Check every [attr] / [attr="val"] token
    const attrRe = /\[([^\]=]+)(?:="([^"]*)")?\]/g;
    let match: RegExpExecArray | null;
    while ((match = attrRe.exec(selector)) !== null) {
        const [, name, value] = match;
        if (value === undefined) {
            if (!el.hasAttribute(name!)) return false;
        } else {
            if (el.getAttribute(name!) !== value) return false;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// FakeGlobalTarget — minimal event registry for window / document globals
// ---------------------------------------------------------------------------

/**
 * Minimal event-target mixin for global objects (window, document).
 * Unlike FakeElement (which is a DOM node with parent/children), these are
 * singletons that only need addEventListener / removeEventListener /
 * dispatchEvent plus a small set of readable properties.
 *
 * dispatchEvent walks the handler list synchronously, matching the real
 * global-target behaviour.  This allows pagehide / visibilitychange tests
 * to work without capturing and manually invoking the vi.fn() mock.
 */
export class FakeGlobalTarget {
    private _handlers: Map<string, ((e: FakeEvent) => void)[]> = new Map();

    addEventListener(type: string, handler: (e: FakeEvent) => void): void {
        const list = this._handlers.get(type) ?? [];
        list.push(handler);
        this._handlers.set(type, list);
    }

    removeEventListener(type: string, handler: (e: FakeEvent) => void): void {
        const list = this._handlers.get(type);
        if (!list) return;
        this._handlers.set(
            type,
            list.filter((h) => h !== handler),
        );
    }

    dispatchEvent(event: FakeEvent): void {
        const handlers = this._handlers.get(event.type);
        if (handlers) {
            // Snapshot to guard against mutation during iteration
            const snapshot = handlers.slice();
            for (const h of snapshot) h(event);
        }
    }
}

// ---------------------------------------------------------------------------
// Document stub factory
// ---------------------------------------------------------------------------

/**
 * The shape returned by makeFakeDocument / makeFakeDocumentWithRoot.
 * It is a plain object (not a class instance) so it can be safely spread in tests.
 * The event registry is embedded via a shared FakeGlobalTarget held in closure.
 */
export type FakeDocument = {
    createElement(tag: string): FakeElement;
    getElementById(id: string): FakeElement | null;
    documentElement: { lang: string; dir: string };
    visibilityState: string;
    addEventListener(type: string, handler: (e: FakeEvent) => void): void;
    removeEventListener(type: string, handler: (e: FakeEvent) => void): void;
    dispatchEvent(event: FakeEvent): void;
};

/** Build a stub document that provides createElement returning a FakeElement. */
export function makeFakeDocument(): FakeDocument {
    // Plain-object shape so callers can safely spread it (class instances can't be spread).
    // The event registry is handled by an embedded FakeGlobalTarget.
    const registry = new FakeGlobalTarget();
    return {
        createElement(tag: string): FakeElement {
            return new FakeElement(tag);
        },
        // Callers needing getElementById should use `makeFakeDocumentWithRoot`.
        getElementById(_id: string): FakeElement | null {
            return null;
        },
        documentElement: { lang: "", dir: "" },
        visibilityState: "visible",
        addEventListener: registry.addEventListener.bind(registry),
        removeEventListener: registry.removeEventListener.bind(registry),
        dispatchEvent: registry.dispatchEvent.bind(registry),
    };
}

/**
 * Create a fake document that returns a pre-built FakeElement for getElementById(mountId).
 * Useful for start-app tests where we need #app to exist and be a FakeElement tree.
 */
export function makeFakeDocumentWithRoot(mountId: string, root: FakeElement): FakeDocument {
    const base = makeFakeDocument();
    return {
        ...base,
        getElementById(id: string): FakeElement | null {
            return id === mountId ? root : null;
        },
    };
}

/**
 * Register vi.stubGlobal for Event + CustomEvent + document + window.
 * window is a FakeGlobalTarget with a faithful addEventListener registry so
 * pagehide / visibilitychange handlers can be triggered via dispatchEvent.
 *
 * Call at test file top level (before any imports that trigger document.createElement).
 */
export function stubDomGlobals(): void {
    vi.stubGlobal("Event", FakeEvent);
    vi.stubGlobal("CustomEvent", FakeCustomEvent);
    vi.stubGlobal("document", makeFakeDocument());
    vi.stubGlobal("window", new FakeGlobalTarget());
}
