/**
 * URL 路由器 — URL pattern → Intent + FlowAction
 */

import { makeFlowAction, type FlowAction } from "../actions/types";
import type { Intent } from "../intents/types";
import type { AfterLoadGuard, BeforeLoadGuard } from "../middleware/types";
import type { QuerySchemaMap } from "./params/infer";
import { isMultiValueSchema } from "./params/multi";
import { runStandard, type ParamSchema } from "./params/standard";

/** 路由匹配结果 */
export interface RouteMatch {
    intent: Intent;
    action: FlowAction;
    renderMode?: string;
    /** 该路由绑定的 beforeLoad 守卫 */
    beforeGuards?: BeforeLoadGuard[];
    /** 该路由绑定的 afterLoad 守卫 */
    afterGuards?: AfterLoadGuard[];
}

/** 路由添加选项 */
export interface RouteAddOptions {
    renderMode?: string;
    beforeGuards?: BeforeLoadGuard[];
    afterGuards?: AfterLoadGuard[];
    paramCodecs?: Record<string, ParamSchema>;
    queryCodecs?: QuerySchemaMap;
}

interface InternalRouteDefinition {
    pattern: string;
    intentId: string;
    regex: RegExp;
    paramNames: string[];
    renderMode?: string;
    beforeGuards?: BeforeLoadGuard[];
    afterGuards?: AfterLoadGuard[];
    paramCodecs?: Record<string, ParamSchema>;
    queryCodecs?: QuerySchemaMap;
}

function createNullPrototypeRecord<V = string>(source?: Record<string, V>): Record<string, V> {
    // 通过一个无原型的目标对象进行复制，这样 URL 控制的键就保持为惰性数据。
    return Object.assign(Object.create(null), source) as Record<string, V>;
}

export class Router {
    private routes: InternalRouteDefinition[] = [];

    constructor(private readonly debug?: (message: string) => void) {}

    /** 添加路由规则 */
    add(pattern: string, intentId: string, renderModeOrOptions?: string | RouteAddOptions): this {
        const opts: RouteAddOptions =
            typeof renderModeOrOptions === "string"
                ? { renderMode: renderModeOrOptions }
                : (renderModeOrOptions ?? {});

        const paramNames: string[] = [];

        // 将 /:param 和 /:param? 替换为捕获组，其余部分转义正则元字符
        const regexStr = pattern
            .split(/(\/:[\w]+\??)/)
            .map((segment) => {
                const paramMatch = segment.match(/^\/:(\w+)(\?)?$/);
                if (paramMatch) {
                    if (paramNames.includes(paramMatch[1])) {
                        throw new Error(
                            `[Router] Duplicate parameter name ":${paramMatch[1]}" in pattern "${pattern}"`,
                        );
                    }
                    paramNames.push(paramMatch[1]);
                    return paramMatch[2] ? "(?:/([^/]+))?" : "/([^/]+)";
                }
                // 非参数片段：转义所有正则特殊字符
                return segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
            })
            .join("");

        this.routes.push({
            pattern,
            intentId,
            regex: new RegExp(`^${regexStr}/?$`),
            paramNames,
            renderMode: opts.renderMode,
            beforeGuards: opts.beforeGuards,
            afterGuards: opts.afterGuards,
            paramCodecs: opts.paramCodecs,
            queryCodecs: opts.queryCodecs,
        });

        return this;
    }

    /** 解析 URL → RouteMatch（含参数校验；校验失败则 fall-through 到下一条路由） */
    async resolve(urlOrPath: string): Promise<RouteMatch | null> {
        const { path, queryParams, searchParams } = this.parseUrl(urlOrPath);

        for (const route of this.routes) {
            const match = path.match(route.regex);
            if (!match) continue;

            const params = createNullPrototypeRecord<unknown>();
            let ok = true;

            // —— path 参数 ——
            for (let i = 0; i < route.paramNames.length; i++) {
                const name = route.paramNames[i];
                const raw = match[i + 1];
                const codec = route.paramCodecs?.[name];
                if (codec) {
                    const r = await runStandard(codec, raw);
                    if (!r.ok) {
                        this.debug?.(
                            `[Router] route "${route.pattern}" skipped: path param "${name}" failed validation: ${r.issues[0]?.message ?? "invalid"}`,
                        );
                        ok = false;
                        break;
                    }
                    if (r.value !== undefined) params[name] = r.value;
                } else if (raw) {
                    params[name] = raw;
                }
            }
            if (!ok) continue;

            // —— query 参数：声明了 codec 的走校验 ——
            if (route.queryCodecs) {
                for (const name of Object.keys(route.queryCodecs)) {
                    const codec = route.queryCodecs[name];
                    // 多值 codec（list）取该 key 的全部取值；单值 codec 取单值。
                    const raw = isMultiValueSchema(codec)
                        ? searchParams.getAll(name)
                        : queryParams[name];
                    const r = await runStandard(codec, raw);
                    if (!r.ok) {
                        this.debug?.(
                            `[Router] route "${route.pattern}" skipped: query param "${name}" failed validation: ${r.issues[0]?.message ?? "invalid"}`,
                        );
                        ok = false;
                        break;
                    }
                    if (r.value !== undefined) params[name] = r.value;
                }
            }
            if (!ok) continue;

            // —— 未声明 codec 的 query 参数：保持 string（向后兼容） ——
            // 批量并入（Object.fromEntries + Object.assign），避免 URL 受控键的动态属性写
            // （CodeQL remote-property-injection sink）；params 已是 null 原型，本无污染面。
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
                beforeGuards: route.beforeGuards,
                afterGuards: route.afterGuards,
            };
        }

        return null;
    }

    /** 获取所有已注册的路由 */
    getRoutes(): string[] {
        return this.routes.map((r) => `${r.pattern} → ${r.intentId}`);
    }

    private parseUrl(url: string): {
        path: string;
        queryParams: Record<string, string>;
        searchParams: URLSearchParams;
    } {
        try {
            const parsed = new URL(url, "http://localhost");
            // 查询参数名称来自 URL，因此将它们保存在无原型对象中，以避免潜在的原型污染问题。
            // queryParams 为单值（重复 key 取末值，供未声明 codec 的回填）；searchParams 保留
            // 全部取值，供多值（list）codec 调 getAll 取数组。
            const params = createNullPrototypeRecord(
                Object.fromEntries(parsed.searchParams) as Record<string, string>,
            );
            return {
                path: parsed.pathname,
                queryParams: params,
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
