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
    // oxfmt 配置：vp 启动时给 oxfmt 设了 VP_VERSION，导致 oxfmt 读这个字段而不是
    // 仓库根的 .oxfmtrc.json。把 tabWidth 留在这里保证 vp check 用 4 空格判断
    // （仓库历史风格），否则全仓 ~333 个文件被默认 tabWidth=2 标为 format issue。
    // .oxfmtrc.json 仍保留给不经过 vp 的 IDE LSP 用，两边内容保持同步。
    fmt: {
        tabWidth: 4,
    },
    // oxlint 配置：同理，vp 调用时优先读这个，不读 .oxlintrc.json。
    lint: {
        options: {
            typeAware: true,
            typeCheck: true,
        },
    },
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
