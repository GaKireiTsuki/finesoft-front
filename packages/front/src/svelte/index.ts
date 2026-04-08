import type { Action, BasePage, Framework } from "@finesoft/front";
import type { BrowserMountContext, BrowserUpdateAppProps } from "@finesoft/front/browser";
import { hydrate, type Component } from "svelte";
import { KeepAliveViewStore, type KeepAliveViewEntry } from "../keep-alive/shared";
export type { KeepAliveViewEntry } from "../keep-alive/shared";

export { default as KeepAliveOutlet } from "./KeepAliveOutlet.svelte";
export { default as KeepAlivePageView } from "./KeepAlivePageView.svelte";
export { onActivate, onDeactivate } from "./context";

export interface SvelteKeepAliveNavigationState<TPage extends BasePage = BasePage> {
    pages: readonly KeepAliveViewEntry<TPage>[];
    loading: boolean;
    currentPath: string;
    onAction?: (action: Action) => void;
    onCacheable?: (cacheKey: string, page: TPage) => void;
}

export function createSvelteKeepAliveMount<TPage extends BasePage>(
    App: Component<{ framework?: Framework }>,
) {
    return (target: HTMLElement, { framework, keepAlive }: BrowserMountContext) => {
        const store = new KeepAliveViewStore<TPage>();
        const app = hydrate(App, {
            target,
            props: {
                framework,
            },
        }) as {
            updateNavigation: (state: SvelteKeepAliveNavigationState<TPage>) => void;
        };

        const syncSnapshot = (snapshot = store.snapshot()) => {
            app.updateNavigation({
                pages: snapshot.entries,
                loading: snapshot.loading,
                currentPath: snapshot.currentPath,
                onAction(action: Action) {
                    void framework.perform(action);
                },
                onCacheable(cacheKey: string, page: TPage) {
                    keepAlive.markCacheable(cacheKey, page);
                    syncSnapshot(store.markCacheable(cacheKey));
                },
            });
        };

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

function resolveCacheKey(cacheKey: string | undefined, page: BasePage): string {
    return cacheKey ?? page.url ?? page.id;
}
