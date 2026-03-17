import { defineConfig } from "vite-plus/pack";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: false,
    sourcemap: false,
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
});
