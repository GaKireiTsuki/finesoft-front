/** Native-root DOM state capture and caller-owned post-commit restoration. */

import type { NavigationScopedState } from "@finesoft/web";

interface DomState {
    readonly fields?: Record<string, string | boolean>;
    readonly details?: Record<string, boolean>;
    readonly scroll?: Record<string, { top: number; left: number }>;
}

export interface DomRestoreOptions {
    /** Session scope; state is stored in `scope[entryKey].__dom`. */
    readonly scope: NavigationScopedState;
    /** Optional scheduling for independent callers. Browser commits pass `cb => cb()` explicitly. */
    readonly schedule?: (cb: () => void) => void;
}

export interface DomRestore {
    /** Capture one real native entry before its next commit. */
    captureEntry(container: HTMLElement): void;
    /** Restore one acknowledged native entry after its commit. */
    restoreEntry(container: HTMLElement): void;
    /** Listen only for scoped edits and document persistence events. */
    attach(outlet: HTMLElement): void;
    dispose(): void;
}

function entryOwns(entry: HTMLElement, element: Element, appRoot?: HTMLElement): boolean {
    if (element.closest<HTMLElement>("[data-fs-entry]") !== entry) return false;
    return (
        !appRoot?.hasAttribute("data-fs-app") ||
        element.closest<HTMLElement>("[data-fs-app]") === appRoot
    );
}

function restoreRoots(entry: HTMLElement, appRoot?: HTMLElement): HTMLElement[] {
    const candidates: HTMLElement[] = [];
    if (entry.hasAttribute("data-restore-root") && entryOwns(entry, entry, appRoot))
        candidates.push(entry);
    for (const root of entry.querySelectorAll<HTMLElement>("[data-restore-root]")) {
        if (entryOwns(entry, root, appRoot)) candidates.push(root);
    }
    return candidates;
}

function fieldKey(element: Element): string | undefined {
    const restoreKey = element.getAttribute("data-restore-key");
    if (restoreKey) return restoreKey;
    const name = (element as HTMLInputElement).name;
    return name || undefined;
}

function entryKey(entry: HTMLElement): string | undefined {
    return entry.getAttribute("data-fs-key") ?? undefined;
}

function keyedElements<T extends Element>(
    root: HTMLElement,
    entry: HTMLElement,
    appRoot: HTMLElement | undefined,
    selector: string,
    key: (element: T) => string | undefined,
): Map<string, T> {
    const result = new Map<string, T>();
    for (const element of root.querySelectorAll<T>(selector)) {
        if (!entryOwns(entry, element, appRoot)) continue;
        const value = key(element);
        if (value && !result.has(value)) result.set(value, element);
    }
    return result;
}

