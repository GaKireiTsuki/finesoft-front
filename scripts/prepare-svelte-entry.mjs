import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageRoot = process.cwd();
const source = resolve(packageRoot, "src");
const dist = resolve(packageRoot, "dist");
const component = await readFile(resolve(source, "Outlet.svelte"), "utf8");
await writeFile(
    resolve(dist, "Outlet.svelte"),
    component
        .replaceAll('"@finesoft/web"', '"@finesoft/front"')
        .replace('"./svelte"', '"./svelte.mjs"'),
);
const declaration = await readFile(resolve(source, "Outlet.svelte.d.ts"), "utf8");
await writeFile(
    resolve(dist, "Outlet.svelte.d.ts"),
    declaration.replaceAll('"@finesoft/web"', '"@finesoft/front"'),
);
