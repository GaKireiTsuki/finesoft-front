import { finesoftFrontViteConfig } from "@finesoft/front";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

const front = finesoftFrontViteConfig({
    controllerTypes: { root: import.meta.dirname },
    ssr: { entry: "src/ssr.ts" },
    i18n: { messagesDir: "src/locales" },
});

export default defineConfig({
    lint: { options: { typeAware: true, typeCheck: true } },
    plugins: lazyPlugins(() => [front, react()]),
});
