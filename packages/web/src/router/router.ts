/** URL router — route metadata layered over Core's portable pathname matcher. */

import {
    compilePath,
    isMultiValueSchema,
    runStandard,
    type CompiledPath,
    type PathDescriptor,
} from "@finesoft/core";
import { makeFlowAction, type FlowAction } from "../actions/types";
import type { Intent, ParamSchema, QuerySchemaMap } from "@finesoft/core";
import type { AfterLoadGuard, BeforeLoadGuard } from "../middleware/types";

export interface RouteMatch {
    intent: Intent;
    action: FlowAction;
    cache?: "public";
    renderMode?: string;
    beforeGuards?: BeforeLoadGuard[];
    afterGuards?: AfterLoadGuard[];
}
export interface RouteAddOptions {
    cache?: "public";
    renderMode?: string;
    beforeGuards?: BeforeLoadGuard[];
    afterGuards?: AfterLoadGuard[];
    paramCodecs?: Record<string, ParamSchema>;
    queryCodecs?: QuerySchemaMap;
}
/** The structured, portable part of a route declaration. */
export interface RouteDefinition {
    readonly pattern: string;
    readonly intentId: string;
    readonly path: PathDescriptor;
}
interface InternalRouteDefinition extends RouteDefinition {
    readonly compiled: CompiledPath;
    readonly cache?: "public";
    readonly renderMode?: string;
    readonly beforeGuards?: BeforeLoadGuard[];
    readonly afterGuards?: AfterLoadGuard[];
    readonly paramCodecs?: Record<string, ParamSchema>;
    readonly queryCodecs?: QuerySchemaMap;
}
function createNullPrototypeRecord<V = unknown>(source?: Record<string, V>): Record<string, V> {
    return Object.assign(Object.create(null), source) as Record<string, V>;
}
export class Router {
    private routes: InternalRouteDefinition[] = [];
    private sealed = false;
    constructor(private readonly debug?: (message: string) => void) {}
    seal(): this {
        this.sealed = true;
        return this;
    }
    add(pattern: string, intentId: string, renderModeOrOptions?: string | RouteAddOptions): this {
        if (this.sealed) throw new Error("Router is sealed");
        const options: RouteAddOptions =
            typeof renderModeOrOptions === "string"
                ? { renderMode: renderModeOrOptions }
                : (renderModeOrOptions ?? {});
        const compiled = compilePath(pattern);
        this.routes.push({ pattern, intentId, path: compiled.descriptor, compiled, ...options });
        return this;
    }
    async resolve(urlOrPath: string): Promise<RouteMatch | null> {
        const { path, queryParams, searchParams } = this.parseUrl(urlOrPath);
        for (const route of this.routes) {
            const pathParams = route.compiled.match(path);
            if (!pathParams) continue;
            const params = createNullPrototypeRecord<unknown>(pathParams);
            let valid = true;
            for (const parameter of route.path.parameters) {
                const codec = route.paramCodecs?.[parameter.name];
                if (!codec) continue;
                const result = await runStandard(codec, pathParams[parameter.name]);
                if (!result.ok) {
                    this.debug?.(
                        `[Router] route "${route.pattern}" skipped: path param "${parameter.name}" failed validation: ${result.issues[0]?.message ?? "invalid"}`,
                    );
                    valid = false;
                    break;
                }
                params[parameter.name] = result.value;
            }
            if (!valid) continue;
            if (route.queryCodecs)
                for (const name of Object.keys(route.queryCodecs)) {
                    const codec = route.queryCodecs[name];
                    const raw = isMultiValueSchema(codec)
                        ? searchParams.getAll(name)
                        : queryParams[name];
                    const result = await runStandard(codec, raw);
                    if (!result.ok) {
                        this.debug?.(
                            `[Router] route "${route.pattern}" skipped: query param "${name}" failed validation: ${result.issues[0]?.message ?? "invalid"}`,
                        );
                        valid = false;
                        break;
                    }
                    params[name] = result.value;
                }
            if (!valid) continue;
            Object.assign(
                params,
                Object.fromEntries(
                    Object.entries(queryParams).filter(
                        ([key]) => !(key in params) && !route.queryCodecs?.[key],
                    ),
                ),
            );
            return {
                intent: { id: route.intentId, params },
                action: makeFlowAction(urlOrPath),
                renderMode: route.renderMode,
                cache: route.cache,
                beforeGuards: route.beforeGuards,
                afterGuards: route.afterGuards,
            };
        }
        return null;
    }
    hasIntent(intentId: string): boolean {
        return this.routes.some((route) => route.intentId === intentId);
    }
    getDefinitions(): readonly RouteDefinition[] {
        return this.routes.map(({ pattern, intentId, path }) =>
            Object.freeze({ pattern, intentId, path }),
        );
    }
    /** Compatibility summary for callers awaiting their structured-route migration. */
    getRoutes(): string[] {
        return this.routes.map((route) => `${route.pattern} → ${route.intentId}`);
    }
    reverse(intentId: string, params: Readonly<Record<string, unknown>>): string | undefined {
        const matches = this.routes
            .filter((route) => route.intentId === intentId)
            .map((route) => ({ route, path: route.compiled.reverse(params) }))
            .filter(
                (match): match is { route: InternalRouteDefinition; path: string } =>
                    match.path !== undefined,
            );
        if (matches.length > 1)
            throw new Error(`Ambiguous route for ${intentId}; provide the matched URL`);
        const match = matches[0];
        if (!match) return undefined;
        const consumed = new Set(match.route.path.parameters.map((parameter) => parameter.name));
        const query = new URLSearchParams();
        for (const key of Object.keys(params).sort()) {
            if (consumed.has(key)) continue;
            const value = params[key];
            if (value === undefined || value === null) continue;
            if (
                typeof value === "string" ||
                typeof value === "boolean" ||
                (typeof value === "number" && Number.isFinite(value))
            )
                query.set(key, String(value));
        }
        const serialized = query.toString();
        return serialized ? `${match.path}?${serialized}` : match.path;
    }
    private parseUrl(url: string): {
        path: string;
        queryParams: Record<string, string>;
        searchParams: URLSearchParams;
    } {
        try {
            const parsed = new URL(url, "http://localhost");
            return {
                path: parsed.pathname,
                queryParams: createNullPrototypeRecord(
                    Object.fromEntries(parsed.searchParams) as Record<string, string>,
                ),
                searchParams: parsed.searchParams,
            };
        } catch {
            return {
                path: url.split("?")[0].split("#")[0],
                queryParams: createNullPrototypeRecord(),
                searchParams: new URLSearchParams(),
            };
        }
    }
}
