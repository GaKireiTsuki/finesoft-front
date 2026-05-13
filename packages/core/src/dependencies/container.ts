/**
 * Container — 通用的依赖注入容器
 */

type Factory<T> = () => T;

interface Registration<T> {
    factory: Factory<T>;
    singleton: boolean;
    instance?: T;
}

export class Container {
    private registrations = new Map<string, Registration<unknown>>();
    private resolutionStack = new Set<string>();
    private parent?: Container;
    private children = new Set<Container>();

    /** 注册依赖（默认单例） */
    register<T>(key: string, factory: Factory<T>, singleton = true): this {
        this.registrations.set(key, { factory, singleton });
        return this;
    }

    /** 解析依赖 — 当前容器未注册时回退到 parent */
    resolve<T>(key: string): T {
        const reg = this.registrations.get(key);
        if (!reg) {
            if (this.parent) {
                return this.parent.resolve<T>(key);
            }
            throw new Error(`[Container] No registration for key: "${key}"`);
        }

        if (reg.singleton) {
            if (reg.instance === undefined) {
                if (this.resolutionStack.has(key)) {
                    throw new Error(
                        `[Container] Circular dependency detected: ${[
                            ...this.resolutionStack,
                            key,
                        ].join(" → ")}`,
                    );
                }
                this.resolutionStack.add(key);
                try {
                    reg.instance = reg.factory();
                } finally {
                    this.resolutionStack.delete(key);
                }
            }
            return reg.instance as T;
        }
        return reg.factory() as T;
    }

    /** 检查是否已注册（含 parent） */
    has(key: string): boolean {
        return this.registrations.has(key) || (this.parent?.has(key) ?? false);
    }

    /**
     * 创建子容器（请求级 scope）
     *
     * 子容器可覆写父容器的依赖（如每请求的 locale、user），
     * 未覆写的 key 自动回退到父容器解析。子容器会被父容器跟踪，
     * 父容器 dispose 时一并销毁所有未独立 dispose 的子容器。
     */
    createScope(): Container {
        const child = new Container();
        child.parent = this;
        this.children.add(child);
        return child;
    }

    /**
     * 销毁容器，清除所有缓存。
     *
     * - 递归 dispose 所有 createScope() 创建的未 dispose 子容器
     * - 自身被 dispose 后从父容器移除引用，允许 GC
     * - 重复 dispose 安全（幂等）
     */
    dispose(): void {
        // 先递归销毁子容器。child.dispose 会从 this.children 移除自身，
        // 所以必须先快照拷贝再迭代，否则会破坏 Set 迭代器。
        const childSnapshot = Array.from(this.children);
        for (const child of childSnapshot) {
            child.dispose();
        }
        this.children.clear();

        // 清空自身注册
        for (const reg of this.registrations.values()) {
            reg.instance = undefined;
        }
        this.registrations.clear();

        // 从父容器移除自己的引用，让 GC 能回收
        if (this.parent) {
            this.parent.children.delete(this);
            this.parent = undefined;
        }
    }
}
