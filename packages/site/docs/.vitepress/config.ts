import { defineConfig } from "vitepress";
import { fileURLToPath, URL } from "node:url";
import { rewriteLinks } from "./plugins/rewrite-links";
import { sidebarEn } from "./sidebars/en";
import { sidebarZh } from "./sidebars/zh";

const aliasFor = (sub: string) =>
    fileURLToPath(new URL(`../../../${sub}/src/index.ts`, import.meta.url));

export default defineConfig({
    title: "@finesoft/front",
    description: "Full-stack TypeScript framework — router, DI, actions, SSR, and server",
    srcDir: "../../front/docs",
    cacheDir: "../.vitepress-cache",
    outDir: "../dist",
    cleanUrls: true,
    base: "/",
    ignoreDeadLinks: [/^https?:\/\/localhost(:\d+)?/],
    rewrites: {
        "README.md": "index.md",
        "zh/README.md": "zh/index.md",
    },
    markdown: {
        config(md) {
            rewriteLinks(md);
        },
    },
    locales: {
        root: {
            label: "English",
            lang: "en",
            themeConfig: {
                nav: [
                    { text: "Guide", link: "/01-getting-started" },
                    { text: "Pitfalls", link: "/pitfalls/ssr-hydration-mismatch" },
                    { text: "Advanced", link: "/advanced/custom-action-handler" },
                ],
                sidebar: sidebarEn,
            },
        },
        zh: {
            label: "简体中文",
            lang: "zh-Hans",
            link: "/zh/",
            themeConfig: {
                nav: [
                    { text: "指南", link: "/zh/01-getting-started" },
                    { text: "陷阱", link: "/zh/pitfalls/ssr-hydration-mismatch" },
                    { text: "高阶", link: "/zh/advanced/custom-action-handler" },
                ],
                sidebar: sidebarZh,
            },
        },
    },
    themeConfig: {
        socialLinks: [{ icon: "github", link: "https://github.com/GaKireiTsuki/finesoft-front" }],
    },
    vite: {
        resolve: {
            alias: {
                "@finesoft/core": aliasFor("core"),
                "@finesoft/browser": aliasFor("browser"),
                "@finesoft/front": aliasFor("front"),
            },
        },
        ssr: {
            noExternal: ["@finesoft/core", "@finesoft/browser", "@finesoft/front", "motion-v"],
        },
        optimizeDeps: {
            exclude: ["@finesoft/core", "@finesoft/browser", "@finesoft/front"],
        },
    },
});
