/**
 * Portable pathname patterns shared by browser-facing routers and HTTP hosts.
 * A pathname is matched while still encoded, then each captured segment is
 * decoded exactly once. This keeps an encoded slash inside one parameter.
 */

export type PathParams = Record<string, string | undefined>;

export interface PathParameterDescriptor {
    readonly name: string;
    readonly optional: boolean;
}

export interface PathDescriptor {
    readonly pattern: string;
    readonly parameters: readonly PathParameterDescriptor[];
    /** Parameter names are deliberately excluded so equivalent route shapes compare equal. */
    readonly shape: string;
}

export interface CompiledPath {
    readonly descriptor: PathDescriptor;
    /** Returns null for a structural mismatch or malformed percent encoding. */
    match(pathname: string): PathParams | null;
    /** Returns undefined when a required parameter cannot be represented. */
    reverse(params: Readonly<Record<string, unknown>>): string | undefined;
}

const PARAMETER_SEGMENT = /^:([A-Za-z0-9_]+)(\?)?$/;

function createParams(): PathParams {
    return Object.create(null) as PathParams;
}

function stringify(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string") return value;
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
    if (typeof value === "boolean") return String(value);
    return undefined;
}

/** Compile the small, segment-oriented `/:name` / `/:name?` path language. */
export function compilePath(pattern: string): CompiledPath {
    if (!pattern.startsWith("/") || pattern.includes("#"))
        throw new Error(`Invalid path pattern "${pattern}"`);

    const parameters: PathParameterDescriptor[] = [];
    const names = new Set<string>();
    const segments = pattern.split("/");
    const source = segments
        .map((segment, index) => {
            if (index === 0) return "";
            const parameter = PARAMETER_SEGMENT.exec(segment);
            if (!parameter) {
                if (segment.includes("?")) throw new Error(`Invalid path pattern "${pattern}"`);
                return `/${segment.replace(/[.+^${}()|[\]\\]/g, "\\$&")}`;
            }
            const [, name, optional] = parameter;
            if (names.has(name))
                throw new Error(`Duplicate parameter name ":${name}" in pattern "${pattern}"`);
            names.add(name);
            parameters.push({ name, optional: optional === "?" });
            return optional ? "(?:/([^/]+))?" : "/([^/]+)";
        })
        .join("");
    const regex = new RegExp(`^${source || "/"}/?$`);
    const descriptor: PathDescriptor = Object.freeze({
        pattern,
        parameters: Object.freeze(parameters.map((parameter) => Object.freeze(parameter))),
        shape: segments
            .map((segment, index) => {
                if (index === 0) return "";
                const parameter = PARAMETER_SEGMENT.exec(segment);
                return parameter ? `/:${parameter[2] ? "?" : ""}` : `/${segment}`;
            })
            .join(""),
    });

    return Object.freeze({
        descriptor,
        match(pathname: string) {
            const result = regex.exec(pathname);
            if (!result) return null;
            const params = createParams();
            for (let index = 0; index < parameters.length; index++) {
                const raw = result[index + 1];
                try {
                    params[parameters[index].name] =
                        raw === undefined ? undefined : decodeURIComponent(raw);
                } catch {
                    return null;
                }
            }
            return params;
        },
        reverse(params: Readonly<Record<string, unknown>>) {
            const segments = pattern.split("/");
            const output: string[] = [];
            for (let index = 1; index < segments.length; index++) {
                const segment = segments[index];
                const parameter = PARAMETER_SEGMENT.exec(segment);
                if (!parameter) {
                    output.push(segment);
                    continue;
                }
                const value = stringify(params[parameter[1]]);
                if (value === undefined) {
                    if (parameter[2]) continue;
                    return undefined;
                }
                output.push(encodeURIComponent(value));
            }
            return `/${output.join("/")}`;
        },
    });
}
