import type { RouteAddOptions } from "@finesoft/core";

export interface SampleRoute {
    pattern: string;
    intentId: string;
    options?: RouteAddOptions;
    note?: string;
}

export const sampleRoutes: SampleRoute[] = [
    {
        pattern: "/",
        intentId: "home",
        options: { renderMode: "ssr" },
        note: "Home page, server-rendered.",
    },
    {
        pattern: "/products",
        intentId: "products.list",
        options: { renderMode: "ssr" },
        note: "Product list — full SSR for SEO.",
    },
    {
        pattern: "/products/:id",
        intentId: "products.detail",
        options: { renderMode: "ssr" },
        note: "Product detail with required `:id` parameter.",
    },
    {
        pattern: "/blog/:slug?",
        intentId: "blog",
        options: { renderMode: "prerender" },
        note: "Optional slug — list page when missing, post when present. Pre-rendered + ISR.",
    },
    {
        pattern: "/account",
        intentId: "account.dashboard",
        options: { renderMode: "csr" },
        note: "Authenticated dashboard, CSR shell only.",
    },
    {
        pattern: "/about",
        intentId: "about",
        options: { renderMode: "prerender" },
        note: "Static marketing page, fully pre-rendered.",
    },
];

export const sampleUrls = [
    "/",
    "/products",
    "/products/42",
    "/blog",
    "/blog/hello-world",
    "/account",
    "/about",
    "/products/42?ref=email",
    "/missing-route",
];
