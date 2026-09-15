import type { Token } from "./token";
import type { Provider, ProviderContext } from "./providers";
/**
 * Container — 通用的依赖注入容器
 */

type Factory<T> = () => T;

interface Registration<T> {
    factory: Factory<T>;
    singleton: boolean;
    instance?: T;
}

interface Cleanup {
    dispose: () => void | Promise<void>;
    provider?: Provider<any>;
}

export class Container {
    private registrations = new Map<string, Registration<unknown>>();
    private resolutionStack = new Set<string>();
    private parent?: Container;
    private children = new Set<Container>();

    private providers = new Map<Token, Provider<any>>();
    private values = new Map<Token, Promise<unknown>>();
    private pending = new Set<Promise<unknown>>();
    private cleanups: Cleanup[] = [];
    private closed = false;
    private disposal?: Promise<void>;
    private bindings: Readonly<Record<string, unknown>> = Object.freeze({});

    registerProvider<T>(provider: Provider<T>): this {
        this.assertOpen();
        this.providers.set(provider.token, provider);
        // Ownership of an existing runtime resource transfers at registration, not first use.
        if (
            provider.lifetime === "runtime" &&
            Object.hasOwn(provider, "value") &&
            provider.owned &&
            provider.dispose
        ) {
            this.cleanups.push({ provider, dispose: () => provider.dispose!(provider.value as T) });
        }
        return this;
    }

    onDispose(cleanup: () => void | Promise<void>): void {
        this.assertOpen();
        this.cleanups.push({ dispose: cleanup });
    }

    private assertOpen(): void {
        if (this.closed) throw new Error("Container is closed");
    }

    async get<T>(token: Token<T>): Promise<T> {
        this.assertOpen();
        return this.getProvider(token, []) as Promise<T>;
    }

    private findProvider(token: Token): { provider: Provider<any>; owner: Container } {
        const provider = this.providers.get(token);
        if (provider) return { provider, owner: this };
        if (this.parent) return this.parent.findProvider(token);
        throw new Error(`Unknown provider: ${token.id}`);
    }

    private getProvider(token: Token, path: readonly Token[]): Promise<unknown> {
        if (path.includes(token))
            return Promise.reject(new Error(`Cyclic provider dependency: ${token.id}`));
        const { provider, owner } = this.findProvider(token);
        const target = provider.lifetime === "runtime" ? owner : this;
        const existing = provider.lifetime !== "transient" && target.values.get(token);
        if (existing) return existing;
        const nextPath = [...path, token];
        const promise = Promise.resolve().then(async () => {
            let creating = true;
            const dependencies = new Map<Token, Promise<unknown>>();
            const context: ProviderContext = {
                bindings: provider.lifetime === "runtime" ? Object.freeze({}) : target.bindings,
                get: async <T>(dependency: Token<T>): Promise<T> => {
                    if (!creating) throw new Error(`Provider resolver is closed: ${token.id}`);
                    if (!provider.dependencies?.includes(dependency))
                        throw new Error(`Undeclared dependency: ${token.id} -> ${dependency.id}`);
                    const dep = target.findProvider(dependency).provider;
                    // Runtime factories cannot indirectly capture scope state through transients.
                    if (
                        nextPath.some(
                            (t) => target.findProvider(t).provider.lifetime === "runtime",
                        ) &&
                        dep.lifetime === "scope"
                    )
                        throw new Error(`runtime provider cannot resolve scope: ${dependency.id}`);
                    let value = dependencies.get(dependency);
                    if (!value) {
                        value = target.getProvider(dependency, nextPath);
                        dependencies.set(dependency, value);
                    }
                    return value as Promise<T>;
                },
            };
            try {
                for (const dependency of provider.dependencies ?? []) await context.get(dependency);
                const value = provider.create ? await provider.create(context) : provider.value;
                if (
                    provider.dispose &&
                    (provider.owned ?? !!provider.create) &&
                    (provider.create || provider.lifetime !== "runtime")
                )
                    target.cleanups.push({ provider, dispose: () => provider.dispose!(value) });
                return value;
            } finally {
                creating = false;
            }
        });
        target.pending.add(promise);
        if (provider.lifetime !== "transient") target.values.set(token, promise);
        void promise.then(
            () => target.pending.delete(promise),
            () => {
                target.pending.delete(promise);
                if (target.values.get(token) === promise) target.values.delete(token);
            },
        );
        return promise;
    }

