/**
 * PrefetchedIntents — SSR 数据缓存
 *
 * 服务端渲染时将 Intent→Data 映射序列化嵌入 HTML，
 * 客户端 hydrate 时提取缓存。Framework.dispatch() 优先查缓存，
 * 命中则直接返回，未命中则走 Controller 调度。
 */

import type { Intent } from "../intents/types";
import { stableStringify } from "./stable-stringify";

/** 预获取的 Intent-Data 对 */
export interface PrefetchedIntent {
    intent: Intent;
    data: unknown;
}

export class PrefetchedIntents {
    private intents: Map<string, unknown>;

    private constructor(intents: Map<string, unknown>) {
        this.intents = intents;
    }

    /** 从 PrefetchedIntent 数组创建缓存实例 */
    static fromArray(items: PrefetchedIntent[]): PrefetchedIntents {
        const map = new Map<string, unknown>();
        for (const item of items) {
            if (item.intent && item.data !== undefined) {
                const key = stableStringify(item.intent);
                map.set(key, item.data);
            }
        }
        return new PrefetchedIntents(map);
    }

    /** 创建空缓存实例 */
    static empty(): PrefetchedIntents {
        return new PrefetchedIntents(new Map());
    }

    /**
     * 获取缓存的 Intent 结果（一次性使用）。
     * 命中后从缓存中删除。
     */
    get<T>(intent: Intent<T>): T | undefined {
        const key = stableStringify(intent);
        const data = this.intents.get(key);
        if (data !== undefined) {
            this.intents.delete(key);
            return data as T;
        }
        return undefined;
    }

    /** 检查缓存中是否有某个 Intent 的数据 */
    has(intent: Intent): boolean {
        return this.intents.has(stableStringify(intent));
    }

    /** 缓存中的条目数 */
    get size(): number {
        return this.intents.size;
    }
}
