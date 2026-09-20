import type { SSRResponseResult } from "./ssr-handler";

/** Shared HTML must be explicitly public and carry no request-specific response metadata. */
export function isPublicSSRResult(
    result: SSRResponseResult,
    headers = new Headers(result.headers),
): boolean {
    return (
        result.cache === "public" &&
        !result.redirect &&
        !result.rewriteUrl &&
        (result.status ?? 200) === 200 &&
        headers.keys().next().done === true
    );
}
