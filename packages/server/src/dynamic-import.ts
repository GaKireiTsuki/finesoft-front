/**
 * Dynamic import wrapper that is opaque to Vite's import analysis.
 *
 * When tsdown bundles `@finesoft/server` into `@finesoft/front`,
 * it inlines temporary variables and strips `@vite-ignore` comments
 * from `import()` calls with computed specifiers. This produces
 * "dynamic import cannot be analyzed" warnings in the dev console.
 *
 * `new Function` hides the `import()` call from all static analysis,
 * including Vite's `vite:import-analysis` plugin. The specifier is
 * always an absolute file:// URL constructed by the framework itself,
 * so this is safe for server-side use.
 *
 * ## Features
 *
 * - **Type-safe overloads** for known Node.js / third-party modules
 * - **Module cache** — stable built-in specifiers are resolved once
 * - **Debug logging** — set `FINESOFT_DEBUG=1` to trace dynamic imports
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
