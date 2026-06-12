import type { DefaultTheme } from "vitepress";

export const sidebarEn: DefaultTheme.SidebarItem[] = [
    {
        text: "Guide",
        items: [
            { text: "Getting started", link: "/01-getting-started" },
            { text: "Routing & controllers", link: "/02-routing-and-controllers" },
            { text: "Middleware", link: "/03-middleware" },
            { text: "Rendering & hydration", link: "/04-rendering-and-hydration" },
            { text: "Internationalization", link: "/05-i18n" },
            { text: "HTTP client", link: "/06-http-client" },
            { text: "DI container", link: "/07-di-container" },
            { text: "Observability", link: "/08-observability" },
            { text: "Server & deployment", link: "/09-server-and-deployment" },
            { text: "Features, platform, PWA", link: "/10-features-platform-pwa" },
            { text: "Navigation", link: "/11-navigation" },
        ],
    },
    {
        text: "Engineering",
        items: [
            { text: "Project structure", link: "/engineering/project-structure" },
            { text: "Testing", link: "/engineering/testing" },
            { text: "CI & release flow", link: "/engineering/ci-release-flow" },
        ],
    },
    {
        text: "Pitfalls",
        items: [
            { text: "SSR hydration mismatch", link: "/pitfalls/ssr-hydration-mismatch" },
            { text: "SSR vs CSR globals", link: "/pitfalls/ssr-vs-csr-globals" },
            { text: "Redirect vs rewrite", link: "/pitfalls/redirect-vs-rewrite" },
            { text: "Proxy binary payloads", link: "/pitfalls/proxy-binary-payloads" },
            { text: "Container scope leak", link: "/pitfalls/container-scope-leak" },
            { text: "i18n bundle size", link: "/pitfalls/i18n-bundle-size" },
        ],
    },
    {
        text: "Advanced",
        items: [
            { text: "Custom action handler", link: "/advanced/custom-action-handler" },
            { text: "Custom event recorder", link: "/advanced/custom-event-recorder" },
            { text: "Custom adapter", link: "/advanced/custom-adapter" },
            { text: "Inline proxy codegen", link: "/advanced/inline-proxy-codegen" },
            { text: "Multi-tenant scopes", link: "/advanced/multi-tenant-scopes" },
        ],
    },
];
