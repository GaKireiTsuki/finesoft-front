/** One redirect owner for protected clients and fixed-origin proxies. */
export async function fetchWithRedirects(
    fetch: typeof globalThis.fetch,
    input: string | URL | Request,
    init: RequestInit | undefined,
    validate: (url: string) => void | Promise<void>,
): Promise<Response> {
    const request = typeof input === "object" && "url" in input ? input : undefined;
    const mode = init?.redirect ?? request?.redirect ?? "follow";
    let url = typeof input === "string" ? input : "url" in input ? input.url : input.href;
    let options = init;
    let method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    let body = init?.body ?? request?.body;
    const signal = init?.signal ?? request?.signal;
    for (let hop = 0; ; hop++) {
        signal?.throwIfAborted();
        await validate(url);
        signal?.throwIfAborted();
        const response = await fetch(input, {
            ...options,
            redirect: mode === "follow" ? "manual" : mode,
        });
        if (signal?.aborted) {
            void response.body?.cancel().catch(() => {});
            signal.throwIfAborted();
        }
        if (mode !== "follow") return response;
        if (response.type === "opaqueredirect")
            throw new TypeError("Protected fetch cannot inspect an opaque redirect");
        const location = response.headers.get("location");
        if (![301, 302, 303, 307, 308].includes(response.status) || location === null) {
            if (hop) Object.defineProperty(response, "redirected", { value: true });
            return response;
        }
        void response.body?.cancel().catch(() => {});
        if (hop === 20) throw new TypeError("Too many redirects");
        // A relative in-process request has no Response.url. Keep its relative
        // destinations in-process while still resolving network-path redirects.
        const base = new URL(response.url || url, "http://relative.invalid/");
        const next = new URL(location, base);
        if (!/^https?:$/.test(next.protocol) || next.username || next.password)
            throw new TypeError("Invalid redirect target");
        const relative = !URL.canParse(url) && next.origin === base.origin;
        const nextUrl = relative ? next.pathname + next.search + next.hash : next.href;
        const headers = new Headers(options?.headers ?? request?.headers);
        if (next.origin !== base.origin) {
            for (const name of [
                "authorization",
                "proxy-authorization",
                "cookie",
                "cookie2",
                "host",
            ])
                headers.delete(name);
        }
        if (
            ((response.status === 301 || response.status === 302) && method === "POST") ||
            (response.status === 303 && method !== "GET" && method !== "HEAD")
        ) {
            method = "GET";
            body = undefined;
            for (const name of [
                "content-encoding",
                "content-language",
                "content-location",
                "content-type",
                "content-length",
            ])
                headers.delete(name);
        } else if (body instanceof ReadableStream) {
            // Replaying a consumed stream requires unbounded tee buffering.
            throw new TypeError("Cannot replay a streamed request body after a redirect");
        }
        options = {
            ...(request
                ? {
                      credentials: request.credentials,
                      cache: request.cache,
                      integrity: request.integrity,
                      keepalive: request.keepalive,
                      mode: request.mode,
                      referrer: request.referrer,
                      referrerPolicy: request.referrerPolicy,
                  }
                : {}),
            ...options,
            method,
            headers,
            body,
            signal,
        };
        input = url = nextUrl;
    }
}
