import { defineConfig } from "vite-plus";
const internal = ["core", "web", "browser", "ssr", "server"];
export default defineConfig({
    pack: {
        entry: [
            "src/index.ts",
            "src/browser.ts",
            "src/web.ts",
            "src/core.ts",
            "src/http.ts",
            "src/worker.ts",
            "src/node.ts",
        ],
        format: "esm",
        dts: true,
        sourcemap: true,
        clean: true,
        // Bundle source owners, including temporary migration entries, without leaking private workspaces.
        alias: {
            "@finesoft/ssr/inject": new URL("../ssr/src/inject.ts", import.meta.url).pathname,
            ...Object.fromEntries(
                internal.map((name) => [
                    `@finesoft/${name}`,
                    new URL(`../${name}/src/index.ts`, import.meta.url).pathname,
                ]),
            ),
        },
        deps: {
            neverBundle: ["hono", "@hono/node-server", "vite", "dotenv"],
            alwaysBundle: internal.map((name) => `@finesoft/${name}`),
        },
    },
});
