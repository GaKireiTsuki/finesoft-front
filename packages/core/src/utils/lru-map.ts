/**
 * LruMap — 固定容量的 LRU 缓存
 */

export class LruMap<K, V> {
    private map = new Map<K, V>();
    private readonly capacity: number;

    constructor(capacity: number) {
        if (capacity < 1) {
            throw new Error(`[LruMap] capacity must be >= 1, got ${capacity}`);
        }
        this.capacity = capacity;
    }

    get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            // 移到末尾（最近使用）
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): { key: K; value: V } | undefined {
        let evicted: { key: K; value: V } | undefined;

        if (this.map.has(key)) {
            this.map.delete(key);
        } else if (this.map.size >= this.capacity) {
            // 删除最旧的（第一个）
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined) {
                const oldestValue = this.map.get(oldest);
                this.map.delete(oldest);
                if (oldestValue !== undefined) {
                    evicted = {
                        key: oldest,
                        value: oldestValue,
                    };
                }
            }
        }
        this.map.set(key, value);
        return evicted;
    }

    has(key: K): boolean {
        return this.map.has(key);
    }

    delete(key: K): boolean {
        return this.map.delete(key);
    }

    get size(): number {
        return this.map.size;
    }

    clear(): void {
        this.map.clear();
    }

    keys(): IterableIterator<K> {
        return this.map.keys();
    }
}
