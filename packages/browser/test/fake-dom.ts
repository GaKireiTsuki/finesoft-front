/**
 * Minimal headless DOM stubs for browser package tests.
 *
 * The project has no jsdom / happy-dom. These classes replicate just enough of
 * the HTMLElement / CustomEvent / document surface that `navigation-islands.ts`
 * and `start-app.ts` (islands path) need.
 *
 * Usage:
 *   import { FakeElement, FakeCustomEvent, makeFakeDocument, stubDomGlobals } from "./fake-dom";
 *   // in test file top-level (before imports that need the globals):
 *   stubDomGlobals(); // registers vi.stubGlobal for CustomEvent + document
 */

import { vi } from "vite-plus/test";

// ---------------------------------------------------------------------------
// CustomEvent stub
// ---------------------------------------------------------------------------

export class FakeCustomEvent {
    readonly type: string;
    readonly bubbles: boolean;
    target: FakeElement | null = null;
    constructor(type: string, init?: { bubbles?: boolean }) {
        this.type = type;
        this.bubbles = init?.bubbles ?? false;
    }
}

// ---------------------------------------------------------------------------
// FakeElement
// ---------------------------------------------------------------------------

export class FakeElement {
    readonly tagName: string;
    private _attrs: Map<string, string> = new Map();
    private _children: FakeElement[] = [];
    private _parent: FakeElement | null = null;
    private _handlers: Map<string, ((e: FakeCustomEvent) => void)[]> = new Map();
    textContent = "";
    scrollTop = 0;
    scrollLeft = 0;

    constructor(tag: string) {
        this.tagName = tag.toUpperCase();
    }

    setAttribute(name: string, value: string): void {
        this._attrs.set(name, value);
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

    /** Returns the first element matching the selector, or null. */
    querySelector(selector: string): FakeElement | null {
        const results = this.querySelectorAll(selector);
        return results[0] ?? null;
    }

    /** Supports exact-attribute-match selectors: [attr] and [attr="value"]. */
    querySelectorAll(selector: string): FakeElement[] {
        const results: FakeElement[] = [];
        const queue: FakeElement[] = [...this._children];
        while (queue.length > 0) {
            const el = queue.pop()!;
            if (matchesSelector(el, selector)) results.unshift(el);
            queue.push(...el._children);
        }
        return results;
    }

    addEventListener(type: string, handler: (e: FakeCustomEvent) => void): void {
        const list = this._handlers.get(type) ?? [];
        list.push(handler);
        this._handlers.set(type, list);
    }

    /**
     * Dispatch an event on this element and bubble up the _parent chain.
     * Faithfully models { bubbles: true } — event.target is set to the
     * originating element (the container the orchestrator dispatches on).
     */
    dispatchEvent(event: FakeCustomEvent): void {
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

/** Match a single CSS selector token against a FakeElement (supports [attr] and [attr="val"]). */
function matchesSelector(el: FakeElement, selector: string): boolean {
    // handle comma-joined selectors by splitting and OR-ing
    for (const part of selector.split(",").map((s) => s.trim())) {
        if (matchesSingleSelector(el, part)) return true;
    }
    return false;
}

function matchesSingleSelector(el: FakeElement, selector: string): boolean {
    // strip tag prefix if present (e.g. "div[attr]")
    const attrRe = /\[([^\]=]+)(?:="([^"]*)")?\]/g;
    let match: RegExpExecArray | null;
    let matched = true;
    while ((match = attrRe.exec(selector)) !== null) {
        const [, name, value] = match;
        if (value === undefined) {
            if (!el.hasAttribute(name!)) {
                matched = false;
                break;
            }
        } else {
            if (el.getAttribute(name!) !== value) {
                matched = false;
                break;
            }
        }
    }
    return matched;
}

// ---------------------------------------------------------------------------
// Document stub factory
// ---------------------------------------------------------------------------

/** Build a stub document that provides createElement returning a FakeElement. */
export function makeFakeDocument(): {
    createElement(tag: string): FakeElement;
    getElementById(id: string): FakeElement | null;
    documentElement: { lang: string; dir: string };
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
} {
    const registry = new Map<string, FakeElement>();
    return {
        createElement(tag: string): FakeElement {
            return new FakeElement(tag);
        },
        getElementById(id: string): FakeElement | null {
            return registry.get(id) ?? null;
        },
        documentElement: { lang: "", dir: "" },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        /** Register an element so getElementById can find it. */
        // Note: tests that need getElementById to return a specific FakeElement
        // should use stubDocumentElement below instead.
    } as ReturnType<typeof makeFakeDocument>;
}

/**
 * Create a fake document that returns a pre-built FakeElement for getElementById(mountId).
 * Useful for start-app tests where we need #app to exist and be a FakeElement tree.
 */
export function makeFakeDocumentWithRoot(
    mountId: string,
    root: FakeElement,
): ReturnType<typeof makeFakeDocument> {
    const base = makeFakeDocument();
    return {
        ...base,
        getElementById(id: string): FakeElement | null {
            return id === mountId ? root : null;
        },
    };
}

/**
 * Register vi.stubGlobal for CustomEvent + document (basic, createElement-only).
 * Call at test file top level (before any imports that trigger document.createElement).
 */
export function stubDomGlobals(): void {
    vi.stubGlobal("CustomEvent", FakeCustomEvent);
    vi.stubGlobal("document", makeFakeDocument());
}
