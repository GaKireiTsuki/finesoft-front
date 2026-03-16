export { createSSRRender, type SSRRenderConfig } from "./create-render";
export {
	injectCSRShell,
	injectSSRContent,
	SSR_PLACEHOLDERS,
	type InjectSSROptions,
} from "./inject";
export {
	ssrRender,
	type SSRContext,
	type SSRRenderOptions,
	type SSRRenderResult,
} from "./render";
export { serializeServerData } from "./server-data";

// ===== Re-exports from @finesoft/core (convenience) =====
export { Framework } from "@finesoft/core";
export type { BasePage } from "@finesoft/core";
