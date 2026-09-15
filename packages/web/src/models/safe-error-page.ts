/**
 * safeErrorPage — build a BasePage for the error-rendering path without leaking
 * internals.
 *
 * Why this exists: applications kept writing `description: error.stack` in their
 * `getErrorPage` / `BaseController.fallback`. That stack trace leaks absolute
 * file paths (and from there, `process.cwd()`, source layout, the location of
 * any `.env` siblings), turning a tiny try/catch into a recon primitive. This
 * helper produces a safe-by-default error page; the unsafe `devError` payload is
 * only included when the runtime is clearly a non-production environment.
 *
 * Hosts explicitly opt into developer error details with isProduction: false.
 * The default always hides developer errors.
 *
 * @example
 * ```ts
 * export const render = createSSRRender({
 *     bootstrap,
 *     getErrorPage: (status, message) => safeErrorPage({ status, publicMessage: message }),
 *     renderApp(page) { ... },
 * });
 *
 * // In a controller's fallback:
 * fallback(_params, error) {
 *     return safeErrorPage({
 *         status: 500,
 *         publicMessage: "Could not load search results.",
 *         devError: error,
 *     });
 * }
 * ```
 */

import type { BasePage } from "./page";

export interface SafeErrorPageOptions {
    /** HTTP-style status code used in the page title (e.g. 404, 500). */
    status: number;
    /**
     * The message users / client code may safely see in production. Should
     * contain no stack, file paths, hostnames, or secrets.
     */
    publicMessage: string;
    /**
     * Optional error / debug payload to surface only in non-production. In
     * production this is dropped entirely; only `publicMessage` is exposed.
     */
    devError?: unknown;
    /**
     * Override the production detection. Pass `true` to force the prod-safe
     * variant (drops devError). Defaults to true.
     */
    isProduction?: boolean;
}

function formatDevError(devError: unknown): string {
    if (devError instanceof Error) {
        return devError.stack ?? `${devError.name}: ${devError.message}`;
    }
    if (typeof devError === "string") return devError;
    try {
        return JSON.stringify(devError);
    } catch {
        return String(devError);
    }
}

/**
 * Build a BasePage for an error condition. In production, only `publicMessage`
 * makes it into the page. In dev, `devError` (if provided) is appended.
 */
export function safeErrorPage(options: SafeErrorPageOptions): BasePage {
    const { status, publicMessage, devError, isProduction = true } = options;
    const showDevError = !isProduction && devError !== undefined;
    return {
        id: "error",
        pageType: "error",
        title: `Error ${status}`,
        description: showDevError
            ? `${publicMessage}\n\n[dev only]\n${formatDevError(devError)}`
            : publicMessage,
    };
}
