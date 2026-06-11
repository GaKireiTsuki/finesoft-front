import type { DefaultTheme } from "vitepress";

export const sidebarZh: DefaultTheme.SidebarItem[] = [
    {
        text: "指南",
        items: [
            { text: "快速开始", link: "/zh/01-getting-started" },
            { text: "路由与 Controller", link: "/zh/02-routing-and-controllers" },
            { text: "中间件", link: "/zh/03-middleware" },
            { text: "渲染与 Hydration", link: "/zh/04-rendering-and-hydration" },
            { text: "国际化", link: "/zh/05-i18n" },
            { text: "HTTP 客户端", link: "/zh/06-http-client" },
            { text: "DI 容器", link: "/zh/07-di-container" },
            { text: "可观测性", link: "/zh/08-observability" },
            { text: "服务器与部署", link: "/zh/09-server-and-deployment" },
            { text: "Feature flags、平台、PWA", link: "/zh/10-features-platform-pwa" },
            { text: "导航", link: "/zh/11-navigation" },
            { text: "会话恢复", link: "/zh/12-session-restoration" },
        ],
    },
    {
        text: "工程实践",
        items: [
            { text: "项目结构", link: "/zh/engineering/project-structure" },
            { text: "测试", link: "/zh/engineering/testing" },
            { text: "CI 与发布流程", link: "/zh/engineering/ci-release-flow" },
        ],
    },
    {
        text: "陷阱",
        items: [
            { text: "SSR Hydration 不匹配", link: "/zh/pitfalls/ssr-hydration-mismatch" },
            { text: "SSR 与 CSR 全局变量", link: "/zh/pitfalls/ssr-vs-csr-globals" },
            { text: "Redirect 与 Rewrite", link: "/zh/pitfalls/redirect-vs-rewrite" },
            { text: "Proxy 二进制载荷", link: "/zh/pitfalls/proxy-binary-payloads" },
            { text: "Container scope 泄漏", link: "/zh/pitfalls/container-scope-leak" },
            { text: "i18n 包体积", link: "/zh/pitfalls/i18n-bundle-size" },
        ],
    },
    {
        text: "高阶",
        items: [
            { text: "自定义 Action handler", link: "/zh/advanced/custom-action-handler" },
            { text: "自定义 Event recorder", link: "/zh/advanced/custom-event-recorder" },
            { text: "自定义 adapter", link: "/zh/advanced/custom-adapter" },
            { text: "内联 proxy 代码生成", link: "/zh/advanced/inline-proxy-codegen" },
            { text: "多租户 scope", link: "/zh/advanced/multi-tenant-scopes" },
        ],
    },
];
