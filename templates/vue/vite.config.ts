import { finesoftFrontViteConfig } from "@finesoft/front";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

export default defineConfig({
    plugins: [
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
    ],
});
