import { defineConfig } from "vite-plus";
import type { CoverageV8Options } from "vite-plus/test/node";

const coverage: CoverageV8Options = {
    reporter: ["text", "html", "lcov", "json-summary"],
    reportsDirectory: "./reports/coverage",
    include: [
        "packages/core/src/**/*.ts",
        "packages/browser/src/**/*.ts",
        "packages/ssr/src/**/*.ts",
        "packages/server/src/**/*.ts",
        "packages/front/src/**/*.ts",
    ],
    exclude: [
        "**/*.d.ts",
        "**/dist/**",
        "**/test/**",
        "packages/create-app/**",
        "templates/**",
        "docs/**",
        "scripts/**",
    ],
};

export default defineConfig({
    staged: {
        "*": "vp check --fix",
    },
    test: {
        coverage,
    },
});
