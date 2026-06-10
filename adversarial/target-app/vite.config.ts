import { finesoftFrontViteConfig } from "@finesoft/front";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite-plus";

export default defineConfig(({ mode }) => {
    // Vite's loadEnv reads .env files but does NOT mutate process.env for
    // server-side code. SSR controllers run in the Node process and read
    // process.env directly, so we mirror the loaded values here.
    const env = loadEnv(mode, process.cwd(), "");
    for (const key of ["ADMIN_TOKEN"] as const) {
        if (env[key] && !process.env[key]) {
            process.env[key] = env[key];
        }
    }

    return {
        plugins: [
            react(),
            finesoftFrontViteConfig({
                ssr: { entry: "src/ssr.tsx" },
            }),
        ],
    };
});
