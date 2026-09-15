import { deserializeNavigation } from "./navigation/serialization";
import { collectAllLeaves } from "./navigation/operations";
import type { PrefetchedIntent } from "./prefetched-intents/prefetched-intents";

export const FRAMEWORK_PROTOCOL_VERSION = 1;
export const NAVIGATION_WIRE_INTENT = "@finesoft/navigation-tree";
declare const __FINESOFT_BUILD_ID__: string | undefined;
/** Injected by finesoftFrontViteConfig in both bundles. Custom bundlers supply buildId explicitly. */
export function getFrameworkBuildId(): string {
    return typeof __FINESOFT_BUILD_ID__ === "string" ? __FINESOFT_BUILD_ID__ : "unbundled";
}
export interface WireEnvelope {
    readonly protocolVersion: number;
    readonly buildId: string;
    readonly payload: PrefetchedIntent[];
}
export type WireDecodeResult =
    | { readonly status: "ready"; readonly data: PrefetchedIntent[] }
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
    if (!Array.isArray(value.payload)) return invalid;
    const ids = new Set<string>();
    let treeEntries: Map<string, string> | undefined;
    for (const item of value.payload) {
        if (
            !record(item) ||
            !record(item.intent) ||
            typeof item.intent.id !== "string" ||
            !item.intent.id ||
            !record(item.data)
        )
            return invalid;
        if (item.intent.params !== undefined && !record(item.intent.params)) return invalid;
        if (item.intent.id === NAVIGATION_WIRE_INTENT) {
            if (treeEntries || item.data.__finesoftNavigationTree !== true) return invalid;
            try {
                treeEntries = new Map(
                    collectAllLeaves(deserializeNavigation(item.data.tree)).map((leaf) => [
                        leaf.entryId,
                        leaf.intent,
                    ]),
                );
            } catch {
                return invalid;
            }
        } else {
            if (typeof item.entryId !== "string" || !item.entryId.trim() || ids.has(item.entryId))
                return invalid;
            ids.add(item.entryId);
        }
    }
    if (treeEntries)
        for (const item of value.payload) {
            if (
                item.intent.id !== NAVIGATION_WIRE_INTENT &&
                treeEntries.get(item.entryId) !== item.intent.id
            )
                return invalid;
        }
    return { status: "ready", data: value.payload as PrefetchedIntent[] };
}
