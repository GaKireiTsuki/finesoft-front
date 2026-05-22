/**
 * defineRequestScopedKey — typed handle for per-request DI state
 *
 * Why this exists: each SSR request gets its own `Framework` and therefore its
 * own `Container` (see `Framework.create()` in framework.ts). That means writing
 * to `ctx.container` from a middleware is already request-scoped. The trap that
 * shipped applications keep falling into is using **module-level state** for
 * per-request data — a `let lastUser` at the top of a middleware file leaks
 * across requests because the module is shared.
 *
 * This helper makes the safe path the obvious path: a typed handle with `set` /
 * `get` / `clear` that talks to the request's container only. It deliberately
 * does NOT cache anything in module scope; the only state lives in the container
 * the caller passes in.
 *
 * @example
 * ```ts
 * import { defineRequestScopedKey } from "@finesoft/front";
 *
 * export interface TracedUser { name: string; seenAt: number; }
 *
 * export const CURRENT_USER = defineRequestScopedKey<TracedUser | null>(
 *     "app.traced-user",
 * );
 *
 * // middleware
 * export const traceUser: BeforeLoadGuard = (ctx) => {
 *     const name = ctx.params.user ?? ctx.getCookie("user");
 *     CURRENT_USER.set(ctx, name ? { name, seenAt: Date.now() } : null);
 *     return next();
 * };
 *
 * // controller
 * class AdminController extends BaseController<{}, AdminPage> {
 *     execute(_params, container) {
 *         const user = CURRENT_USER.get(container);
 *         ...
 *     }
 * }
 * ```
 */

import type { Container } from "./container";

/** Anything that exposes the per-request DI container — covers NavigationContext, PostLoadContext, and raw Container. */
type ContainerHolder = Container | { container: Container };

function toContainer(target: ContainerHolder): Container {
    return "container" in target ? target.container : target;
}

export interface RequestScopedKey<T> {
    /** The underlying string key registered with the Container. */
    readonly key: string;
    /** Write the current request's value. Overwrites any prior registration. */
    set(target: ContainerHolder, value: T): void;
    /** Read the current request's value, or `undefined` if not set. */
    get(target: ContainerHolder): T | undefined;
    /**
     * Remove the registration from this request's container. Subsequent `get`
     * calls return `undefined`. Returns true if the key existed.
     */
    clear(target: ContainerHolder): boolean;
}

/**
 * Define a typed, request-scoped DI key.
 *
 * The returned object's `set`/`get`/`clear` work against the container belonging
 * to the request you hand in — typically `ctx.container` from a middleware or
 * the `container` argument inside `BaseController.execute`.
 */
export function defineRequestScopedKey<T>(key: string): RequestScopedKey<T> {
    return {
        key,
        set(target, value) {
            toContainer(target).register<T>(key, () => value);
        },
        get(target) {
            const c = toContainer(target);
            return c.has(key) ? c.resolve<T>(key) : undefined;
        },
        clear(target) {
            return toContainer(target).unregister(key);
        },
    };
}
