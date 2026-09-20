import { ExecutionError, type ExecutionHandle, type Intent } from "@finesoft/core";
import { getWebPlan, WEB_EXECUTION, type WebExecutionState } from "./definition";
import { runBeforeLoadGuards, runAfterLoadGuards } from "../middleware/pipeline";
import { bindExecutionCancellation } from "./execution";
import type { WebRuntime } from "./runtime";
import type { BeforeLoadGuard, AfterLoadGuard, NavigationContext } from "../middleware/types";
import type { BasePage } from "../models/page";
import type { LeafNode } from "../navigation/types";
import { leaf } from "../navigation/nodes";
import { createActiveLeafCodec } from "../navigation/codec";
import type { RouteMatch } from "../router/router";

export interface LoadPageOptions {
    readonly web: WebRuntime;
    readonly target: string | LeafNode;
    readonly execution?: ExecutionHandle;
    readonly signal?: AbortSignal;
    readonly retained?: BasePage;
    readonly entryId?: string;
    readonly createContext?: (input: {
        url: string;
        intent: Intent;
        execution: ExecutionHandle;
    }) => NavigationContext;
    readonly beforeLoad?: readonly BeforeLoadGuard[];
    readonly afterLoad?: readonly AfterLoadGuard[];
}
export type PageLoadResult =
    | {
          readonly kind: "page";
          readonly page: BasePage;
          readonly target: LeafNode;
          readonly match?: RouteMatch;
          readonly rewriteUrl?: string;
      }
    | { readonly kind: "redirect"; readonly url: string; readonly status: number }
    | { readonly kind: "deny"; readonly status: number; readonly message: string };

/** One page pipeline, shared by URL, SSR and every visible tree destination. */
export async function loadPage(options: LoadPageOptions): Promise<PageLoadResult> {
    const { web } = options;
    const owned = !options.execution;
    const execution = options.execution ?? web.createExecution({ signal: options.signal });
    const unbind = bindExecutionCancellation(execution, options.signal);
    const check = () => {
        if (execution.context.signal.aborted || options.signal?.aborted)
            throw new ExecutionError("cancelled");
    };
    try {
        let target = options.target;
        let entryId = typeof target === "string" ? options.entryId : target.entryId;
        let retained = options.retained;
        for (let depth = 0; depth < 5; depth++) {
            check();
            const direct = typeof target !== "string" ? target : undefined;
            const hasRoutes = direct && web.router.hasIntent(direct.intent);
            const url =
                typeof target === "string"
                    ? target
                    : (target.url ??
                      (hasRoutes ? createActiveLeafCodec().encode(target, web.router) : ""));
            const match: RouteMatch | null =
                direct && !direct.url && !hasRoutes
                    ? {
                          intent: { id: direct.intent, params: direct.params },
                          action: { kind: "flow" as const, url: "" },
                      }
                    : await web.router.resolve(url);
            check();
            if (!match) return { kind: "deny", status: 404, message: "Page not found" };
            if (direct && match.intent.id !== direct.intent)
                throw new ExecutionError("configuration", "Leaf URL does not match its intent");
            const destination =
                typeof target === "string"
                    ? leaf(match.intent.id, match.intent.params ?? {}, {
                          url,
                          entryId: entryId ?? web.prefetchedIntents.entryIdFor(match.intent),
                      })
                    : !hasRoutes && !target.url
                      ? target
                      : {
                            ...target,
                            intent: match.intent.id,
                            params: match.intent.params ?? {},
                            url,
                        };
            entryId = destination.entryId;
            const context = options.createContext?.({ url, intent: match.intent, execution }) ?? {
                url,
                path: new URL(url, "http://localhost").pathname,
                intent: match.intent,
                params: match.intent.params ?? {},
                container: execution.context.container,
                isServer: true,
                getCookie: () => undefined,
                getHeader: () => undefined,
            };
            const navContext = {
                ...context,
                container: execution.context.container,
                signal: options.signal
                    ? AbortSignal.any([execution.context.signal, options.signal])
                    : execution.context.signal,
            };
            const before = await runBeforeLoadGuards(
                [
                    ...(web.definition.beforeLoad ?? []),
                    ...(match.beforeGuards ?? []),
                    ...(options.beforeLoad ?? []),
                ],
                navContext,
            );
            check();
            if (before.kind === "rewrite") {
                target = before.url;
                retained = undefined;
                continue;
            }
            if (before.kind !== "next") return before;
            let page: BasePage;
            try {
                const operation = getWebPlan(web.definition).operations.get(match.intent.id);
                if (!operation) throw new ExecutionError("not_found");
                const params = { ...match.intent.params };
                const state = execution.context.bindings[WEB_EXECUTION] as WebExecutionState;
                state.entryIds.set(params, destination.entryId);
                if (retained) state.retained.set(params, retained);
                page = await execution.execute(operation, params);
            } catch (error) {
                if (error instanceof ExecutionError && error.code === "cancelled") throw error;
                return {
                    kind: "deny",
                    status: error instanceof ExecutionError ? error.status : 500,
                    message: error instanceof ExecutionError ? error.message : "Internal error",
                };
            }
            check();
            const after = await runAfterLoadGuards(
                [
                    ...(web.definition.afterLoad ?? []),
                    ...(match.afterGuards ?? []),
                    ...(options.afterLoad ?? []),
                ],
                { ...navContext, page },
            );
            check();
            if (after.kind === "deny" || after.kind === "redirect") return after;
            return {
                kind: "page",
                page,
                target: destination,
                match,
                ...(after.kind === "rewrite" ? { rewriteUrl: after.url } : {}),
            };
        }
        throw new ExecutionError("configuration", "Page rewrite recursion depth exceeded");
    } finally {
        unbind();
        if (owned) await execution.dispose();
    }
}
