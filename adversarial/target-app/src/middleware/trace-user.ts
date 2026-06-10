import { type BeforeLoadGuard, defineRequestScopedKey, next } from "@finesoft/front";

export interface TracedUser {
    name: string;
    seenAt: number;
}

/**
 * Typed handle for the current request's user. Reading and writing always go
 * through this key, which talks to the request's DI container — so the trap
 * the application used to fall into (`let lastSeenUser` at module scope,
 * leaking across requests) is structurally impossible here.
 */
export const TRACED_USER = defineRequestScopedKey<TracedUser | null>("app.traced-user");

export const traceUser: BeforeLoadGuard = (ctx) => {
    // ctx.params values are `unknown` (a route codec may have converted them);
    // this guard only wants the raw string form of `user`.
    const rawUser = ctx.params["user"];
    const fromQuery = typeof rawUser === "string" ? rawUser : undefined;
    const fromCookie = ctx.getCookie("user");
    const userName = fromQuery ?? fromCookie;
    TRACED_USER.set(ctx, userName ? { name: userName, seenAt: Date.now() } : null);
    return next();
};
