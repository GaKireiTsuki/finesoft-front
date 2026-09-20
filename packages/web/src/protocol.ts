import { deserializeNavigation } from "./navigation/serialization";
import type { SerializedNavigation } from "./navigation/serialization";
import { collectAllLeaves } from "./navigation/operations";
import type { PrefetchedIntent } from "./prefetched-intents/prefetched-intents";

export const FRAMEWORK_PROTOCOL_VERSION = 2;
declare const __FINESOFT_BUILD_ID__: string | undefined;
export function getFrameworkBuildId(): string {
    return typeof __FINESOFT_BUILD_ID__ === "string" ? __FINESOFT_BUILD_ID__ : "unbundled";
}
export interface WebHydration {
    readonly tree?: SerializedNavigation;
    readonly pages: PrefetchedIntent[];
}
export interface WireEnvelope {
    readonly protocolVersion: number;
    readonly buildId: string;
    readonly payload: WebHydration;
}
export type WireDecodeResult =
    | { readonly status: "ready"; readonly data: WebHydration }
    | {
          readonly status: "fresh-load";
          readonly code:
              | "missing"
              | "invalid-json"
              | "protocol-mismatch"
              | "build-mismatch"
              | "invalid-payload";
      };
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function decodeWireEnvelope(
    value: unknown,
    buildId = getFrameworkBuildId(),
): WireDecodeResult {
    const invalid = { status: "fresh-load", code: "invalid-payload" } as const;
    if (!record(value)) return invalid;
    if (value.protocolVersion !== FRAMEWORK_PROTOCOL_VERSION)
        return { status: "fresh-load", code: "protocol-mismatch" };
    if (value.buildId !== buildId) return { status: "fresh-load", code: "build-mismatch" };
    if (!record(value.payload) || !Array.isArray(value.payload.pages) || !value.payload.tree)
        return invalid;
    let leaves;
    try {
        leaves = collectAllLeaves(deserializeNavigation(value.payload.tree));
    } catch {
        return invalid;
    }
    const entries = new Map(leaves.map((leaf) => [leaf.entryId, leaf]));
    const seen = new Set<string>();
    for (const page of value.payload.pages) {
        if (
            !record(page) ||
            typeof page.entryId !== "string" ||
            seen.has(page.entryId) ||
            !record(page.intent) ||
            !record(page.data)
        )
            return invalid;
        const leaf = entries.get(page.entryId);
        if (
            !leaf ||
            leaf.intent !== page.intent.id ||
            (page.intent.params !== undefined && !record(page.intent.params))
        )
            return invalid;
        if (typeof page.data.pageType !== "string" || !page.data.pageType) return invalid;
        seen.add(page.entryId);
    }
    return { status: "ready", data: value.payload as unknown as WebHydration };
}
