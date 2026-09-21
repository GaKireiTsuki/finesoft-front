import { type AfterLoadGuard, next, rewrite } from "@finesoft/front";

/**
 * SEO guard — normalizes URLs after data load.
 *
 * Demonstrates afterLoad middleware with `rewrite()`.
 * Strips trailing slashes for canonical URL consistency.
 */
export const seoGuard: AfterLoadGuard = (ctx) => {
    if (ctx.path !== "/" && ctx.path.endsWith("/")) {
        return rewrite(ctx.path.slice(0, -1));
    }

    return next();
};
