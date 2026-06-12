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
        "packages/site/**",
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
        // AGENTS.md 的 <!--VITE PLUS START-->...<!--VITE PLUS END--> 段由 prepare 钩子
        // 的 `vp config` 自动重写，但它写入的缩进（yaml block 4 空格 + END 标签 0 缩进）
        // 与 oxfmt 的期望（6 空格 + 2 缩进）冲突。让 oxfmt 跳过这个文件，否则每次
        // `vp install` 后 `vp check` 必然失败。
        // packages/site/.vitepress/cache 是 vitepress 自动生成的依赖缓存，跟 .vitepress-cache
        // 配置无关，每次 dev/build 重新生成；.playwright-mcp 是 playwright 验证 demo 时
        // 的临时截图。两者都不入库，也不参与格式化。
        // **/CHANGELOG.md 由 changeset (`changeset version`) 生成，每次 release 重写且不带
        // oxfmt 格式化（.md 不在 pre-commit lint-staged glob 内），否则 CI 的 bare `vp check`
        // 每次发布后必然在 CHANGELOG fmt 处失败。生成物不该被格式化门控。
        ignorePatterns: [
            "AGENTS.md",
            "**/CHANGELOG.md",
            "**/.vitepress/cache/**",
            "**/.vitepress/dist/**",
            ".playwright-mcp/**",
        ],
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
