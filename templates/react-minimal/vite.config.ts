import { finesoftFrontViteConfig } from "@finesoft/front";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
    plugins: lazyPlugins(() => [
        react(),
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.tsx" },
        }),
    ]),
});
