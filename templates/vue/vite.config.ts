import { finesoftFrontViteConfig } from "@finesoft/front";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

export default defineConfig({
    plugins: [
        vue(),
        finesoftFrontViteConfig({
            locales: ["en"],
            defaultLocale: "en",
            ssr: { entry: "src/ssr.ts" },
            adapter: "node",
        }),
    ],
});
