import type { Action, BasePage } from "@finesoft/front";
import type { BrowserMountContext, BrowserUpdateAppProps } from "@finesoft/front/browser";
import {
    createApp,
    defineComponent,
    h,
    inject,
    markRaw,
    onBeforeUnmount,
    onMounted,
    provide,
    ref,
    shallowReactive,
    watch,
    type PropType,
    type VNode,
} from "vue";
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

export interface VueKeepAliveAppProps<TPage extends BasePage = BasePage> {
    pages: readonly KeepAliveViewEntry<TPage>[];
    loading: boolean;
    currentPath: string;
    onAction?: (action: Action) => void;
    onCacheable?: (cacheKey: string, page: TPage) => void;
}

const ActivationBoundaryKey = Symbol("finesoft-vue-activation-boundary");
const PageKeepAliveKey = Symbol("finesoft-vue-page-keep-alive");

const ActivationBoundaryView = defineComponent({
    name: "FinesoftActivationBoundaryView",
    props: {
        active: {
            type: Boolean,
            required: true,
        },
        markPageCacheable: {
            type: Function as PropType<() => void>,
            required: true,
        },
    },
    setup(props, { slots }) {
        const controller = createActivationBoundary(() => {
            props.markPageCacheable();
        });

        provide(ActivationBoundaryKey, controller);

        onMounted(() => {
            controller.mount(props.active);
        });

        watch(
            () => props.active,
            (active, previousActive) => {
                if (active === previousActive) {
                    return;
                }

                controller.updateActive(active);
            },
        );

        onBeforeUnmount(() => {
            controller.dispose();
        });

        return () =>
            h(
                "div",
                {
                    hidden: !props.active,
                    "aria-hidden": !props.active,
                    style: props.active ? undefined : { display: "none" },
                },
                slots.default?.(),
            );
    },
});

export const KeepAlivePageView = defineComponent({
    name: "FinesoftKeepAlivePageView",
    props: {
        cacheKey: {
            type: String,
            required: true,
        },
        page: {
            type: Object as PropType<BasePage>,
            required: true,
        },
        active: {
            type: Boolean,
            required: true,
        },
        onCacheable: {
            type: Function as PropType<(cacheKey: string, page: BasePage) => void>,
            required: false,
        },
    },
    setup(props, { slots }) {
        const markCacheable = () => {
            props.onCacheable?.(props.cacheKey, props.page);
        };

        provide<PageKeepAliveContextValue>(PageKeepAliveKey, {
            markCacheable,
        });

        return () =>
            h(
                ActivationBoundaryView,
                {
                    active: props.active,
                    markPageCacheable: markCacheable,
                },
                slots,
            );
    },
});

export const KeepAliveOutlet = defineComponent({
    name: "FinesoftKeepAliveOutlet",
    props: {
        cacheKey: {
            type: String,
            required: true,
        },
        component: {
            type: Object as PropType<object>,
            required: true,
        },
        componentProps: {
            type: Object as PropType<Record<string, unknown>>,
            required: true,
        },
    },
    setup(props) {
        const pageContext = inject<PageKeepAliveContextValue | null>(PageKeepAliveKey, null);
        const entries = ref([
            {
                key: props.cacheKey,
                component: markRaw(props.component),
                componentProps: props.componentProps,
                active: true,
            },
        ]);

        watch(
            () => [props.cacheKey, props.component, props.componentProps] as const,
            () => {
                const nextEntries = entries.value.map((entry) => ({
                    ...entry,
                    active: entry.key === props.cacheKey,
                }));
                const existingEntry = nextEntries.find((entry) => entry.key === props.cacheKey);

                if (existingEntry) {
                    existingEntry.component = markRaw(props.component);
                    existingEntry.componentProps = props.componentProps;
                } else {
                    nextEntries.push({
                        key: props.cacheKey,
                        component: markRaw(props.component),
                        componentProps: props.componentProps,
                        active: true,
                    });
                }

                entries.value = nextEntries;
            },
            {
                deep: false,
            },
        );

        return (): VNode[] =>
            entries.value.map((entry) =>
                h(
                    ActivationBoundaryView,
                    {
                        key: entry.key,
                        active: entry.active,
                        markPageCacheable: pageContext?.markCacheable ?? noop,
                    },
                    {
                        default: () => [
                            h(
                                entry.component as never,
                                entry.componentProps as Record<string, unknown>,
                            ),
                        ],
                    },
                ),
            );
    },
});

export function createVueKeepAliveMount<TPage extends BasePage>(App: object) {
    return (target: HTMLElement, { framework, keepAlive }: BrowserMountContext) => {
        const state = shallowReactive({
            pages: [] as KeepAliveViewEntry<TPage>[],
            loading: false,
            currentPath: "/",
        });
        const handleAction = (action: Action) => {
            void framework.perform(action);
        };
        const handleCacheable = (cacheKey: string, page: TPage) => {
            keepAlive.markCacheable(cacheKey, page);
            syncSnapshot(store.markCacheable(cacheKey));
        };
        const store = new KeepAliveViewStore<TPage>();

        const syncSnapshot = (snapshot = store.snapshot()) => {
            state.pages = snapshot.entries;
            state.loading = snapshot.loading;
            state.currentPath = snapshot.currentPath;
        };

        createApp(App, {
            state,
            onAction: handleAction,
            onCacheable: handleCacheable,
        }).mount(target);

        keepAlive.onEvent((event: { type: "evict"; key: string }) => {
            if (event.type === "evict") {
                syncSnapshot(store.evict(event.key));
            }
        });

        return ({ page, isFirstPage, cacheKey }: BrowserUpdateAppProps) => {
            if (page instanceof Promise) {
                if (!isFirstPage) {
                    syncSnapshot(store.setLoading(true));
                }

                void page.then((resolvedPage) => {
                    syncSnapshot(
                        store.commit(
                            resolveCacheKey(cacheKey, resolvedPage),
                            resolvedPage as TPage,
                        ),
                    );
                });
                return;
            }

            syncSnapshot(store.commit(resolveCacheKey(cacheKey, page), page as TPage));
        };
    };
}

export function onActivate(callback: () => void): void {
    registerLifecycleCallback("activate", callback);
}

export function onDeactivate(callback: () => void): void {
    registerLifecycleCallback("deactivate", callback);
}

function registerLifecycleCallback(type: "activate" | "deactivate", callback: () => void): void {
    const controller = inject<ActivationBoundaryController | null>(ActivationBoundaryKey, null);

    if (!controller) {
        return;
    }

    let unregister: (() => void) | undefined;

    onMounted(() => {
        controller.markPageCacheable();
        unregister =
            type === "activate"
                ? controller.registerActivate(callback)
                : controller.registerDeactivate(callback);
    });

    onBeforeUnmount(() => {
        unregister?.();
    });
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

function resolveCacheKey(cacheKey: string | undefined, page: BasePage): string {
    return cacheKey ?? page.url ?? page.id;
}

function noop(): void {}
