import { finesoftFrontViteConfig } from "@finesoft/front";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

export default defineConfig({
    plugins: [
        svelte(),
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.ts" },
            proxies: [
                {
                    prefix: "/api",
                    target: "https://jsonplaceholder.typicode.com",
                },
            ],
            adapter: "auto",
        }),
    ],
});
