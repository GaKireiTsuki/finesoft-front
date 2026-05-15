import { defineConfig } from "vite-plus/pack";

export default defineConfig({
    // 入口和 minify 通过 CLI 传（vite-plus/pack 的 defineConfig 当前不识别这两个字段）：
    //   build: vp pack src/index.ts src/browser.ts --minify
    // 两个入口：
    //   - index：完整入口含 server 代码（Hono、adapter、proxy），SSR / Node 运行时用
    //   - browser：仅客户端，rolldown 把 startBrowserApp 等共享代码自动抽到一个 chunk，
    //     浏览器端 import @finesoft/front/browser 不会拉 server 代码
    // 共享代码自动按需 code-split 出 dist/start-app-*.mjs。
    format: "esm",
    dts: {
        compilerOptions: {
            paths: {
                "@finesoft/core": ["../core/src/index.ts"],
                "@finesoft/browser": ["../browser/src/index.ts"],
                "@finesoft/ssr": ["../ssr/src/index.ts"],
                "@finesoft/server": ["../server/src/index.ts"],
            },
        },
    },
    sourcemap: true,
    clean: true,
    external: [
        "hono",
        "@hono/node-server",
        "vite",
        "dotenv",
        "node:fs",
        "node:path",
        "node:url",
        "node:http",
    ],
    noExternal: ["@finesoft/core", "@finesoft/browser", "@finesoft/ssr", "@finesoft/server"],
});