    /** Sort owned cleanup by dependencies, retaining creation order for unrelated resources. */
    private orderedCleanups(): Cleanup[] {
        const ordered: Cleanup[] = [];
        const visited = new Set<Cleanup>();
        const visit = (cleanup: Cleanup) => {
            if (visited.has(cleanup)) return;
            visited.add(cleanup);
            const dependencies = (provider: Provider<any>, path: Set<Token>) => {
                for (const token of provider.dependencies ?? []) {
                    if (path.has(token)) continue;
                    path.add(token);
                    // Follow even unowned intermediary providers to retain transitive ordering.
                    dependencies(this.findProvider(token).provider, path);
                    for (const dependency of this.cleanups)
                        if (dependency.provider?.token === token) visit(dependency);
                }
            };
            if (cleanup.provider) dependencies(cleanup.provider, new Set());
            ordered.push(cleanup);
        };
        for (const cleanup of this.cleanups) visit(cleanup);
        return ordered.reverse();
    }

    /** 注册依赖（默认单例） */
    register<T>(key: string, factory: Factory<T>, singleton = true): this {
        this.assertOpen();
        this.registrations.set(key, { factory, singleton });
        return this;
    }

    /** 解析依赖 — 当前容器未注册时回退到 parent */
    resolve<T>(key: string): T {
        if (this.closed) throw new Error("[Container] No registration: container is closed");
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
        return !this.closed && (this.registrations.has(key) || (this.parent?.has(key) ?? false));
    }

    /**
     * 移除当前容器的注册（不影响 parent）。
     *
     * 用途：在 scope 内显式撤销之前覆写的依赖，避免用 `register(() => null)` 这种
     * 反语义的写法。被移除的 key 之后再 resolve 会回退到 parent 容器。
     *
     * 返回 true 表示当前层确实存在过这个注册并被移除，false 表示未注册（含「只在
     * parent 注册」的情况，本方法不向上递归删除 —— scope 不应能影响 parent 状态）。
     */
    unregister(key: string): boolean {
        this.assertOpen();
        return this.registrations.delete(key);
    }

    /**
     * 创建子容器（请求级 scope）
     *
     * 子容器可覆写父容器的依赖（如每请求的 locale、user），
     * 未覆写的 key 自动回退到父容器解析。子容器会被父容器跟踪，
     * 父容器 dispose 时一并销毁所有未独立 dispose 的子容器。
     */
    createScope(bindings: Readonly<Record<string, unknown>> = {}): Container {
        this.assertOpen();
        const child = new Container();
        child.bindings = Object.freeze({ ...bindings });
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
    dispose(): Promise<void> {
        if (this.disposal) return this.disposal;
        this.closed = true;
        const children = [...this.children].map((child) => child.dispose());
        this.children.clear();
        this.registrations.clear();
        // Keep the parent link available until pending factories and their dependencies settle.
        this.disposal = (async () => {
            const errors: unknown[] = [];
            for (const result of await Promise.allSettled(children))
                if (result.status === "rejected") errors.push(result.reason);
            while (this.pending.size) await Promise.allSettled(this.pending);
            for (const cleanup of this.orderedCleanups()) {
                try {
                    await cleanup.dispose();
                } catch (error) {
                    errors.push(error);
                }
            }
            this.cleanups = [];
            this.providers.clear();
            this.values.clear();
            this.parent?.children.delete(this);
            this.parent = undefined;
            if (errors.length) throw new AggregateError(errors, "Container cleanup failed");
        })();
        return this.disposal;
    }
}
