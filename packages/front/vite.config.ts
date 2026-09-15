import { defineConfig } from "vite-plus";
const internal = ["core", "web", "browser", "ssr", "server"];
export default defineConfig({
    pack: {
        entry: [
            "src/index.ts",
            "src/browser.ts",
            "src/web.ts",
            "src/ssr.ts",
            "src/vite.ts",
            "src/http.ts",
            "src/worker.ts",
            "src/node.ts",
            ...["react", "vue", "svelte"].flatMap((ui) =>
                ["browser", "server"].map((side) => "src/renderers/" + ui + "/" + side + ".ts"),
            ),
        ],
        format: "esm",
        dts: true,
        sourcemap: true,
        clean: true,
        // Bundle private owners into isolated public entry graphs.
        alias: {
            ...Object.fromEntries(
                ["http", "node", "worker", "ssr", "vite"].map((name) => [
                    `@finesoft/server/${name}`,
                    new URL(`../server/src/${name}.ts`, import.meta.url).pathname,
                ]),
            ),
            "@finesoft/ssr/inject": new URL("../ssr/src/inject.ts", import.meta.url).pathname,
            ...Object.fromEntries(
                internal.map((name) => [
                    `@finesoft/${name}`,
                    new URL(`../${name}/src/index.ts`, import.meta.url).pathname,
                ]),
            ),
        },
        deps: {
            neverBundle: [
                "hono",
                "@hono/node-server",
                "vite",
                "dotenv",
                /^react(?:-dom)?(?:\/|$)/,
                /^vue(?:\/|$)/,
                /^svelte(?:\/|$)/,
            ],
            alwaysBundle: internal.map((name) => `@finesoft/${name}`),
        },
    },
});
