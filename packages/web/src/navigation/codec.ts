import { stableStringify } from "@finesoft/core";
import type { RouteParams } from "../router/types";
import { findNode, resolveActivePath } from "./operations";
import { deserializeNavigation, serializeNavigation } from "./serialization";
import { NavigationError, type NavigationNode } from "./types";

export interface NavigationRouterLike {
    reverse(intentId: string, params: RouteParams): string | undefined;
}
export interface NavigationCodec {
    encode(tree: NavigationNode, router: NavigationRouterLike): string;
    decode(url: string, router: NavigationRouterLike): NavigationNode | undefined;
}
export const DEFAULT_NAV_PARAM = "__nav";
export function encodeNavigationTreeParam(tree: NavigationNode): string {
    const bytes = new TextEncoder().encode(stableStringify(serializeNavigation(tree)));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeNavigationTreeParam(encoded: string): NavigationNode {
    try {
        const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return deserializeNavigation(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
    } catch {
        throw new NavigationError("Invalid navigation parameter");
    }
}
function activeUrl(tree: NavigationNode, router: NavigationRouterLike): string {
    const target = findNode(tree, resolveActivePath(tree));
    return target?.kind === "leaf"
        ? (target.url ?? router.reverse(target.intent, target.params) ?? "/")
        : "/";
}
export function createActiveLeafCodec(): NavigationCodec {
    return {
        encode: activeUrl,
        decode(url) {
            const value = new URL(url, "http://localhost").searchParams.get(DEFAULT_NAV_PARAM);
            return value ? decodeNavigationTreeParam(value) : undefined;
        },
    };
}
export interface FullStateCodecOptions {
    readonly param?: string;
}
export function createFullStateCodec(options: FullStateCodecOptions = {}): NavigationCodec {
    const param = options.param ?? DEFAULT_NAV_PARAM;
    return {
        encode(tree, router) {
            const url = new URL(activeUrl(tree, router), "http://localhost");
            url.searchParams.set(param, encodeNavigationTreeParam(tree));
            return url.pathname + url.search;
        },
        decode(url) {
            const value = new URL(url, "http://localhost").searchParams.get(param);
            return value ? decodeNavigationTreeParam(value) : undefined;
        },
    };
}
