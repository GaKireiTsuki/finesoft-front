import { getContext, onMount, setContext } from "svelte";

export interface PageKeepAliveContextValue {
    markCacheable: () => void;
}

export interface ActivationBoundaryController {
    registerActivate(callback: () => void): () => void;
    registerDeactivate(callback: () => void): () => void;
    mount(initiallyActive: boolean): void;
    updateActive(nextActive: boolean): void;
    dispose(): void;
    markPageCacheable(): void;
}

const ACTIVATION_BOUNDARY_KEY = Symbol("finesoft-svelte-activation-boundary");
const PAGE_KEEP_ALIVE_KEY = Symbol("finesoft-svelte-page-keep-alive");

export function setActivationBoundaryContext(controller: ActivationBoundaryController): void {
    setContext(ACTIVATION_BOUNDARY_KEY, controller);
}

export function getActivationBoundaryContext(): ActivationBoundaryController | undefined {
    return getContext<ActivationBoundaryController | undefined>(ACTIVATION_BOUNDARY_KEY);
}

export function setPageKeepAliveContext(value: PageKeepAliveContextValue): void {
    setContext(PAGE_KEEP_ALIVE_KEY, value);
}

export function getPageKeepAliveContext(): PageKeepAliveContextValue | undefined {
    return getContext<PageKeepAliveContextValue | undefined>(PAGE_KEEP_ALIVE_KEY);
}

export function onActivate(callback: () => void): void {
    registerLifecycle("activate", callback);
}

export function onDeactivate(callback: () => void): void {
    registerLifecycle("deactivate", callback);
}

export function createActivationBoundary(
    markPageCacheable: () => void,
): ActivationBoundaryController {
    const activateCallbacks = new Set<() => void>();
    const deactivateCallbacks = new Set<() => void>();
    let active = false;
    let mounted = false;

    return {
        registerActivate(callback) {
            activateCallbacks.add(callback);
            if (mounted && active) {
                callback();
            }

            return () => {
                activateCallbacks.delete(callback);
            };
        },
        registerDeactivate(callback) {
            deactivateCallbacks.add(callback);
            return () => {
                deactivateCallbacks.delete(callback);
            };
        },
        mount(initiallyActive) {
            active = initiallyActive;
            mounted = true;

            if (active) {
                for (const callback of activateCallbacks) {
                    callback();
                }
            }
        },
        updateActive(nextActive) {
            if (!mounted || nextActive === active) {
                active = nextActive;
                return;
            }

            active = nextActive;
            const callbacks = active ? activateCallbacks : deactivateCallbacks;
            for (const callback of callbacks) {
                callback();
            }
        },
        dispose() {
            for (const callback of deactivateCallbacks) {
                callback();
            }

            mounted = false;
            activateCallbacks.clear();
            deactivateCallbacks.clear();
        },
        markPageCacheable() {
            markPageCacheable();
        },
    };
}

function registerLifecycle(type: "activate" | "deactivate", callback: () => void): void {
    const controller = getActivationBoundaryContext();

    onMount(() => {
        if (!controller) {
            return undefined;
        }

        controller.markPageCacheable();
        return type === "activate"
            ? controller.registerActivate(callback)
            : controller.registerDeactivate(callback);
    });
}
