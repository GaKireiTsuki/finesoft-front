import { finesoftFrontViteConfig } from "@finesoft/front";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

export default defineConfig({
    plugins: [
        vue(),
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.ts" },
            locales: ["en", "zh"],
            defaultLocale: "en",
            proxies: [
                {
                    prefix: "/api",
                    target: "https://jsonplaceholder.typicode.com",
                },
            ],
        }),
    ],
});