export function createDomRestore(options: DomRestoreOptions): DomRestore {
    const { scope } = options;
    const schedule = options.schedule ?? ((callback: () => void) => callback());
    let disposed = false;
    let boundOutlet: HTMLElement | undefined;

    function collect(entry: HTMLElement): DomState {
        const fields: Record<string, string | boolean> = Object.create(null);
        const details: Record<string, boolean> = Object.create(null);
        const scroll: Record<string, { top: number; left: number }> = Object.create(null);
        for (const root of restoreRoots(entry, boundOutlet)) {
            for (const element of root.querySelectorAll<HTMLInputElement>(
                "input, textarea, select",
            )) {
                if (!entryOwns(entry, element, boundOutlet)) continue;
                if (element.type === "password" || element.hasAttribute("data-restore-ignore"))
                    continue;
                const key = fieldKey(element);
                if (!key) continue;
                fields[key] =
                    element.type === "checkbox" || element.type === "radio"
                        ? element.checked
                        : element.value;
            }
            for (const element of root.querySelectorAll<HTMLDetailsElement>("details")) {
                if (!entryOwns(entry, element, boundOutlet)) continue;
                const key = element.getAttribute("data-restore-key");
                if (key) details[key] = element.open;
            }
            for (const element of root.querySelectorAll<HTMLElement>("[data-restore-scroll]")) {
                if (!entryOwns(entry, element, boundOutlet)) continue;
                const key =
                    element.getAttribute("data-restore-key") ??
                    element.getAttribute("data-restore-scroll");
                if (key) scroll[key] = { top: element.scrollTop, left: element.scrollLeft };
            }
        }
        return { fields, details, scroll };
    }

    function captureEntry(entry: HTMLElement): void {
        if (!belongsToBoundApp(entry)) return;
        const key = entryKey(entry);
        if (!key) return;
        const bag = (scope.get(key) as Record<string, unknown> | undefined) ?? {};
        scope.set(key, { ...bag, __dom: collect(entry) });
    }

    function apply(entry: HTMLElement, dom: DomState): void {
        for (const root of restoreRoots(entry, boundOutlet)) {
            const fields = keyedElements<HTMLInputElement>(
                root,
                entry,
                boundOutlet,
                "input, textarea, select",
                fieldKey,
            );
            for (const [key, value] of Object.entries(dom.fields ?? {})) {
                const element = fields.get(key);
                if (
                    !element ||
                    element.type === "password" ||
                    element.hasAttribute("data-restore-ignore")
                )
                    continue;
                if (typeof value === "boolean") {
                    element.checked = value;
                } else {
                    const descriptor = Object.getOwnPropertyDescriptor(
                        Object.getPrototypeOf(element),
                        "value",
                    );
                    if (descriptor?.set) descriptor.set.call(element, value);
                    else element.value = value;
                }
                element.dispatchEvent(new Event("input", { bubbles: true }));
                element.dispatchEvent(new Event("change", { bubbles: true }));
            }
            const details = keyedElements<HTMLDetailsElement>(
                root,
                entry,
                boundOutlet,
                "details",
                (element) => element.getAttribute("data-restore-key") ?? undefined,
            );
            for (const [key, open] of Object.entries(dom.details ?? {})) {
                const element = details.get(key);
                if (element) element.open = open;
            }
            const scroll = keyedElements<HTMLElement>(
                root,
                entry,
                boundOutlet,
                "[data-restore-scroll]",
                (element) =>
                    element.getAttribute("data-restore-key") ??
                    element.getAttribute("data-restore-scroll") ??
                    undefined,
            );
            for (const [key, position] of Object.entries(dom.scroll ?? {})) {
                const element = scroll.get(key);
                if (!element) continue;
                element.scrollTop = position.top;
                element.scrollLeft = position.left;
            }
        }
    }

    function restoreEntry(entry: HTMLElement): void {
        if (!belongsToBoundApp(entry)) return;
        const key = entryKey(entry);
        const dom = key ? (scope.get(key) as { __dom?: DomState } | undefined)?.__dom : undefined;
        if (!dom) return;
        schedule(() => {
            if (!disposed) apply(entry, dom);
        });
    }

    function belongsToBoundApp(entry: HTMLElement): boolean {
        return (
            !boundOutlet?.hasAttribute("data-fs-app") ||
            entry.closest<HTMLElement>("[data-fs-app]") === boundOutlet
        );
    }

    function ownsEntry(entry: HTMLElement): boolean {
        if (!boundOutlet || (entry !== boundOutlet && entry.parentElement !== boundOutlet))
            return false;
        return belongsToBoundApp(entry);
    }

    function entryFrom(target: EventTarget | null): HTMLElement | undefined {
        const entry = (target as HTMLElement | null)?.closest<HTMLElement>("[data-fs-entry]");
        return entry && ownsEntry(entry) ? entry : undefined;
    }

    const onEdit = (event: Event): void => {
        const entry = entryFrom(event.target);
        if (entry) captureEntry(entry);
    };
    const flushEntries = (): void => {
        if (!boundOutlet) return;
        if (boundOutlet.hasAttribute("data-fs-entry")) captureEntry(boundOutlet);
        for (const child of Array.from(boundOutlet.children)) {
            if (child.hasAttribute("data-fs-entry") && ownsEntry(child as HTMLElement))
                captureEntry(child as HTMLElement);
        }
    };
    const onVisibility = (): void => {
        if (document.visibilityState === "hidden") flushEntries();
    };

    function attach(outlet: HTMLElement): void {
        disposed = false;
        boundOutlet = outlet;
        outlet.addEventListener("input", onEdit, true);
        outlet.addEventListener("change", onEdit, true);
        window.addEventListener("pagehide", flushEntries);
        document.addEventListener("visibilitychange", onVisibility);
    }

    function dispose(): void {
        disposed = true;
        if (!boundOutlet) return;
        boundOutlet.removeEventListener("input", onEdit, true);
        boundOutlet.removeEventListener("change", onEdit, true);
        window.removeEventListener("pagehide", flushEntries);
        document.removeEventListener("visibilitychange", onVisibility);
        boundOutlet = undefined;
    }

    return { captureEntry, restoreEntry, attach, dispose };
}
