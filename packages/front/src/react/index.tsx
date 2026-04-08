import type { Action, BasePage } from "@finesoft/front";
import type { BrowserMountContext, BrowserUpdateAppProps } from "@finesoft/front/browser";
import {
    createContext,
    useContext,
    useEffect,
    useEffectEvent,
    useRef,
    useState,
    type ComponentType,
    type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { KeepAliveViewStore, type KeepAliveViewEntry } from "../keep-alive/shared";
export type { KeepAliveViewEntry } from "../keep-alive/shared";

interface PageKeepAliveContextValue {
    markCacheable: () => void;
}

interface ActivationBoundaryController {
    registerActivate(callback: () => void): () => void;
    registerDeactivate(callback: () => void): () => void;
    mount(initiallyActive: boolean): void;
    updateActive(nextActive: boolean): void;
    dispose(): void;
    markPageCacheable(): void;
}

export interface ReactKeepAliveAppProps<TPage extends BasePage = BasePage> {
    pages: readonly KeepAliveViewEntry<TPage>[];
    loading: boolean;
    currentPath: string;
    onAction?: (action: Action) => void;
    onCacheable?: (cacheKey: string, page: TPage) => void;
}

export interface KeepAlivePageViewProps<TPage extends BasePage = BasePage> {
    cacheKey: string;
    page: TPage;
    active: boolean;
    onCacheable?: (cacheKey: string, page: TPage) => void;
    children: ReactNode;
}

export interface ReactKeepAliveOutletProps<TProps extends object = Record<string, unknown>> {
    cacheKey: string;
    component: ComponentType<TProps>;
    componentProps: TProps;
}

const ActivationBoundaryContext = createContext<ActivationBoundaryController | null>(null);
const PageKeepAliveContext = createContext<PageKeepAliveContextValue | null>(null);

export const onActivate = useOnActivate;
export const onDeactivate = useOnDeactivate;

export function createReactKeepAliveMount<TPage extends BasePage>(
    App: ComponentType<ReactKeepAliveAppProps<TPage>>,
) {
    return (target: HTMLElement, { framework, keepAlive }: BrowserMountContext) => {
        let root: ReturnType<typeof createRoot> | null = null;
        const store = new KeepAliveViewStore<TPage>();

        const render = (snapshot = store.snapshot()) => {
            const handleAction = (action: Action) => {
                void framework.perform(action);
            };
            const handleCacheable = (cacheKey: string, page: TPage) => {
                keepAlive.markCacheable(cacheKey, page);
                render(store.markCacheable(cacheKey));
            };

            if (!root) {
                root = createRoot(target);
            }

            root.render(
                <App
                    pages={snapshot.entries}
                    loading={snapshot.loading}
                    currentPath={snapshot.currentPath}
                    onAction={handleAction}
                    onCacheable={handleCacheable}
                />,
            );
        };

        keepAlive.onEvent((event: { type: "evict"; key: string }) => {
            if (event.type === "evict") {
                render(store.evict(event.key));
            }
        });

        return ({ page, isFirstPage, cacheKey }: BrowserUpdateAppProps) => {
            if (page instanceof Promise) {
                if (!isFirstPage) {
                    render(store.setLoading(true));
                }

                void page.then((resolvedPage) => {
                    render(
                        store.commit(
                            resolveCacheKey(cacheKey, resolvedPage),
                            resolvedPage as TPage,
                        ),
                    );
                });
                return;
            }

            render(store.commit(resolveCacheKey(cacheKey, page), page as TPage));
        };
    };
}

export function KeepAlivePageView<TPage extends BasePage>({
    cacheKey,
    page,
    active,
    onCacheable,
    children,
}: KeepAlivePageViewProps<TPage>) {
    const markCacheable = useEffectEvent(() => {
        onCacheable?.(cacheKey, page);
    });

    return (
        <PageKeepAliveContext.Provider value={{ markCacheable }}>
            <ActivationBoundaryView active={active} markPageCacheable={markCacheable}>
                {children}
            </ActivationBoundaryView>
        </PageKeepAliveContext.Provider>
    );
}

export function KeepAliveOutlet<TProps extends object>({
    cacheKey,
    component: Component,
    componentProps,
}: ReactKeepAliveOutletProps<TProps>) {
    const pageContext = useContext(PageKeepAliveContext);
    const [entries, setEntries] = useState(() => [
        {
            key: cacheKey,
            component: Component,
            componentProps,
            active: true,
        },
    ]);

    useEffect(() => {
        setEntries((currentEntries) => {
            const nextEntries = currentEntries.map((entry) => ({
                ...entry,
                active: entry.key === cacheKey,
            }));
            const existingEntry = nextEntries.find((entry) => entry.key === cacheKey);

            if (existingEntry) {
                existingEntry.component = Component;
                existingEntry.componentProps = componentProps;
                return [...nextEntries];
            }

            nextEntries.push({
                key: cacheKey,
                component: Component,
                componentProps,
                active: true,
            });
            return nextEntries;
        });
    }, [cacheKey, Component, componentProps]);

    return (
        <>
            {entries.map((entry) => {
                const EntryComponent = entry.component;
                return (
                    <ActivationBoundaryView
                        key={entry.key}
                        active={entry.active}
                        markPageCacheable={pageContext?.markCacheable ?? noop}
                    >
                        <EntryComponent {...entry.componentProps} />
                    </ActivationBoundaryView>
                );
            })}
        </>
    );
}

function ActivationBoundaryView({
    active,
    markPageCacheable,
    children,
}: {
    active: boolean;
    markPageCacheable: () => void;
    children: ReactNode;
}) {
    const markPageCacheableRef = useRef(markPageCacheable);
    markPageCacheableRef.current = markPageCacheable;

    const controllerRef = useRef<ActivationBoundaryController | null>(null);
    if (!controllerRef.current) {
        controllerRef.current = createActivationBoundary(() => {
            markPageCacheableRef.current();
        });
    }

    const previousActiveRef = useRef(active);

    useEffect(() => {
        const controller = controllerRef.current!;
        controller.mount(active);
        previousActiveRef.current = active;

        return () => {
            controller.dispose();
        };
    }, []);

    useEffect(() => {
        if (previousActiveRef.current === active) {
            return;
        }

        previousActiveRef.current = active;
        controllerRef.current?.updateActive(active);
    }, [active]);

    return (
        <ActivationBoundaryContext.Provider value={controllerRef.current}>
            <div
                aria-hidden={!active}
                hidden={!active}
                style={{ display: active ? undefined : "none" }}
            >
                {children}
            </div>
        </ActivationBoundaryContext.Provider>
    );
}

function createActivationBoundary(markPageCacheable: () => void): ActivationBoundaryController {
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

function useOnActivate(callback: () => void): void {
    const controller = useContext(ActivationBoundaryContext);
    const runCallback = useEffectEvent(callback);

    useEffect(() => {
        if (!controller) {
            return;
        }

        controller.markPageCacheable();
        return controller.registerActivate(() => {
            runCallback();
        });
    }, [controller, runCallback]);
}

function useOnDeactivate(callback: () => void): void {
    const controller = useContext(ActivationBoundaryContext);
    const runCallback = useEffectEvent(callback);

    useEffect(() => {
        if (!controller) {
            return;
        }

        controller.markPageCacheable();
        return controller.registerDeactivate(() => {
            runCallback();
        });
    }, [controller, runCallback]);
}

function resolveCacheKey(cacheKey: string | undefined, page: BasePage): string {
    return cacheKey ?? page.url ?? page.id;
}

function noop(): void {}
