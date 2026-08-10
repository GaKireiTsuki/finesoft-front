import { finesoftFrontViteConfig } from "@finesoft/front";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
    plugins: lazyPlugins(() => [
        svelte(),
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
