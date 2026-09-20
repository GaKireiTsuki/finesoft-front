/**
 * PrefetchedIntents — SSR 数据缓存
 *
 * 服务端渲染时将 Intent→Data 映射序列化嵌入 HTML，
 * 客户端 hydrate 时提取缓存。页面 handler 在策略通过后读取缓存，
 * 命中则直接返回，未命中则走 Controller 调度。
 */

import type { RouteIntent as Intent } from "../router/types";
import { stableStringify } from "@finesoft/core";

/** 预获取的 Intent-Data 对 */
export interface PrefetchedIntent {
    entryId?: string;
    intent: Intent;
    data: unknown;
}

export class PrefetchedIntents {
    private intents: Map<string, unknown>;

    private constructor(
        intents: Map<string, unknown>,
        private readonly entryIds = new Map<string, string[]>(),
    ) {
        this.intents = intents;
    }

    /** 从 PrefetchedIntent 数组创建缓存实例 */
    static fromArray(items: PrefetchedIntent[]): PrefetchedIntents {
        const map = new Map<string, unknown>();
        const entries = new Map<string, string[]>();
        for (const item of items) {
            if (item.entryId && item.intent && item.data !== undefined) {
                const key = stableStringify([item.entryId, item.intent]);
                map.set(key, item.data);
                if (item.entryId) {
                    const intentKey = stableStringify(item.intent);
                    entries.set(intentKey, [...(entries.get(intentKey) ?? []), item.entryId]);
                }
            }
        }
        return new PrefetchedIntents(map, entries);
    }

    /** 创建空缓存实例 */
    static empty(): PrefetchedIntents {
        return new PrefetchedIntents(new Map());
    }

    /**
     * 获取缓存的 Intent 结果（一次性使用）。
     * 命中后从缓存中删除。
     */
    get<T>(intent: Intent<T>, entryId?: string): T | undefined {
        if (!entryId) return undefined;
        const key = stableStringify([entryId, intent]);
        const data = this.intents.get(key);
        if (data !== undefined) {
            this.intents.delete(key);
            return data as T;
        }
        return undefined;
    }

    /** @internal Navigation-owned staged reads; direct get remains one-shot. */
    stage(): { cache: PrefetchedIntents; commit(): void } {
        const original = new Map(this.intents);
        const cache = new PrefetchedIntents(new Map(original), this.entryIds);
        return {
            cache,
            commit: () => {
                for (const [key, value] of original) {
                    if (!cache.intents.has(key) && this.intents.get(key) === value)
                        this.intents.delete(key);
                }
            },
        };
    }

    /** Read identity metadata without consuming data or bypassing operation policies. */
    entryIdFor(intent: Intent): string | undefined {
        const ids = (this.entryIds.get(stableStringify(intent)) ?? []).filter((entryId) =>
            this.has(intent, entryId),
        );
        return ids.length === 1 ? ids[0] : undefined;
    }

    /** 检查缓存中是否有某个 Intent 的数据 */
    has(intent: Intent, entryId?: string): boolean {
        return !!entryId && this.intents.has(stableStringify([entryId, intent]));
    }

    /** 缓存中的条目数 */
    get size(): number {
        return this.intents.size;
    }
}
