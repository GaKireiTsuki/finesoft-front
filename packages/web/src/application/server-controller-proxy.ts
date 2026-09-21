import { ExecutionError, type ExecutionContext } from "@finesoft/core";
import type { BasePage } from "../models/page";
import type { ControllerContext } from "./controller-context";
import type { RouteParams } from "../router/types";
import type { DenyResult, RedirectResult } from "../middleware/types";
import { decodeWireEnvelope } from "../protocol";
import { deserializeNavigation } from "../navigation/serialization";
import { collectAllLeaves } from "../navigation/operations";
import type { LeafNode } from "../navigation/types";

export const remotePages = new WeakMap<BasePage, { target: LeafNode; rewriteUrl?: string }>();

export const SERVER_CONTROLLER_PATH = "/__finesoft/controller";
export interface ServerControllerRequest {
    readonly intent: string;
    readonly params: RouteParams;
    readonly query: RouteParams;
    readonly url: string;
}
export class RemoteNavigationResult extends ExecutionError {
    constructor(readonly result: DenyResult | RedirectResult) {
        super("denied", "Server controller navigation result");
    }
}
/** The compiler replaces a complete server controller module with these inert references. */
export class ServerControllerProxy {
    async perform(
        params: RouteParams,
        execution: ExecutionContext,
        query: RouteParams = {},
    ): Promise<BasePage> {
        const context = execution as ControllerContext;
        if (!context.intent || context.isServer)
            throw new ExecutionError(
                "configuration",
                "Server controller proxy requires browser navigation",
            );
        const response = await context.fetch(SERVER_CONTROLLER_PATH, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json", "x-finesoft-controller": "1" },
            body: JSON.stringify({
                intent: context.intent.id,
                params,
                query,
                url: context.url,
            } satisfies ServerControllerRequest),
        });
        if (!response.ok) throw new ExecutionError(response.status === 403 ? "denied" : "failure");
        const result = await response.json();
        if (result.redirect)
            throw new RemoteNavigationResult({ kind: "redirect", ...result.redirect });
        if (result.rejection)
            throw new RemoteNavigationResult({ kind: "deny", ...result.rejection });
        const decoded = decodeWireEnvelope(result);
        if (decoded.status !== "ready" || decoded.data.pages.length !== 1)
            throw new ExecutionError("failure", "Invalid server controller response");
        const loaded = decoded.data.pages[0]!;
        const target = collectAllLeaves(deserializeNavigation(decoded.data.tree!)).find(
            (leaf) => leaf.entryId === loaded.entryId,
        )!;
        const page = loaded.data as BasePage;
        remotePages.set(page, {
            target,
            rewriteUrl: response.headers.get("content-location") ?? undefined,
        });
        return page;
    }
}
