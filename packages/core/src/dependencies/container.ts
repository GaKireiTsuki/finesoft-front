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

    /** 注册依赖（默认单例） */
    register<T>(key: string, factory: Factory<T>, singleton = true): this {
        this.registrations.set(key, { factory, singleton });
        return this;
    }

    /** 解析依赖 */
    resolve<T>(key: string): T {
        const reg = this.registrations.get(key);
        if (!reg) {
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

    /** 检查是否已注册 */
    has(key: string): boolean {
        return this.registrations.has(key);
    }

    /** 销毁容器，清除所有缓存 */
    dispose(): void {
        for (const reg of this.registrations.values()) {
            reg.instance = undefined;
        }
        this.registrations.clear();
    }
}
