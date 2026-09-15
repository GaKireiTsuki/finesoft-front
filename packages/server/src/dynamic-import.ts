/** Native dynamic import for known host modules and built SSR module URLs.
 * Stable non-file modules are cached here. File modules use the native loader;
 * callers use Vite's loader for development updates. This helper uses no eval or new Function.
 */

// ── Known module type map ──────────────────────────────────────

/** Maps well-known specifiers to their resolved module types. */
interface KnownModules {
    "node:fs": typeof import("node:fs");
    "node:path": typeof import("node:path");
    "node:url": typeof import("node:url");
    "node:http": typeof import("node:http");
    vite: typeof import("vite");
    hono: typeof import("hono");
    dotenv: { config: (opts?: { path?: string }) => void };
    "@hono/node-server": typeof import("@hono/node-server");
    "@hono/node-server/serve-static": { serveStatic: (...args: any[]) => any };
}

type KnownSpecifier = keyof KnownModules;

// ── Cache ──────────────────────────────────────────────────────

/** Cache for stable (non-file://) modules — avoids redundant resolution. */
const moduleCache = new Map<string, unknown>();

// ── Core import function ───────────────────────────────────────

/**
 * Opaque dynamic import wrapper.
 *
 * Uses native `import()` directly — compatible with all JS runtimes
 * including Cloudflare Workers (which forbid `new Function`).
 *
 * This may produce "dynamic import cannot be analyzed" warnings in Vite dev
 * mode when the `@vite-ignore` comment is stripped by tsdown during bundling.
 * These warnings are harmless: all specifiers are either well-known Node.js
 * built-ins (externalized) or absolute file:// URLs constructed by the framework.
 */
const rawImport = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

const debugEnabled = typeof process !== "undefined" && process.env?.FINESOFT_DEBUG === "1";

function logDebug(msg: string): void {
    if (debugEnabled) {
        console.debug(`[finesoft:dynamic-import] ${msg}`);
    }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Import a well-known module (type-safe).
 */
export async function dynamicImport<K extends KnownSpecifier>(
    specifier: K,
): Promise<KnownModules[K]>;

/**
 * Import an arbitrary module (e.g. file:// URL for SSR).
 */
export async function dynamicImport(specifier: string): Promise<any>;

export async function dynamicImport(specifier: string): Promise<unknown> {
    // file:// URLs and absolute paths are never cached — they may be
    // hot-reloaded SSR modules whose exports change between requests.
    const cacheable = !specifier.startsWith("file:") && !specifier.startsWith("/");

    if (cacheable) {
        const cached = moduleCache.get(specifier);
        if (cached) {
            logDebug(`cache hit  → ${specifier}`);
            return cached;
        }
    }

    logDebug(`importing  → ${specifier}`);
    const mod = await rawImport(specifier);

    if (cacheable) {
        moduleCache.set(specifier, mod);
    }

    return mod;
}
