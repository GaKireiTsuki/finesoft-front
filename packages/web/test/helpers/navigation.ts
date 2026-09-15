import { leaf as createLeaf } from "../../src/navigation/nodes";
import { entryKey } from "../../src/navigation/keys";
import type { RouteParams } from "../../src/router/types";

/** Structural fixtures intentionally name their existing entries. Identity allocation is tested separately. */
export function leaf(
    intent: string,
    params: RouteParams = {},
    options: { entryId?: string; url?: string } = {},
) {
    return createLeaf(intent, params, { entryId: entryKey(intent, params), ...options });
}

/** Compare tree topology/targets independently of automatically allocated entry identity. */
export function treeShape(value: object): object;
export function treeShape(value: unknown): unknown;
export function treeShape(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(treeShape);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => key !== "entryId" && key !== "url")
            .map(([key, nested]) => [key, treeShape(nested)]),
    );
}
