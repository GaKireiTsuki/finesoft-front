import { type BeforeLoadGuard, next, redirect } from "@finesoft/front";

/**
 * Auth guard — redirects unauthenticated users to login.
 *
 * Demonstrates beforeLoad middleware with `redirect()` and `next()`.
 * In a real app, check a session cookie or token via `ctx.getCookie()`.
 */
export const authGuard: BeforeLoadGuard = (ctx) => {
    const token = ctx.getCookie("auth_token");

    if (!token) {
        return redirect(`/login?from=${encodeURIComponent(ctx.url)}`);
    }

    return next();
};
