import type { BasePage } from "@finesoft/core";
import { LruMap } from "@finesoft/core";

const DEFAULT_KEEP_ALIVE_MAX_ENTRIES = 10;

export interface KeepAliveOptions {
    maxEntries?: number;
}

export interface KeepAliveEntry<TPage extends BasePage = BasePage> {
    key: string;
    page: TPage;
    aliases: readonly string[];
}

export interface KeepAliveMatch<TPage extends BasePage = BasePage> {
    key: string;
    entry: KeepAliveEntry<TPage>;
}

export interface KeepAliveEvictEvent<TPage extends BasePage = BasePage> {
    type: "evict";
    key: string;
    entry: KeepAliveEntry<TPage>;
}

export type KeepAliveEvent<TPage extends BasePage = BasePage> = KeepAliveEvictEvent<TPage>;

type KeepAliveListener<TPage extends BasePage = BasePage> = (event: KeepAliveEvent<TPage>) => void;

export class KeepAliveController<TPage extends BasePage = BasePage> {
    private readonly entries: LruMap<string, KeepAliveEntry<TPage>>;
    private readonly aliasToKey = new Map<string, string>();
    private readonly cacheableKeys = new Set<string>();
    private readonly listeners = new Set<KeepAliveListener<TPage>>();

    constructor(options: KeepAliveOptions = {}) {
        this.entries = new LruMap(options.maxEntries ?? DEFAULT_KEEP_ALIVE_MAX_ENTRIES);
    }

    resolve(key: string): KeepAliveMatch<TPage> | undefined {
        const resolvedKey = this.resolveKey(key);
        if (!resolvedKey) {
            return undefined;
        }

        const entry = this.entries.get(resolvedKey);
        if (!entry) {
            return undefined;
        }

        return {
            key: resolvedKey,
            entry,
        };
    }

    remember(key: string, page: TPage, aliases: string[] = []): KeepAliveEntry<TPage> | undefined {
        const resolvedKey = this.aliasToKey.get(key) ?? key;
        if (!this.cacheableKeys.has(resolvedKey) && !this.entries.has(resolvedKey)) {
            return undefined;
        }

        const entry: KeepAliveEntry<TPage> = {
            key: resolvedKey,
            page,
            aliases: uniqueStrings([resolvedKey, ...aliases]),
        };

        const evicted = this.entries.set(resolvedKey, entry);
        this.bindAliases(entry.key, entry.aliases);

        if (evicted && evicted.key !== entry.key) {
            this.disposeEntry(evicted.key, evicted.value);
        }

        return entry;
    }

    markCacheable(key: string, page?: TPage, aliases: string[] = []): void {
        const resolvedKey = this.aliasToKey.get(key) ?? key;
        this.cacheableKeys.add(resolvedKey);
        this.bindAliases(resolvedKey, uniqueStrings([resolvedKey, ...aliases]));

        if (page) {
            this.remember(resolvedKey, page, aliases);
        }
    }

    isCacheable(key: string): boolean {
        const resolvedKey = this.resolveKey(key) ?? key;
        return this.cacheableKeys.has(resolvedKey);
    }

    evict(key: string): boolean {
        const resolvedKey = this.resolveKey(key);
        if (!resolvedKey) {
            return false;
        }

        const entry = this.entries.get(resolvedKey);
        this.entries.delete(resolvedKey);
        this.cacheableKeys.delete(resolvedKey);
        this.unbindAliases(resolvedKey);

        if (entry) {
            this.emit({
                type: "evict",
                key: resolvedKey,
                entry,
            });
        }

        return entry !== undefined;
    }

    evictAll(): void {
        const keys = [...this.entries.keys()];
        for (const key of keys) {
            this.evict(key);
        }
    }

    onEvent(listener: KeepAliveListener<TPage>): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private resolveKey(key: string): string | undefined {
        const resolvedKey = this.aliasToKey.get(key) ?? key;
        return this.entries.has(resolvedKey) || this.cacheableKeys.has(resolvedKey)
            ? resolvedKey
            : undefined;
    }

    private bindAliases(key: string, aliases: readonly string[]): void {
        for (const alias of aliases) {
            this.aliasToKey.set(alias, key);
        }
    }

    private unbindAliases(key: string): void {
        for (const [alias, aliasKey] of this.aliasToKey.entries()) {
            if (aliasKey === key) {
                this.aliasToKey.delete(alias);
            }
        }
    }

    private disposeEntry(key: string, entry: KeepAliveEntry<TPage>): void {
        this.cacheableKeys.delete(key);
        this.unbindAliases(key);
        this.emit({
            type: "evict",
            key,
            entry,
        });
    }

    private emit(event: KeepAliveEvent<TPage>): void {
        for (const listener of this.listeners) {
            listener(event);
        }
    }
}

export function toKeepAliveCacheKey(url: string): string {
    try {
        const parsed = new URL(url, "http://localhost");
        return parsed.pathname + parsed.search;
    } catch {
        return url.split("#")[0];
    }
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}
