import type { ControllerInput, ExecutionContext } from "@finesoft/core";
import type { NavigationContext } from "../middleware/types";

/** Page metadata belongs to the current load, including when several pages share an execution. */
export interface ControllerContext extends ExecutionContext {
    readonly url: string;
    readonly path: string;
    readonly intent: NavigationContext["intent"];
    readonly isServer: boolean;
    getCookie(name: string): string | undefined;
    getHeader(name: string): string | undefined;
}
export type PageControllerInput<
    P extends Record<string, unknown> = Record<string, unknown>,
    Q extends Record<string, unknown> = Record<string, unknown>,
> = ControllerInput<P, Q, ControllerContext>;

// These identities travel only inside an execution, never in the hydration protocol.
export const SERVER_CONTROLLER = Symbol.for("finesoft.serverController");
export const SERVER_REQUEST = "@finesoft/web/server-request";
export interface ServerRequestState {
    readonly request: Request;
    readonly responseHeaders: Headers;
    readonly remote: boolean;
    /** Incoming request cookies; outgoing response mutations do not change this view. */
    readonly cookies: ReadonlyMap<string, string>;
}
export function controllerContext(
    execution: ExecutionContext,
    navigation: Pick<
        NavigationContext,
        "url" | "path" | "intent" | "isServer" | "getCookie" | "getHeader"
    >,
): ControllerContext {
    const state = execution.bindings[SERVER_REQUEST] as ServerRequestState | undefined;
    return Object.freeze({
        ...execution,
        url: navigation.url,
        path: navigation.path,
        intent: navigation.intent,
        isServer: navigation.isServer,
        getCookie: (name: string) => (state ? state.cookies.get(name) : navigation.getCookie(name)),
        getHeader: (name: string) => navigation.getHeader(name),
    });
}
