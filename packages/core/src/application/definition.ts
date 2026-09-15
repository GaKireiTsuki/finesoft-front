import type { Provider } from "../dependencies/providers";
import type { Token } from "../dependencies/token";
import {
    ExecutionError,
    type AppDefinition,
    type ModuleDefinition,
    type RuntimeOptions,
    type AnyOperation,
    type OperationPolicy,
    type Implementation,
} from "./types";
function freezeDefinition<T extends ModuleDefinition | AppDefinition>(value: T): T {
    const copy = { ...value };
    for (const key of [
        "operations",
        "implementations",
        "providers",
        "policies",
        "dependsOn",
        "modules",
    ] as const) {
        const values = (copy as unknown as Record<string, unknown>)[key];
        if (Array.isArray(values)) Object.assign(copy, { [key]: Object.freeze([...values]) });
    }
    return Object.freeze(copy);
}
export function defineModule(module: ModuleDefinition): ModuleDefinition {
    return freezeDefinition(module);
}
export function defineApp(app: AppDefinition): AppDefinition {
    return freezeDefinition(app);
}
export function configuration(message: string): never {
    throw new ExecutionError("configuration", message);
}
export function normalize(options: RuntimeOptions) {
    const { app } = options;
    if (!app.id) configuration("Application ID must not be empty");
    const modules = new Map<string, ModuleDefinition>();
    for (const module of app.modules ?? []) {
        if (!module.id || modules.has(module.id))
            configuration(`Duplicate or empty module: ${module.id}`);
        modules.set(module.id, module);
    }
    const ordered: ModuleDefinition[] = [],
        visiting = new Set<ModuleDefinition>(),
        visited = new Set<ModuleDefinition>();
    function visit(module: ModuleDefinition) {
        if (visiting.has(module)) configuration(`Cyclic module dependency: ${module.id}`);
        if (visited.has(module)) return;
        visiting.add(module);
        for (const dependency of module.dependsOn ?? []) {
            if (modules.get(dependency.id) !== dependency)
                configuration(`Unknown module: ${dependency.id}`);
            visit(dependency);
        }
        visiting.delete(module);
        visited.add(module);
        ordered.push(module);
    }
    for (const module of modules.values()) visit(module);
    const operations = new Map<string, AnyOperation>(),
        implementations = new Map<AnyOperation, Implementation>(),
        providers = new Map<Token, Provider<any>>(),
        tokenIds = new Map<string, Token>(),
        policies = new Map<AnyOperation, readonly OperationPolicy<any>[]>();
    for (const owner of [...ordered, app]) {
        for (const op of owner.operations ?? []) {
            if (!op.id || operations.has(op.id))
                configuration(`Duplicate or empty operation: ${op.id}`);
            if (op.kind === "command" && op.cache) configuration(`Command cannot cache: ${op.id}`);
            if (op.cache && (!Number.isFinite(op.cache.ttlMs) || op.cache.ttlMs <= 0))
                configuration(`Invalid cache ttl: ${op.id}`);
            operations.set(op.id, op);
            policies.set(op, [
                ...(app.policies ?? []),
                ...(owner === app ? [] : (owner.policies ?? [])),
                ...(op.policies ?? []),
            ]);
            if (op.handler) implementations.set(op, { operation: op, handler: op.handler });
        }
        for (const p of owner.providers ?? []) {
            if (tokenIds.has(p.token.id)) configuration(`Duplicate provider: ${p.token.id}`);
            tokenIds.set(p.token.id, p.token);
            providers.set(p.token, p);
        }
    }
    for (const owner of [...ordered, app])
        for (const impl of owner.implementations ?? []) {
            if (operations.get(impl.operation.id) !== impl.operation)
                configuration(`Unknown operation: ${impl.operation.id}`);
            if (implementations.has(impl.operation))
                configuration(`Duplicate implementation: ${impl.operation.id}`);
            implementations.set(impl.operation, impl);
        }
    const overrides = new Set<AnyOperation>();
    for (const impl of options.implementations ?? []) {
        if (operations.get(impl.operation.id) !== impl.operation)
            configuration(`Unknown operation: ${impl.operation.id}`);
        if (overrides.has(impl.operation))
            configuration(`Duplicate override: ${impl.operation.id}`);
        overrides.add(impl.operation);
        implementations.set(impl.operation, impl);
    }
    const providerOverrides = new Set<Token>();
    for (const p of options.providers ?? []) {
        if (!providers.has(p.token)) configuration(`Unknown provider override: ${p.token.id}`);
        if (providerOverrides.has(p.token))
            configuration(`Duplicate provider override: ${p.token.id}`);
        providerOverrides.add(p.token);
        providers.set(p.token, p);
    }
    const checkCapabilities = (names: readonly string[] = []) => {
        for (const name of names)
            if (options.capabilities?.[name] == null)
                throw new ExecutionError("capability", `Missing capability: ${name}`);
    };
    for (const op of operations.values()) {
        if (!implementations.has(op)) configuration(`Unbound operation: ${op.id}`);
        checkCapabilities(op.capabilities);
    }
    for (const p of providers.values()) {
        if ((typeof p.create === "function") === Object.hasOwn(p, "value"))
            configuration(`Provider requires exactly create or value: ${p.token.id}`);
        checkCapabilities(p.capabilities);
        const walk = (current: Provider<any>, path: Set<Token>) => {
            if (path.has(current.token))
                configuration(`Cyclic provider dependency: ${current.token.id}`);
            if (p.lifetime === "runtime" && current.lifetime === "scope")
                configuration(
                    `runtime provider ${p.token.id} cannot depend on scope provider ${current.token.id}`,
                );
            const next = new Set(path).add(current.token);
            for (const token of current.dependencies ?? []) {
                const dep = providers.get(token);
                if (!dep) configuration(`Unknown provider: ${token.id}`);
                walk(dep, next);
            }
        };
        walk(p, new Set());
    }
    return { operations, implementations, providers, policies };
}
