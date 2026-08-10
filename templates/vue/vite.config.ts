import { finesoftFrontViteConfig } from "@finesoft/front";
import vue from "@vitejs/plugin-vue";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
    plugins: lazyPlugins(() => [
        vue(),
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.ts" },
            proxies: [
                {
                    prefix: "/api",
                    target: "https://jsonplaceholder.typicode.com",
                },
            ],
        }),
    ]),
});
