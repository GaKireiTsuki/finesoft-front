import type { BasePage } from "@finesoft/front";

export interface KeepAliveViewEntry<TPage extends BasePage = BasePage> {
    key: string;
    page: TPage;
    active: boolean;
    cacheable: boolean;
}

export interface KeepAliveViewSnapshot<TPage extends BasePage = BasePage> {
    entries: KeepAliveViewEntry<TPage>[];
    loading: boolean;
    currentPath: string;
}

export class KeepAliveViewStore<TPage extends BasePage = BasePage> {
    private entries: KeepAliveViewEntry<TPage>[] = [];
    private readonly pendingCacheableKeys = new Set<string>();
    private loading = false;
    private currentPath = "/";

    commit(key: string, page: TPage): KeepAliveViewSnapshot<TPage> {
        const nextEntries: KeepAliveViewEntry<TPage>[] = [];
        let found = false;

        for (const entry of this.entries) {
            if (entry.key === key) {
                nextEntries.push({
                    ...entry,
                    page,
                    active: true,
                });
                found = true;
                continue;
            }

            if (entry.cacheable) {
                nextEntries.push({
                    ...entry,
                    active: false,
                });
            }
        }

        if (!found) {
            nextEntries.push({
                key,
                page,
                active: true,
                cacheable: this.pendingCacheableKeys.has(key),
            });
        }

        this.entries = nextEntries;
        this.loading = false;
        this.currentPath = page.url ?? this.currentPath;

        return this.snapshot();
    }

    setLoading(loading: boolean): KeepAliveViewSnapshot<TPage> {
        this.loading = loading;
        return this.snapshot();
    }

    markCacheable(key: string): KeepAliveViewSnapshot<TPage> {
        this.pendingCacheableKeys.add(key);
        this.entries = this.entries.map((entry) =>
            entry.key === key
                ? {
                      ...entry,
                      cacheable: true,
                  }
                : entry,
        );
        return this.snapshot();
    }

    evict(key: string): KeepAliveViewSnapshot<TPage> {
        this.pendingCacheableKeys.delete(key);
        this.entries = this.entries.flatMap((entry) => {
            if (entry.key !== key) {
                return [entry];
            }

            if (entry.active) {
                return [
                    {
                        ...entry,
                        cacheable: false,
                    },
                ];
            }

            return [];
        });
        return this.snapshot();
    }

    snapshot(): KeepAliveViewSnapshot<TPage> {
        return {
            entries: [...this.entries],
            loading: this.loading,
            currentPath: this.currentPath,
        };
    }
}
