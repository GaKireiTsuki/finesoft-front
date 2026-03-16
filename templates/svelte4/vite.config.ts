import { finesoftFrontViteConfig } from "@finesoft/front";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

export default defineConfig({
    plugins: [
        svelte({ preprocess: vitePreprocess() }),
        finesoftFrontViteConfig({
            locales: ["en"],
            defaultLocale: "en",
            ssr: { entry: "src/ssr.ts" },
            adapter: "node",
        }),
    ],
});
