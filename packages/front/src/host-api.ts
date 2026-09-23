import { loadImplementation } from "#finesoft/implementation";
import type * as NodeAPI from "./node";
import type * as ViteAPI from "./vite";
import type * as TypegenAPI from "./typegen";

export type { NodeHandlerOptions, NodeHandlerServer } from "./node";
export type { FrontTypeOptions } from "./typegen";
export type {
    FinesoftFrontViteOptions,
    ControllerTypeOptions,
    ControllerTypeResult,
    Adapter,
    AdapterContext,
    CloudflareAdapterOptions,
} from "./vite";

const node = (): typeof NodeAPI => loadImplementation("node");
const vite = (): typeof ViteAPI => loadImplementation("vite");
const typegen = (): typeof TypegenAPI => loadImplementation("typegen");

export const startNodeHandler: typeof NodeAPI.startNodeHandler = (...args) =>
    node().startNodeHandler(...args);
export const nodeDnsLookup: typeof NodeAPI.nodeDnsLookup = (...args) =>
    node().nodeDnsLookup(...args);
export const nodeSafeFetchOptions: typeof NodeAPI.nodeSafeFetchOptions = Object.freeze({
    validateDns: false,
    wrapFetch: (fetch: typeof globalThis.fetch) => node().nodeSafeFetchOptions.wrapFetch!(fetch),
});
export const finesoftFrontViteConfig: typeof ViteAPI.finesoftFrontViteConfig = (...args) =>
    vite().finesoftFrontViteConfig(...args);
export const generateControllerTypes: typeof ViteAPI.generateControllerTypes = (...args) =>
    typegen().generateControllerTypes(...args);
export const generateFrontTypes: typeof TypegenAPI.generateFrontTypes = (...args) =>
    typegen().generateFrontTypes(...args);
export const autoAdapter: typeof ViteAPI.autoAdapter = (...args) => vite().autoAdapter(...args);
export const cloudflareAdapter: typeof ViteAPI.cloudflareAdapter = (...args) =>
    vite().cloudflareAdapter(...args);
export const netlifyAdapter: typeof ViteAPI.netlifyAdapter = (...args) =>
    vite().netlifyAdapter(...args);
export const nodeAdapter: typeof ViteAPI.nodeAdapter = (...args) => vite().nodeAdapter(...args);
export const staticAdapter: typeof ViteAPI.staticAdapter = (...args) =>
    vite().staticAdapter(...args);
export const vercelAdapter: typeof ViteAPI.vercelAdapter = (...args) =>
    vite().vercelAdapter(...args);
export const resolveAdapter: typeof ViteAPI.resolveAdapter = (...args) =>
    vite().resolveAdapter(...args);
export const generateProxyCode: typeof ViteAPI.generateProxyCode = (...args) =>
    vite().generateProxyCode(...args);
