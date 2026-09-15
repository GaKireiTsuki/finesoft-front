import { defineConfig } from "vite-plus";
export default defineConfig({
    pack: {
        entry: [
            "src/index.ts",
            "src/http.ts",
            "src/worker.ts",
            "src/node.ts",
            "src/ssr.ts",
            "src/vite.ts",
        ],
        format: ["esm", "cjs"],
        dts: true,
        sourcemap: true,
        clean: true,
    },
});
