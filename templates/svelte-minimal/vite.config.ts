import { finesoftFrontViteConfig } from "@finesoft/front";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
    plugins: lazyPlugins(() => [
        svelte(),
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.ts" },
            i18n: {
                messagesDir: "src/locales",
            },
        }),
    ]),
});
