/// <reference types="./shims/server-peer-modules.d.ts" />

// ===== Core + Browser =====
// 复用 browser-only 入口（src/browser.ts），避免两个入口重复维护同一份 core+browser 导出清单。
// index 在其之上再叠加 SSR + Server；browser 入口刻意排除 server 代码（见 src/browser.ts）。
export * from "./browser";

// ===== SSR (unique exports only) =====
export {
    SSR_PLACEHOLDERS,
    createSSRNavigationRender,
    createSSRRender,
    extractNavigationTree,
    injectCSRShell,
    injectSSRContent,
    NAVIGATION_TREE_INTENT_ID,
    renderIslandsHtml,
    serializeServerData,
    ssrRender,
    ssrRenderNavigation,
    stripNavigationTree,
} from "@finesoft/ssr";
export type {
    InjectSSROptions,
    RenderEntry,
    SerializedNavigationTreePayload,
    SerializeServerDataOptions,
    SSRContext,
    SSRNavigationDefinition,
    SSRNavigationRenderConfig,
    SSRRenderConfig,
    SSRRenderNavigationOptions,
    SSRRenderNavigationResult,
    SSRRenderOptions,
    SSRRenderResult,
} from "@finesoft/ssr";

// ===== Server =====
export * from "@finesoft/server";
