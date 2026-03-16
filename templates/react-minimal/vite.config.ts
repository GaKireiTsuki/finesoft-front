import { finesoftFrontViteConfig } from "@finesoft/front";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
    plugins: [
        react(),
        finesoftFrontViteConfig({
            ssr: { entry: "src/ssr.tsx" },
        }),
    ],
});
