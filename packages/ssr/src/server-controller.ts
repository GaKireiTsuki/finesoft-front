import {
    BaseController,
    ExecutionError,
    type ControllerInput,
    type ExecutionContext,
} from "@finesoft/core";
import {
    SERVER_CONTROLLER,
    SERVER_REQUEST,
    type ControllerContext,
    type ServerRequestState,
} from "@finesoft/web";

export interface CookieOptions {
    readonly path?: string;
    readonly domain?: string;
    readonly maxAge?: number;
    readonly expires?: Date;
    readonly httpOnly?: boolean;
    readonly secure?: boolean;
    readonly sameSite?: "Strict" | "Lax" | "None";
}
export interface ServerControllerContext extends ControllerContext {
    readonly isServer: true;
    readonly request: Request;
    readonly responseHeaders: Headers;
    /** Write response cookies; request cookies remain the values supplied by the caller. */
    setCookie(name: string, value: string, options?: CookieOptions): void;
    deleteCookie(name: string, options?: CookieOptions): void;
}
export type ServerControllerInput<
    P extends Record<string, unknown> = Record<string, unknown>,
    Q extends Record<string, unknown> = Record<string, unknown>,
> = ControllerInput<P, Q, ServerControllerContext>;

/** Server execution reuses the ordinary controller lifecycle; the Vite boundary removes its module from clients. */
export abstract class BaseServerController<
    I extends ServerControllerInput = ServerControllerInput,
    R = unknown,
> extends BaseController<I, R> {
    readonly [SERVER_CONTROLLER] = true;

    protected override prepareContext(context: ExecutionContext): I["context"] {
        const state = context.bindings[SERVER_REQUEST] as ServerRequestState | undefined;
        if (
            !state ||
            !(state.request instanceof Request) ||
            !(context as ControllerContext).isServer
        )
            throw new ExecutionError(
                "capability",
                "BaseServerController requires a server request",
            );
        const setCookie = (name: string, value: string, options: CookieOptions = {}) => {
            context.signal.throwIfAborted();
            if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name)) throw new TypeError("Invalid cookie name");
            const parts = [`${name}=${encodeURIComponent(value)}`];
            for (const [key, item] of [
                ["Path", options.path ?? "/"],
                ["Domain", options.domain],
            ] as const) {
                if (item !== undefined) {
                    if (/[;\r\n]/.test(item)) throw new TypeError("Invalid cookie attribute");
                    parts.push(`${key}=${item}`);
                }
            }
            if (options.maxAge !== undefined) {
                if (!Number.isSafeInteger(options.maxAge))
                    throw new TypeError("Invalid cookie maxAge");
                parts.push(`Max-Age=${options.maxAge}`);
            }
            if (options.expires) {
                if (!Number.isFinite(options.expires.getTime()))
                    throw new TypeError("Invalid cookie expiry");
                parts.push(`Expires=${options.expires.toUTCString()}`);
            }
            if (options.httpOnly) parts.push("HttpOnly");
            if (options.secure) parts.push("Secure");
            if (options.sameSite) {
                if (!["Strict", "Lax", "None"].includes(options.sameSite))
                    throw new TypeError("Invalid SameSite");
                parts.push(`SameSite=${options.sameSite}`);
            }
            state.responseHeaders.append("set-cookie", parts.join("; "));
        };
        const server: ServerControllerContext = Object.freeze({
            ...(context as ControllerContext),
            isServer: true,
            request: state.request,
            responseHeaders: state.responseHeaders,
            setCookie,
            deleteCookie: (name: string, options?: CookieOptions) =>
                setCookie(name, "", { ...options, maxAge: 0 }),
        });
        return server as I["context"];
    }
}
