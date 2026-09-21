import { createRequire } from "node:module";

// Node >= 22.18 can synchronously load these ESM modules (none uses top-level await).
// Keeping the specifier opaque preserves optional peers until the API is called.
const require = createRequire(import.meta.url);
export function loadImplementation(name: string): any {
    return require(`./${name}.mjs`);
}
