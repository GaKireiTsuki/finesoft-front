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
    // 限定 staged 文件类型：vp check 调 oxlint，oxlint 在零 lintable 文件时退出 1。
    // 默认 "*" 会把 .md / .json / changeset 文件传过去，触发 release workflow 的
    // `chore(release): version packages` commit 失败（那一步 stage 的全是非 TS 文件）。
    staged: {
        "*.{ts,tsx,js,jsx,mjs,cjs}": "vp check --fix",
    },
    test: {
        coverage,
    },
});
