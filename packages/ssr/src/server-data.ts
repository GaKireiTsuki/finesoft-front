import {
    BASE_PAGE_FIELDS,
    getPublicFields,
    FRAMEWORK_PROTOCOL_VERSION,
    getFrameworkBuildId,
    type PrefetchedIntent,
    type WebHydration,
    serializeNavigation,
    deserializeNavigation,
    type PublicProjection,
    type PublicValueCodec,
} from "@finesoft/web";

export interface SerializeServerDataOptions {
    readonly buildId?: string;
    readonly onUnmarkedPage?: "base-fields" | "strict";
}
const MATERIALIZED = Symbol("materialized-public-data");
/** Copy declared public data now; never keep request-backed objects/getters in a response. */
export function materializeServerData(
    data: WebHydration,
    options: SerializeServerDataOptions = {},
): WebHydration {
    const materialized = (data as unknown as Record<symbol, unknown>)[MATERIALIZED];
    if (materialized) {
        if (options.onUnmarkedPage === "strict" && materialized === "unmarked")
            throw Error("markPublic-required");
        return data;
    }
    let allMarked = true;
    const pages = data.pages.map((entry) => {
        const marked = getPublicFields(entry.data) !== null;
        allMarked &&= marked;
        if (options.onUnmarkedPage === "strict" && !marked) throw Error("markPublic-required");
        try {
            return {
                ...(entry.entryId ? { entryId: entry.entryId } : {}),
                // Intent is an explicit framework protocol DTO, independently of Page field policy.
                intent: {
                    id: entry.intent.id,
                    ...(entry.intent.params === undefined
                        ? {}
                        : { params: cloneJson(entry.intent.params, new Set()) }),
                } as PrefetchedIntent["intent"],
                data: project(entry.data, undefined, true, new Set()),
            };
        } catch {
            // Do not let an arbitrary codec/getter exception reach default server diagnostics.
            throw Error("public-materialization-failed");
        }
    });
    const result: WebHydration = {
        tree: data.tree && serializeNavigation(deserializeNavigation(data.tree)),
        pages,
    };
    Object.defineProperty(result, MATERIALIZED, { value: allMarked ? "marked" : "unmarked" });
    return result;
}
/** The shared response assembler remains the single HTML-safe wire serializer owner. */
export function serializeServerData(
    data: WebHydration,
    options: SerializeServerDataOptions = {},
): string {
    const json = JSON.stringify({
        protocolVersion: FRAMEWORK_PROTOCOL_VERSION,
        buildId: options.buildId ?? getFrameworkBuildId(),
        payload: materializeServerData(data, options),
    });
    const escapes: Record<string, string> = {
        "<": "\\u003C",
        ">": "\\u003E",
        "/": "\\u002F",
        "&": "\\u0026",
        "\u2028": "\\u2028",
        "\u2029": "\\u2029",
    };
    return json.replace(/[<>/&\u2028\u2029]/g, (value) => escapes[value]!);
}
function scalar(value: unknown): boolean {
    return (
        value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
    );
}
function isCodec(value: PublicProjection | PublicValueCodec): value is PublicValueCodec {
    return value.kind === "codec" && typeof value.encode === "function";
}
function project(
    value: unknown,
    declaration: true | PublicProjection | PublicValueCodec | undefined,
    base: boolean,
    ancestors: Set<object>,
): unknown {
    if (declaration && declaration !== true && isCodec(declaration))
        return cloneJson(declaration.encode(value), new Set());
    if (scalar(value)) return value;
    if (typeof value !== "object" || value === null) throw Error("invalid-public-value");
    if (ancestors.has(value)) throw Error("cyclic-public-value");
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            if (!declaration || declaration === true) {
                // An undeclared array does not grant permission to enumerate its contents.
                if (!value.every((item) => getPublicFields(item) !== null)) return [];
            }
            return value.map((item) => project(item, declaration, false, ancestors));
        }
        const marker = declaration && declaration !== true ? declaration : getPublicFields(value);
        const projection =
            marker && marker !== true && !Array.isArray(marker)
                ? (marker as PublicProjection)
                : undefined;
        const fields =
            marker === true
                ? Object.keys(value)
                : [
                      ...(base ? BASE_PAGE_FIELDS : []),
                      ...(Array.isArray(marker)
                          ? marker
                          : projection
                            ? Object.keys(projection)
                            : []),
                  ];
        const result: Record<string, unknown> = Object.create(null);
        for (const field of new Set(fields)) {
            if (!(field in value)) continue;
            const item = project(
                (value as Record<string, unknown>)[field],
                projection?.[field],
                false,
                ancestors,
            );
            if (item !== undefined) result[field] = item;
        }
        return result;
    } finally {
        ancestors.delete(value);
    }
}
/** Explicit codecs may emit JSON records/arrays; methods, class instances and cycles are rejected. */
function cloneJson(value: unknown, ancestors: Set<object>): unknown {
    if (scalar(value)) return value;
    if (typeof value !== "object" || value === null || ancestors.has(value))
        throw Error("invalid-codec-value");
    if (
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
    )
        throw Error("invalid-codec-value");
    ancestors.add(value);
    try {
        if (Array.isArray(value)) return value.map((item) => cloneJson(item, ancestors));
        const result: Record<string, unknown> = Object.create(null);
        for (const field of Object.keys(value)) {
            const item = cloneJson((value as Record<string, unknown>)[field], ancestors);
            if (item !== undefined) result[field] = item;
        }
        return result;
    } finally {
        ancestors.delete(value);
    }
}
