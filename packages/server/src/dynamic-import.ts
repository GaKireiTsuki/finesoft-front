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
 */
// oxlint-disable-next-line no-implied-eval -- intentional: hides import() from Vite static analysis
export const dynamicImport = new Function("u", "return import(u)") as (
    specifier: string,
) => Promise<any>;
