import { finesoftFrontViteConfig } from "@finesoft/front";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
    plugins: [
        react(),
        finesoftFrontViteConfig({
            locales: ["en"],
            defaultLocale: "en",
            ssr: { entry: "src/ssr.ts" },
            adapter: "node",
        }),
    ],
});
