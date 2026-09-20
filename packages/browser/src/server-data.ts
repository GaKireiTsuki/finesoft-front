import { PrefetchedIntents, decodeWireEnvelope, type WireDecodeResult } from "@finesoft/web";
export interface ServerDataSource {
    /** An explicitly selected script, scoped by the caller to this app instance. */
    readonly script: Pick<HTMLScriptElement, "textContent" | "parentNode"> | null;
    readonly buildId?: string;
    readonly onFallback?: (
        code: Extract<WireDecodeResult, { status: "fresh-load" }>["code"],
    ) => void;
}
export function deserializeServerData(source: ServerDataSource): WireDecodeResult {
    const script = source.script;
    if (!script?.textContent) return { status: "fresh-load", code: "missing" };
    script.parentNode?.removeChild(script as Node);
    let value: unknown;
    try {
        value = JSON.parse(script.textContent);
    } catch {
        return { status: "fresh-load", code: "invalid-json" };
    }
    return decodeWireEnvelope(value, source.buildId);
}
export function createPrefetchedIntentsFromDom(source: ServerDataSource): PrefetchedIntents {
    const result = deserializeServerData(source);
    if (result.status === "ready") return PrefetchedIntents.fromArray(result.data.pages);
    source.onFallback?.(result.code);
    return PrefetchedIntents.empty();
}
