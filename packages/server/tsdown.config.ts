import { defineConfig } from "vite-plus/pack";

export default defineConfig({
    entry: ["src/index.ts", "src/node/index.ts"],
    format: ["esm", "cjs"],
    dts: false,
    sourcemap: true,
    clean: true,
    external: [
        "@finesoft/core",
        "@finesoft/web",
        "@finesoft/ssr",
        "node:dns/promises",
        "hono",
        "@hono/node-server",
        "vite",
        "dotenv",
        "../dist/server/ssr.js",
    ],
});
