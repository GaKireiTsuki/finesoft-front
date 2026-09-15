import { defineConfig } from "vite-plus";
const deps = { alwaysBundle: [/^@finesoft\/front/], neverBundle: ["@hono/node-server"] };
export default defineConfig({
    pack: [
        {
            entry: ["src/business.ts", "src/node.ts"],
            outDir: "dist/node",
            format: "esm",
            dts: false,
            clean: true,
            deps,
        },
        {
            entry: ["src/worker.ts"],
            outDir: "dist/worker",
            format: "esm",
            dts: false,
            clean: true,
            deps,
        },
    ],
});
