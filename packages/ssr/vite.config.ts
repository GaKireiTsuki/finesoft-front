import { defineConfig } from "vite-plus";
export default defineConfig({
    pack: {
        entry: ["src/index.ts", "src/inject.ts"],
        format: ["esm", "cjs"],
        dts: true,
        sourcemap: true,
        clean: true,
    },
});
